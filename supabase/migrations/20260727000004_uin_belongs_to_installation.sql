-- The derived UIN belongs to the installation, not to the certificate.
--
-- 20260727000003 built it from the document number every time, which meant a
-- renewal minted a new UIN. The number is meant to identify the fitted limiter
-- for its lifetime, so it is now derived **once** — on the first certificate
-- issued for an installation — written back to that installation, and reprinted
-- unchanged by every later renewal.
--
-- Order of precedence when issuing:
--   1. a UIN recorded on the job (a technician typing the ROP-issued number),
--   2. the UIN the installation already carries,
--   3. otherwise derive OM-<last 5 chassis digits>-<document number> and keep it.
--
-- app.build_uin is unchanged: same format, same example
-- (JHHLCK1F7PK026626 + GOM-WO-202601 => OM-26626-202601).

create or replace function public.issue_certificate(
  p_job_id uuid,
  p_issuing_authority text default null,
  p_expires_at date default null,
  p_notes text default null
)
returns public.speed_limiter_certificates
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job public.sl_jobs%rowtype;
  v_installation_id uuid;
  v_seal text;
  v_uin text;
  v_secondary integer;
  v_inst_device uuid;
  v_device_id uuid;
  v_limiter_type text;
  v_chassis text;
  v_number text;
  v_final_uin text;
  v_validity integer;
  v_expires date;
  v_cert public.speed_limiter_certificates%rowtype;
begin
  select * into v_job from public.sl_jobs where id = p_job_id for update;
  if not found then
    raise exception 'JOB_NOT_FOUND';
  end if;
  if v_job.status not in ('completed', 'qc_approved')
     or v_job.job_type not in ('installation', 'replacement', 'inspection') then
    raise exception 'JOB_NOT_CERTIFIABLE';
  end if;
  if exists (
    select 1 from public.speed_limiter_certificates c
    where c.job_id = p_job_id and c.status = 'valid'
  ) then
    raise exception 'CERT_ALREADY_ISSUED';
  end if;

  select id, tamper_seal_number, uin, set_speed_secondary_kmh, device_id
    into v_installation_id, v_seal, v_uin, v_secondary, v_inst_device
  from public.speed_limiter_installations
  where job_id = p_job_id
  limit 1;

  if v_installation_id is null then
    select id, tamper_seal_number, uin, set_speed_secondary_kmh, device_id
      into v_installation_id, v_seal, v_uin, v_secondary, v_inst_device
    from public.speed_limiter_installations
    where vehicle_id = v_job.vehicle_id and status = 'active'
    order by installed_at desc, created_at desc
    limit 1;
  end if;

  v_device_id := coalesce(v_job.device_id, v_inst_device);
  select limiter_type into v_limiter_type
  from public.sl_devices where id = v_device_id;

  select coalesce(chassis_number, vin) into v_chassis
  from public.vehicles where id = v_job.vehicle_id;

  v_number := public.next_certificate_number();

  -- A recorded number always wins; derive only when this limiter has none yet.
  v_final_uin := coalesce(nullif(btrim(coalesce(v_job.uin, '')), ''),
                          nullif(btrim(coalesce(v_uin, '')), ''),
                          app.build_uin(v_chassis, v_number));

  -- Freeze it on the installation so every later renewal reprints this one.
  if v_installation_id is not null and v_final_uin is not null
     and nullif(btrim(coalesce(v_uin, '')), '') is null then
    update public.speed_limiter_installations
       set uin = v_final_uin
     where id = v_installation_id;
  end if;

  if p_expires_at is not null then
    v_expires := p_expires_at;
  else
    select cert_validity_months into v_validity
    from public.sl_settings where tenant_id = v_job.tenant_id;
    v_expires := current_date + make_interval(months => coalesce(v_validity, 12));
  end if;

  insert into public.speed_limiter_certificates
    (installation_id, vehicle_id, customer_id, job_id, device_id, set_speed_kmh,
     set_speed_secondary_kmh, tamper_seal_number, uin, limiter_type,
     certificate_number, issuing_authority, issued_at, expires_at, notes)
  values
    (v_installation_id, v_job.vehicle_id, v_job.customer_id, v_job.id, v_device_id,
     v_job.set_speed_kmh,
     coalesce(v_job.set_speed_secondary_kmh, v_secondary),
     coalesce(v_job.tamper_seal_number, v_seal),
     v_final_uin,
     v_limiter_type,
     v_number, p_issuing_authority, current_date, v_expires, p_notes)
  returning * into v_cert;

  return v_cert;
end;
$$;
