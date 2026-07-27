-- Derive the UIN instead of recording it by hand.
--
-- GAWHRAT's rule: OM-{last 5 digits of the chassis number}-{certificate number},
-- e.g. chassis JHHLCK1F7PK026626 + certificate GOM-WO-202601 => OM-26626-202601.
--
-- Note the consequence, which differs from how the field behaved until now: the
-- UIN is built from the *certificate* number, so a renewal gets a new UIN
-- rather than reprinting the installation's. Certificates already issued keep
-- the UIN they were issued with — this only governs new issuance.

create or replace function app.build_uin(p_chassis text, p_cert_number text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when d.digits = '' or p_cert_number is null or btrim(p_cert_number) = ''
             then null
           else 'OM-' || lpad(right(d.digits, 5), 5, '0') || '-' ||
                -- the numeric tail of the document number: GOM-WO-202601 -> 202601
                coalesce(nullif(regexp_replace(p_cert_number, '^.*-', ''), ''),
                         p_cert_number)
         end
  from (select regexp_replace(coalesce(p_chassis, ''), '[^0-9]', '', 'g') as digits) d;
$$;

comment on function app.build_uin(text, text) is
  'UIN printed on the RSL certificate: OM-<last 5 chassis digits>-<document number>. '
  'Mirrored in src/lib/certificate.ts (buildUin) for the client-side renewal path.';

-- issue_certificate v5 — the UIN is now derived from the vehicle's chassis and
-- the number just allocated. A vehicle with no chassis on file has nothing to
-- derive from, so it keeps falling back to whatever was recorded on the job or
-- the installation rather than printing a malformed identifier.
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
     coalesce(app.build_uin(v_chassis, v_number), v_job.uin, v_uin),
     v_limiter_type,
     v_number, p_issuing_authority, current_date, v_expires, p_notes)
  returning * into v_cert;

  return v_cert;
end;
$$;
