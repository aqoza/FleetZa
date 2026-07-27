-- Certificate supersession — teach the database which certificate a vehicle
-- currently carries.
--
-- A vehicle legally carries ONE live RSL certificate at a time, but until now
-- nothing in the schema said which one. `renewed_from` cannot answer it: it is a
-- hint written by the renewal form, it is null for imported history, and it does
-- not survive the shape of the real data — in the GAWHRAT tenant 9 of the 15
-- renewal chains point at a predecessor with a DIFFERENT installation_id,
-- because the paper-register import minted one installation per register row.
-- Supersession is therefore keyed on **vehicle_id**, never installation_id.
--
-- `superseded_by` points at the certificate that IMMEDIATELY replaced this one,
-- so a vehicle's certificates form a linked list that ends at the live head:
--
--     oldest --> ... --> previous --> newest (superseded_by is null)
--
-- `superseded_by is null` therefore means "this is the vehicle's current
-- certificate". It is deliberately a linked list rather than "every historical
-- row points at the head": the FK is ON DELETE SET NULL, so deleting the head
-- resurrects exactly ONE predecessor as the new head instead of resurrecting
-- every historical row at once and leaving a vehicle with a dozen live
-- certificates.
--
-- Additive only. Nothing is deleted and no pre-existing column is rewritten. The
-- 487 long-expired rows imported from the paper register stay exactly where they
-- are — they are history, and the history is what makes a renewal defensible.

-- ============================================================
-- 1) The column.
-- ============================================================
alter table public.speed_limiter_certificates
  add column if not exists superseded_by uuid
    references public.speed_limiter_certificates (id) on delete set null;

comment on column public.speed_limiter_certificates.superseded_by is
  'The certificate that immediately replaced this one for the same vehicle. NULL means this row is that vehicle''s current certificate. '
  'Live set = (superseded_by is null and status = ''valid''): supersession is temporal, revocation is a separate axis, so a revoked head means the vehicle has no valid certificate rather than resurrecting an older one. '
  'Keyed on vehicle_id, never installation_id — real renewal chains change installation_id. '
  'Maintained by app.sync_certificate_supersession(). Not the same as renewed_from, which only records the row an operator pressed Renew on.';

-- ============================================================
-- 2) Indexes.
--    The hot query is "live certificates for this tenant by expiry" — the
--    partial index is a fraction of the size of sl_certificates_tenant_expiry_idx
--    because it excludes every superseded predecessor. The second one backs the
--    FK: without it every certificate DELETE seq-scans the table to apply
--    ON DELETE SET NULL. `superseded_by = $1` implies `is not null`, so the
--    partial index still serves the referential-integrity lookup.
-- ============================================================
create index if not exists sl_certificates_live_expiry_idx
  on public.speed_limiter_certificates (tenant_id, expires_at)
  where superseded_by is null;

create index if not exists sl_certificates_superseded_by_idx
  on public.speed_limiter_certificates (superseded_by)
  where superseded_by is not null;

-- ============================================================
-- 3) The maintenance trigger.
--
--    Siblings are ordered by (issued_at, created_at, id) descending — newest
--    first. `id` is a uuid primary key, so the order is TOTAL: two certificates
--    issued on the same day for the same vehicle (this tenant has such a pair)
--    can never both be treated as newest.
--
--    superseded_by always points strictly UP that order, which is what makes
--    cycles structurally impossible: a row can never point at itself, and a
--    two-cycle would require a < b and b < a under a strict total order.
--
--    SECURITY DEFINER, like app.log_audit: the invariant must hold whatever the
--    caller's RLS grants are. Every statement is pinned to the row's own
--    tenant_id so the trigger still cannot reach across tenants.
-- ============================================================
create or replace function app.sync_certificate_supersession()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant  uuid;
  v_vehicle uuid;
  v_newer   uuid;
  v_older   uuid;
  v_succ    uuid;
