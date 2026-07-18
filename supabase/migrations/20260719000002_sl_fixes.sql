-- Review fixes: correct certificate numbering fallback, uniqueness backstops,
-- and a transactional job-completion RPC (idempotent, device-consistent).

-- Numbering: the previous fallback could hand out SLC-00001 twice for tenants
-- without a pre-seeded sl_settings row.
create or replace function public.next_certificate_number()
returns text
language plpgsql
set search_path = public
as $$
declare
  n int;
  prefix text;
begin
  update public.sl_settings
     set cert_next_number = cert_next_number + 1, updated_at = now()
   where tenant_id = app.tenant_id()
   returning cert_next_number - 1, cert_prefix into n, prefix;
  if n is null then
    insert into public.sl_settings (tenant_id, cert_next_number) values (app.tenant_id(), 2)
    on conflict (tenant_id) do update
      set cert_next_number = public.sl_settings.cert_next_number + 1, updated_at = now()
    returning cert_next_number - 1, cert_prefix into n, prefix;
  end if;
  return prefix || '-' || lpad(n::text, 5, '0');
end;
$$;

-- Backstops: certificate numbers unique per tenant; one installation per job.
create unique index sl_certificates_number_uidx
  on public.speed_limiter_certificates (tenant_id, certificate_number);
create unique index sl_installations_job_uidx
  on public.speed_limiter_installations (job_id) where job_id is not null;

-- Transactional job completion. Runs as invoker (RLS applies: managers only).
-- Handles all side-effects atomically and is idempotent on retry:
--  * installation/replacement: retire prior active installations on the
--    vehicle, free their devices, create the new installation (once per job),
--    mark the new device installed.
--  * removal: retire active installations and return devices to stock.
create or replace function public.complete_sl_job(
  p_job_id uuid,
  p_duration_minutes int default null,
  p_set_speed_kmh int default null,
  p_customer_signed boolean default false,
  p_technician_signed boolean default false
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
         technician_signed = p_technician_signed
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
         installed_at, technician, status, customer_id, device_id, job_id)
      values
        (j.tenant_id, j.vehicle_id, coalesce(d.serial, '-'), d.manufacturer, d.model,
         coalesce(p_set_speed_kmh, j.set_speed_kmh), current_date, tech_name, 'active',
         j.customer_id, j.device_id, j.id)
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
revoke execute on function public.complete_sl_job(uuid, int, int, boolean, boolean) from anon;
