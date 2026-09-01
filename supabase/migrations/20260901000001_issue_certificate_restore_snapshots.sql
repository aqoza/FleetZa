-- issue_certificate: restore the snapshots 20260728000007 silently dropped.
--
-- 20260728000007 added the technician snapshot by recreating the whole
-- function, but it built on a body that predated 20260727000003 and
-- 20260727000004. Its own comment — "Everything else in the body is as it
-- was" — was wrong: recreating from that stale copy reverted every field those
-- two migrations had added, and the regression has been live since.
--
-- Lost there, restored here:
--
--   * the derived UIN (app.build_uin) and its freeze onto the installation.
--     Job-issued certificates stopped carrying a UIN at all — the number
--     /api/verify tells an inspector to cross-check against the paper in front
--     of them. app.build_uin survived with nothing left calling it.
--   * the CERT_ALREADY_ISSUED guard, so one job could mint any number of live
--     certificates. src/lib/db.ts still maps the code the server stopped
--     raising, which is the clearest sign this was accidental.
--   * the installation fallback by vehicle. A job whose installation was never
--     linked back to it produced installation_id null, losing the installed-on
--     date that both the printed certificate and /api/verify report.
--   * the set_speed_secondary_kmh, tamper_seal_number and limiter_type
--     snapshots — the second speed band, the seal and the certified limiter
--     type each fell back to a dash on the document.
--   * device_id falling back to the installation's device.
--
-- The technician resolution from 20260728000007 is carried over unchanged, and
-- the signature stays (uuid, text, date, text) so grants and callers are
-- untouched. renewCertificate — the other way a certificate is born — already
-- does all of this, which is why renewals stayed correct while job issuance
-- did not.
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
  v_technician text;
  v_cert public.speed_limiter_certificates%rowtype;
begin
  select * into v_job from public.sl_jobs where id = p_job_id for update;
  if not found then
    raise exception 'JOB_NOT_FOUND';
  end if;
  -- Same gate the UI enforces today: certifiable job types, post-completion.
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

  -- A job that never had its installation linked back still certifies the
  -- limiter the vehicle currently carries.
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

  -- Who the document names: the job's own technician, else the configured
  -- default. Resolved to a NAME here so the certificate keeps it verbatim.
  select tech.name into v_technician
  from public.sl_technicians tech
  where tech.id = v_job.technician_id;

  if v_technician is null then
    select tech.name into v_technician
    from public.sl_settings s
    join public.sl_technicians tech on tech.id = s.default_technician_id
    where s.tenant_id = v_job.tenant_id;
  end if;

  insert into public.speed_limiter_certificates
    (installation_id, vehicle_id, customer_id, job_id, device_id, set_speed_kmh,
     set_speed_secondary_kmh, tamper_seal_number, uin, limiter_type,
     certificate_number, issuing_authority, issued_at, expires_at, notes,
     technician_name)
  values
    (v_installation_id, v_job.vehicle_id, v_job.customer_id, v_job.id, v_device_id,
     v_job.set_speed_kmh,
     coalesce(v_job.set_speed_secondary_kmh, v_secondary),
     coalesce(v_job.tamper_seal_number, v_seal),
     v_final_uin,
     v_limiter_type,
     v_number, p_issuing_authority, current_date, v_expires, p_notes,
     v_technician)
  returning * into v_cert;

  return v_cert;
end;
$$;
revoke execute on function public.issue_certificate(uuid, text, date, text) from public, anon;
