-- Road Speed Limiter certificate, Omani dealer format — the remaining cells.
--
-- The printed report already carried the section tables; the reference document
-- every Omani dealer issues has four more things with no schema home:
--
--   * the bilingual masthead and the footer registration strip (tenant-level
--     letterhead: Arabic trade name, C.R. number, P.O. box, postal code, city,
--     e-mail, second GSM, the services tagline, and the scanned signature and
--     company stamp printed in the closing strip);
--   * the UIN, issued once per limiter installation and reprinted unchanged on
--     every renewal — so it lives on the installation and is snapshotted onto
--     the certificate, exactly like the tamper seal;
--   * the second speed band: Omani limiters are programmed with two limits and
--     the certificate prints them as a pair ("70/90 KMPH"); and
--   * the limiter type ("Electronic Pedal"), a property of the device itself
--     rather than of its brand/model.
--
-- Additive only; new columns inherit each table's existing RLS.

-- ---------------------------------------------------------------------------
-- 1) Tenant letterhead + footer registration block
-- ---------------------------------------------------------------------------
alter table public.tenants
  add column if not exists name_ar          text,
  add column if not exists cr_number        text,
  add column if not exists po_box           text,
  add column if not exists postal_code      text,
  add column if not exists city             text,
  add column if not exists email            text,
  add column if not exists phone_secondary  text,
  add column if not exists services_line    text,
  add column if not exists services_line_ar text,
  add column if not exists signature_url    text,
  add column if not exists stamp_url        text;

-- The signature and stamp are rendered as <img src> on the certificate. Keep
-- the scheme allow-list in the database so a mistaken paste can never put an
-- arbitrary URL on an issued document.
alter table public.tenants drop constraint if exists tenants_signature_url_check;
alter table public.tenants
  add constraint tenants_signature_url_check
  check (signature_url is null or signature_url ~ '^(https://|data:image/)');

alter table public.tenants drop constraint if exists tenants_stamp_url_check;
alter table public.tenants
  add constraint tenants_stamp_url_check
  check (stamp_url is null or stamp_url ~ '^(https://|data:image/)');

-- ---------------------------------------------------------------------------
-- 2) UIN — recorded on the job, carried by the installation, snapshotted on
--    the certificate (same lifecycle as tamper_seal_number).
-- ---------------------------------------------------------------------------
alter table public.sl_jobs                     add column if not exists uin text;
alter table public.speed_limiter_installations add column if not exists uin text;
alter table public.speed_limiter_certificates  add column if not exists uin text;

-- ---------------------------------------------------------------------------
-- 3) Second speed band — same 30..160 envelope as the primary set speed.
-- ---------------------------------------------------------------------------
alter table public.sl_jobs
  add column if not exists set_speed_secondary_kmh int;
alter table public.speed_limiter_installations
  add column if not exists set_speed_secondary_kmh int;
alter table public.speed_limiter_certificates
  add column if not exists set_speed_secondary_kmh int;

alter table public.sl_jobs
  drop constraint if exists sl_jobs_set_speed_secondary_kmh_check;
alter table public.sl_jobs
  add constraint sl_jobs_set_speed_secondary_kmh_check
  check (set_speed_secondary_kmh is null
         or (set_speed_secondary_kmh >= 30 and set_speed_secondary_kmh <= 160));

alter table public.speed_limiter_installations
  drop constraint if exists speed_limiter_installations_set_speed_secondary_kmh_check;
alter table public.speed_limiter_installations
  add constraint speed_limiter_installations_set_speed_secondary_kmh_check
  check (set_speed_secondary_kmh is null
         or (set_speed_secondary_kmh >= 30 and set_speed_secondary_kmh <= 160));

alter table public.speed_limiter_certificates
  drop constraint if exists speed_limiter_certificates_set_speed_secondary_kmh_check;
alter table public.speed_limiter_certificates
  add constraint speed_limiter_certificates_set_speed_secondary_kmh_check
  check (set_speed_secondary_kmh is null
         or (set_speed_secondary_kmh >= 30 and set_speed_secondary_kmh <= 160));

-- ---------------------------------------------------------------------------
-- 4) Limiter type — on the device, snapshotted onto the issued certificate.
-- ---------------------------------------------------------------------------
alter table public.sl_devices                 add column if not exists limiter_type text;
alter table public.speed_limiter_certificates add column if not exists limiter_type text;

