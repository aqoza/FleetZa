-- Official Road Speed Limiter (RSL) certificate fields.
-- The report page renders the Omani dealer format, but three of its cells had
-- no schema home: Engine No. (vehicles), Tamper Seal No. (recorded at job
-- completion, carried on the installation, snapshotted on the certificate),
-- and the dealer's Address & Phone (tenants). Additive only; new columns
-- inherit each table's existing RLS.

-- 1) Vehicle master data: engine number (VEHICLE DETAILS section).
alter table public.vehicles add column if not exists engine_number text;

-- 2) Tamper seal: the technician records it when completing the job, the
--    installation row carries it while the device is on the vehicle, and the
--    issued certificate snapshots it (immutable document, like set_speed_kmh).
alter table public.sl_jobs
  add column if not exists tamper_seal_number text;
alter table public.speed_limiter_installations
  add column if not exists tamper_seal_number text;
alter table public.speed_limiter_certificates
  add column if not exists tamper_seal_number text;

-- 3) Dealer contact block (DEALER DETAILS section of the report; also the
--    natural home for future letterheads/invoices).
alter table public.tenants add column if not exists address text;
alter table public.tenants add column if not exists phone text;

-- 4) complete_sl_job v3 — accepts the tamper seal and stamps it on the job
--    and on the installation row it creates. The old 5-arg overload is
--    dropped so PostgREST resolves the previously deployed bundle's
--    named-arg calls unambiguously onto this one (the new arg defaults).
drop function if exists public.complete_sl_job(uuid, int, int, boolean, boolean);
create function public.complete_sl_job(
  p_job_id uuid,
  p_duration_minutes int default null,
  p_set_speed_kmh int default null,
  p_customer_signed boolean default false,
  p_technician_signed boolean default false,
  p_tamper_seal_number text default null
)
returns void
language plpgsql
set search_path = public
as $$
declare
  j record;
  d record;
  inst record;
  tech_name text;
begin
  select * into j from public.sl_jobs where id = p_job_id and status = 'in_progress' for update;
  if not found then
    raise exception 'JOB_NOT_IN_PROGRESS';
  end if;

  update public.sl_jobs
     set status = 'completed',
         completed_at = now(),
         duration_minutes = coalesce(p_duration_minutes, duration_minutes),
         set_speed_kmh = coalesce(p_set_speed_kmh, set_speed_kmh),
         customer_signed = p_customer_signed,
         technician_signed = p_technician_signed,
         tamper_seal_number = coalesce(p_tamper_seal_number, tamper_seal_number)
   where id = p_job_id;

  if j.job_type in ('installation', 'replacement') then
    for inst in
      select * from public.speed_limiter_installations
       where vehicle_id = j.vehicle_id and status = 'active'
    loop
      update public.speed_limiter_installations set status = 'removed' where id = inst.id;
      if inst.device_id is not null
         and (j.device_id is null or inst.device_id <> j.device_id) then
        update public.sl_devices
           set status = 'in_stock', current_vehicle_id = null
         where id = inst.device_id;
      end if;
    end loop;

    if j.device_id is not null then
      select * into d from public.sl_devices where id = j.device_id;
      select name into tech_name from public.sl_technicians where id = j.technician_id;
      insert into public.speed_limiter_installations
        (tenant_id, vehicle_id, device_serial, brand, model, set_speed_kmh,
         installed_at, technician, status, customer_id, device_id, job_id,
         tamper_seal_number)
      values
        (j.tenant_id, j.vehicle_id, coalesce(d.serial, '-'), d.manufacturer, d.model,
         coalesce(p_set_speed_kmh, j.set_speed_kmh), current_date, tech_name, 'active',
         j.customer_id, j.device_id, j.id,
         coalesce(p_tamper_seal_number, j.tamper_seal_number))
      on conflict (job_id) where job_id is not null do nothing;
      update public.sl_devices
         set status = 'installed', current_vehicle_id = j.vehicle_id
       where id = j.device_id;
    end if;

  elsif j.job_type = 'removal' then
    for inst in
      select * from public.speed_limiter_installations
       where vehicle_id = j.vehicle_id and status = 'active'
    loop
      update public.speed_limiter_installations set status = 'removed' where id = inst.id;
      if inst.device_id is not null then
        update public.sl_devices
           set status = 'in_stock', current_vehicle_id = null
         where id = inst.device_id;
      end if;
    end loop;
  end if;
end;
$$;
revoke execute on function public.complete_sl_job(uuid, int, int, boolean, boolean, text)
  from public, anon;

-- 5) issue_certificate v3 — snapshots the tamper seal onto the certificate.
--    Inspection (renewal) jobs create no installation row of their own, so
--    fall back to the vehicle's active installation for the link, the seal,
--    and the device: the printed renewal then shows the real installation
--    date and limiter identity instead of blanks.
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
  v_inst_device uuid;
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

  select id, tamper_seal_number, device_id
    into v_installation_id, v_seal, v_inst_device
  from public.speed_limiter_installations
  where job_id = p_job_id
  limit 1;

  if v_installation_id is null then
    select id, tamper_seal_number, device_id
      into v_installation_id, v_seal, v_inst_device
    from public.speed_limiter_installations
    where vehicle_id = v_job.vehicle_id and status = 'active'
    order by installed_at desc, created_at desc
    limit 1;
  end if;

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
     tamper_seal_number, certificate_number, issuing_authority, issued_at,
     expires_at, notes)
  values
    (v_installation_id, v_job.vehicle_id, v_job.customer_id, v_job.id,
     coalesce(v_job.device_id, v_inst_device), v_job.set_speed_kmh,
     coalesce(v_job.tamper_seal_number, v_seal), v_number, p_issuing_authority,
     current_date, v_expires, p_notes)
  returning * into v_cert;

  return v_cert;
end;
$$;