begin
  if tg_op = 'INSERT' then
    v_tenant  := new.tenant_id;
    v_vehicle := new.vehicle_id;
  else
    v_tenant  := old.tenant_id;
    v_vehicle := old.vehicle_id;
  end if;

  -- Serialize issuance per vehicle. Without this, two simultaneous renewals each
  -- see no sibling and both stay live. That is not hypothetical: this tenant
  -- already carries a double-submit pair (SOM-WS-00487 / SOM-WS-00488).
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_tenant::text || ':' || v_vehicle::text, 0));

  if tg_op = 'INSERT' then
    -- Immediate successor: the OLDEST sibling that still ranks newer than NEW.
    -- Null when NEW is the newest, which is the ordinary renewal case.
    select c.id into v_newer
    from public.speed_limiter_certificates c
    where c.tenant_id = v_tenant
      and c.vehicle_id = v_vehicle
      and c.id <> new.id
      and (c.issued_at, c.created_at, c.id) > (new.issued_at, new.created_at, new.id)
    order by c.issued_at, c.created_at, c.id
    limit 1;

    -- Immediate predecessor: the NEWEST sibling that ranks older than NEW.
    select c.id into v_older
    from public.speed_limiter_certificates c
    where c.tenant_id = v_tenant
      and c.vehicle_id = v_vehicle
      and c.id <> new.id
      and (c.issued_at, c.created_at, c.id) < (new.issued_at, new.created_at, new.id)
    order by c.issued_at desc, c.created_at desc, c.id desc
    limit 1;

    -- NEW is back-dated (a historical import, or a correction issued with an
    -- earlier date): it is born superseded and the live head is left alone.
    if v_newer is not null then
      update public.speed_limiter_certificates
         set superseded_by = v_newer
       where id = new.id
         and tenant_id = v_tenant
         and superseded_by is distinct from v_newer;
    end if;

    -- Whatever NEW slots in front of now points at NEW. When NEW is the newest,
    -- this is the certificate the vehicle carried until a moment ago.
    if v_older is not null then
      update public.speed_limiter_certificates
         set superseded_by = new.id
       where id = v_older
         and tenant_id = v_tenant
         and superseded_by is distinct from new.id;
    end if;
  else
    -- Deleting a row must splice the list, not tear it. The FK's ON DELETE SET
    -- NULL already frees the predecessor, which is exactly right when the head
    -- is deleted (one predecessor is promoted). But deleting a row from the
    -- MIDDLE would leave its predecessor live alongside the real head — two live
    -- certificates for one vehicle. So relink the predecessor onto OLD's own
    -- successor. This is written to be independent of whether the FK action has
    -- already fired.
    select c.id into v_succ
    from public.speed_limiter_certificates c
    where c.id = old.superseded_by
      and c.tenant_id = v_tenant;

    select c.id into v_older
    from public.speed_limiter_certificates c
    where c.tenant_id = v_tenant
      and c.vehicle_id = v_vehicle
      and (c.issued_at, c.created_at, c.id) < (old.issued_at, old.created_at, old.id)
    order by c.issued_at desc, c.created_at desc, c.id desc
    limit 1;

    -- v_succ null (OLD was the head, or its successor went too) simply promotes
    -- the predecessor to head.
    if v_older is not null then
      update public.speed_limiter_certificates
         set superseded_by = v_succ
       where id = v_older
         and tenant_id = v_tenant
         and superseded_by is distinct from v_succ;
    end if;
  end if;

  return null;
end;
$$;

-- No UPDATE path. Certificates are issued documents: the only update the
-- application performs on one is revocation (status / revoked_at /
-- revoked_reason in CertificatesPage), which is orthogonal to ordering. Nothing
-- edits issued_at or vehicle_id after issue, so there is no in-place move to
-- repair. If a future feature ever lets either be edited, this trigger must grow
-- an `after update of issued_at, vehicle_id` path that repairs BOTH the vacated
-- position and the new one — note that the updates above only ever write
-- superseded_by, so such a trigger could not re-enter itself.
create or replace trigger speed_limiter_certificates_supersession
  after insert or delete on public.speed_limiter_certificates
  for each row execute function app.sync_certificate_supersession();

-- ============================================================
-- 4) Backfill, one statement, using the same vehicle-keyed rule. `lag` over the
--    newest-first window is the immediate successor; the newest row of each
--    vehicle gets null and stays live. Partitioning by tenant_id keeps every
--    chain inside its own tenant. The `is distinct from` guard limits the write
--    to rows that actually change, so the audit trigger logs 16 rows instead of
--    495.
-- ============================================================
with ranked as (
  select c.id,
         lag(c.id) over (
           partition by c.tenant_id, c.vehicle_id
           order by c.issued_at desc, c.created_at desc, c.id desc
         ) as successor_id
  from public.speed_limiter_certificates c
)
update public.speed_limiter_certificates c
   set superseded_by = r.successor_id
  from ranked r
 where r.id = c.id
   and c.superseded_by is distinct from r.successor_id;