-- ---------------------------------------------------------------------------
-- 5) complete_sl_job v4 — records the second speed band and the UIN.
--
--    Installation/replacement jobs stamp both onto the installation row they
--    create. Inspection and maintenance jobs create no installation of their
--    own, so a UIN or seal typed during a renewal backfills the vehicle's
--    active installation *only where it is still null*: a legacy install gets
--    its UIN captured once and every later renewal reprints it, and a recorded
--    value is never silently overwritten.
--
--    The 6-arg overload is dropped so PostgREST resolves the deployed bundle's
--    named-arg calls unambiguously onto this one (the new args default).
-- ---------------------------------------------------------------------------
drop function if exists public.complete_sl_job(uuid, int, int, boolean, boolean, text);
create or replace function public.complete_sl_job(
  p_job_id uuid,
  p_duration_minutes int default null,
  p_set_speed_kmh int default null,
  p_customer_signed boolean default false,
  p_technician_signed boolean default false,
  p_tamper_seal_number text default null,
  p_set_speed_secondary_kmh int default null,
  p_uin text default null
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
         set_speed_secondary_kmh =
           coalesce(p_set_speed_secondary_kmh, set_speed_secondary_kmh),
         customer_signed = p_customer_signed,
         technician_signed = p_technician_signed,
         tamper_seal_number = coalesce(p_tamper_seal_number, tamper_seal_number),
         uin = coalesce(p_uin, uin)
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
         set_speed_secondary_kmh, installed_at, technician, status, customer_id,
         device_id, job_id, tamper_seal_number, uin)
      values
        (j.tenant_id, j.vehicle_id, coalesce(d.serial, '-'), d.manufacturer, d.model,
         coalesce(p_set_speed_kmh, j.set_speed_kmh),
         coalesce(p_set_speed_secondary_kmh, j.set_speed_secondary_kmh),
         current_date, tech_name, 'active', j.customer_id, j.device_id, j.id,
         coalesce(p_tamper_seal_number, j.tamper_seal_number),
         coalesce(p_uin, j.uin))
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

  elsif j.job_type in ('inspection', 'maintenance') then
    update public.speed_limiter_installations
       set uin = coalesce(uin, p_uin, j.uin),
           tamper_seal_number =
             coalesce(tamper_seal_number, p_tamper_seal_number, j.tamper_seal_number),
           set_speed_secondary_kmh =
             coalesce(set_speed_secondary_kmh, p_set_speed_secondary_kmh,
                      j.set_speed_secondary_kmh)
     where vehicle_id = j.vehicle_id and status = 'active';
  end if;
end;
$$;
revoke execute on function
  public.complete_sl_job(uuid, int, int, boolean, boolean, text, int, text)
  from public, anon;

-- ---------------------------------------------------------------------------
-- 6) issue_certificate v4 — snapshots the UIN, the second speed band, and the
--    limiter type so a reissued print is byte-identical years later.
-- ---------------------------------------------------------------------------
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
     coalesce(v_job.uin, v_uin),
     v_limiter_type,
     v_number, p_issuing_authority, current_date, v_expires, p_notes)
  returning * into v_cert;

  return v_cert;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7) next_certificate_number — stop truncating long sequences.
--
--    lpad() truncates on the right when the value is already longer than the
--    target width, so a dealer migrating a live 6-digit series (Omani dealers
--    run numbers like SOM-WS-101645) had its numbers silently clipped to five
--    digits — and clipping a sequence collides. Pad only when short.
-- ---------------------------------------------------------------------------
create or replace function public.next_certificate_number()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := (select app.tenant_id());
  v_prefix text;
  v_n integer;
begin
  if v_tenant is null then
    raise exception 'NO_TENANT';
  end if;
  -- DEFINER function: re-assert the role gate RLS would otherwise provide,
  -- so viewers cannot burn certificate numbers via a direct RPC call.
  if not (select app.is_manager()) then
    raise exception 'FORBIDDEN';
  end if;
  select cert_prefix into v_prefix from public.sl_settings where tenant_id = v_tenant;
  if v_prefix is null then
    insert into public.sl_settings (tenant_id) values (v_tenant)
    on conflict (tenant_id) do nothing;
    select cert_prefix into v_prefix from public.sl_settings where tenant_id = v_tenant;
  end if;
  v_n := app.next_doc_number(v_tenant, 'sl_certificate');
  return v_prefix || '-' ||
         case when length(v_n::text) >= 5 then v_n::text
              else lpad(v_n::text, 5, '0') end;
end;
$$;
