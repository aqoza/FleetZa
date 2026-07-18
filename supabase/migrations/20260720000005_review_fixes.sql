-- Phase-2 review fixes (adversarial review of the data-layer work):
-- 1) one valid certificate per job — RPC guard + partial unique backstop,
-- 2) created_by is no longer client-forgeable,
-- 3) efficiency report returns every vehicle with fuel activity (vehicles
--    without a full-tank pair no longer vanish) and separates displayed
--    volume from the paired volume used for the efficiency math.

-- The duplicate created during Phase-2 verification testing: SLC-00002 was
-- issued for job #1 which already had SLC-00001. Revoke it so the unique
-- backstop below can build; it remains in history with an explicit reason.
update public.speed_limiter_certificates
set status = 'revoked',
    revoked_at = now(),
    revoked_reason = 'Duplicate of SLC-00001 (issued while verifying the issuance flow)'
where certificate_number = 'SLC-00002' and status = 'valid';

-- Backstop: at most one VALID certificate per job (renewals don't carry
-- job_id, so they are unaffected; revoked certificates don't block reissue).
create unique index sl_certificates_valid_job_uidx
  on public.speed_limiter_certificates (job_id)
  where job_id is not null and status = 'valid';

-- issue_certificate v2: refuse to double-issue. The FOR UPDATE job lock
-- serializes concurrent calls; the existence check then closes the gate.
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

  insert into public.speed_limiter_certificates
    (installation_id, vehicle_id, customer_id, job_id, device_id, set_speed_kmh,
     certificate_number, issuing_authority, issued_at, expires_at, notes)
  values
    (v_installation_id, v_job.vehicle_id, v_job.customer_id, v_job.id, v_job.device_id,
     v_job.set_speed_kmh, v_number, p_issuing_authority, current_date, v_expires, p_notes)
  returning * into v_cert;

  return v_cert;
end;
$$;

-- stamp_actor v2: provenance is not client-writable. When a JWT is present it
-- wins over any client-supplied created_by; on UPDATE created_by is immutable
-- (service-role/backfill paths, where auth.uid() is null, keep client values).
create or replace function app.stamp_actor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.created_by := old.created_by;
  end if;
  new.updated_by := auth.uid();
  return new;
end;
$$;

-- report_fuel_efficiency v2 (return type changes: drop + recreate):
-- every vehicle with fuel activity in the window gets a row; total_liters is
-- ALL fuel logged in the window (the report's Volume column), pair_liters and
-- total_km cover only full-tank-to-full-tank segments (the efficiency math),
-- and window ordering gets a deterministic tiebreaker.
drop function if exists public.report_fuel_efficiency(date, date, text);
create function public.report_fuel_efficiency(
  p_from date,
  p_to date,
  p_ownership text default null
)
returns table (
  vehicle_id uuid,
  vehicle_name text,
  total_km numeric,
  total_liters numeric,
  pair_liters numeric,
  liters_per_100km numeric
)
language sql
security invoker
set search_path = ''
as $$
  with logs as (
    select f.vehicle_id as vid, f.filled_at, f.odometer, f.volume, f.is_full_tank, f.id,
           sum(f.volume) over (
             partition by f.vehicle_id order by f.filled_at, f.id
           ) as cumvol
    from public.fuel_logs f
    join public.vehicles v on v.id = f.vehicle_id
    where f.filled_at >= p_from and f.filled_at < (p_to + 1)
      and (p_ownership is null or v.ownership = p_ownership)
  ),
  vol as (
    select vid, sum(volume) as v from logs group by vid
  ),
  fulls as (
    select vid, odometer, cumvol,
           lag(odometer) over (partition by vid order by filled_at, odometer, id) as prev_odo,
           lag(cumvol) over (partition by vid order by filled_at, odometer, id) as prev_cum
    from logs
    where is_full_tank and odometer is not null
  ),
  pairs as (
    select vid, odometer - prev_odo as dist, cumvol - prev_cum as pvol
    from fulls
    where prev_odo is not null and odometer > prev_odo
  ),
  agg as (
    select vid, sum(dist) as km, sum(pvol) as pl from pairs group by vid
  )
  select v.id, v.name,
         coalesce(agg.km, 0),
         vol.v,
         agg.pl,
         round(agg.pl / nullif(agg.km, 0) * 100, 2)
  from vol
  join public.vehicles v on v.id = vol.vid
  left join agg on agg.vid = vol.vid
  order by 6 asc nulls last, 2 asc;
$$;
revoke execute on function public.report_fuel_efficiency(date, date, text) from public, anon;
