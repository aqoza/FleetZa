-- issue_certificate: snapshot the technician onto the certificate it issues.
--
-- The renewal path already records `technician_name` at issuance. This is the
-- other way a certificate is born — from a completed job — and it was leaving
-- the column null, so a certificate issued from a job with a technician still
-- printed a dash until someone renewed it.
--
-- Resolution, most specific first: the technician who actually did the job,
-- then the module's configured default (sl_settings.default_technician_id) for
-- a job that never recorded one. Null if neither exists, which prints as a
-- dash exactly as before.
--
-- Signature is unchanged (uuid, text, date, text) so the existing grants and
-- every caller keep working. Everything else in the body is as it was.
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
  v_number text;
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

  select id into v_installation_id
  from public.speed_limiter_installations
  where job_id = p_job_id
  limit 1;

  v_number := public.next_certificate_number();

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
     certificate_number, issuing_authority, issued_at, expires_at, notes,
     technician_name)
  values
    (v_installation_id, v_job.vehicle_id, v_job.customer_id, v_job.id, v_job.device_id,
     v_job.set_speed_kmh, v_number, p_issuing_authority, current_date, v_expires, p_notes,
     v_technician)
  returning * into v_cert;

  return v_cert;
end;
$$;
revoke execute on function public.issue_certificate(uuid, text, date, text) from public, anon;
