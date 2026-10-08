-- Incidents (module incidents): accidents, thefts, injuries and near misses
-- on the fleet, with the people involved, costs, root cause and links to the
-- issue, work order and insurance claim that follow.
--
-- 1) incidents: numbered INC-00001 (doc type 'incident'). status reported →
--    investigating → awaiting_repair → resolved → closed; investigating and
--    reported may go straight to resolved; resolved may reopen to
--    investigating. app.incident_guard enforces it
--    (ILLEGAL_INCIDENT_TRANSITION), stamps resolved_at / closed_at, and
--    refuses to close a major or critical incident without a root cause
--    (INCIDENT_ROOT_CAUSE_REQUIRED). occurred_at may not be in the future
--    (INVALID_INCIDENT_TIME). Closed incidents are locked except notes
--    (INCIDENT_LOCKED); only reported ones can be deleted
--    (INCIDENT_NOT_DELETABLE). driving_event_id is a plain uuid (Driver
--    behavior is optional); claim_id is set by incident_create_claim only.
-- 2) incident_parties: third-party drivers, witnesses, passengers,
--    pedestrians, police and others, with their statement. Locked with the
--    incident.
-- 3) incident_events: the status timeline, written by the trigger only.
-- 4) public.incident_create_work_order(incident) opens a work order for the
--    vehicle and links it (needs maintenance; INCIDENT_HAS_WORK_ORDER).
--    public.incident_create_claim(incident, policy) drafts an insurance claim
--    from the incident (needs insurance_mgmt; INCIDENT_HAS_CLAIM). Both run
--    as the caller, so the target module's RLS and numbering apply.
-- 5) A new major or critical incident, or one raised to that severity,
--    notifies managers (incidents.major). Every new incident emits the
--    automation event incident.reported.
-- 6) When the Insurance module's table exists, insurance_claims.incident_id
--    gets its foreign key here.
--
-- Raised codes: ILLEGAL_INCIDENT_TRANSITION, INCIDENT_ROOT_CAUSE_REQUIRED,
-- INVALID_INCIDENT_TIME, INCIDENT_LOCKED, INCIDENT_NOT_DELETABLE,
-- INCIDENT_NOT_FOUND, INCIDENT_HAS_WORK_ORDER, INCIDENT_HAS_CLAIM
-- (+ MODULE_DISABLED, CROSS_TENANT_REFERENCE, FORBIDDEN). Additive only.

set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- ============================================================
-- Tables
-- ============================================================
create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  number integer,
  doc_number text,
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  driver_id uuid references public.drivers(id) on delete set null,
  occurred_at timestamptz not null,
  location text check (location is null or char_length(location) <= 300),
  lat numeric(9,6) check (lat is null or lat between -90 and 90),
  lng numeric(9,6) check (lng is null or lng between -180 and 180),
  incident_type text not null default 'collision'
    check (incident_type in ('collision', 'theft', 'vandalism', 'injury', 'near_miss', 'breakdown', 'fire', 'weather', 'other')),
  severity text not null default 'minor' check (severity in ('minor', 'moderate', 'major', 'critical')),
  description text not null check (char_length(btrim(description)) between 1 and 4000),
  injuries integer not null default 0 check (injuries between 0 and 1000),
  fatalities integer not null default 0 check (fatalities between 0 and 1000),
  police_report_number text check (police_report_number is null or char_length(police_report_number) <= 100),
  police_station text check (police_station is null or char_length(police_station) <= 200),
  at_fault text not null default 'unknown' check (at_fault in ('our_driver', 'third_party', 'shared', 'unknown', 'none')),
  estimated_damage numeric(14,3) check (estimated_damage is null or estimated_damage >= 0),
  actual_cost numeric(14,3) check (actual_cost is null or actual_cost >= 0),
  currency text not null default 'USD',
  vehicle_drivable boolean not null default true,
  status text not null default 'reported'
    check (status in ('reported', 'investigating', 'awaiting_repair', 'resolved', 'closed')),
  driving_event_id uuid,
  issue_id uuid references public.issues(id) on delete set null,
  work_order_id uuid references public.work_orders(id) on delete set null,
  claim_id uuid,
  root_cause text check (root_cause is null or char_length(root_cause) <= 4000),
  corrective_actions text check (corrective_actions is null or char_length(corrective_actions) <= 4000),
  resolved_at timestamptz,
  closed_at timestamptz,
  notes text check (notes is null or char_length(notes) <= 4000),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint incidents_coords_ck check ((lat is null) = (lng is null))
);
create unique index incidents_tenant_number_uk on public.incidents (tenant_id, number);
create unique index incidents_tenant_doc_number_uk on public.incidents (tenant_id, doc_number);
create index incidents_tenant_occurred_idx on public.incidents (tenant_id, occurred_at desc);
create index incidents_tenant_status_idx on public.incidents (tenant_id, status);
create index incidents_vehicle_idx on public.incidents (vehicle_id);
create index incidents_driver_idx on public.incidents (driver_id) where driver_id is not null;
create index incidents_issue_idx on public.incidents (issue_id) where issue_id is not null;
create index incidents_work_order_idx on public.incidents (work_order_id) where work_order_id is not null;

create table public.incident_parties (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  incident_id uuid not null references public.incidents(id) on delete cascade,
  party_type text not null default 'third_party_driver'
    check (party_type in ('third_party_driver', 'witness', 'passenger', 'pedestrian', 'police', 'other')),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  phone text check (phone is null or char_length(phone) <= 50),
  vehicle_plate text check (vehicle_plate is null or char_length(vehicle_plate) <= 50),
  insurer text check (insurer is null or char_length(insurer) <= 200),
  insurance_policy_number text check (insurance_policy_number is null or char_length(insurance_policy_number) <= 100),
  statement text check (statement is null or char_length(statement) <= 4000),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index incident_parties_incident_idx on public.incident_parties (incident_id);
create index incident_parties_tenant_idx on public.incident_parties (tenant_id);

create table public.incident_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  incident_id uuid not null references public.incidents(id) on delete cascade,
  status text not null check (status in ('reported', 'investigating', 'awaiting_repair', 'resolved', 'closed')),
  at timestamptz not null default now(),
  created_by uuid
);
create index incident_events_incident_idx on public.incident_events (incident_id, at);
create index incident_events_tenant_idx on public.incident_events (tenant_id);

alter table public.incidents enable row level security;
alter table public.incident_parties enable row level security;
alter table public.incident_events enable row level security;
revoke all on public.incidents from anon;
revoke all on public.incident_parties from anon;
revoke all on public.incident_events from anon;
-- Numbers, stamps, currency and the claim link are server-side.
revoke insert, update on public.incidents from authenticated;
grant insert (vehicle_id, driver_id, occurred_at, location, lat, lng, incident_type, severity, description, injuries,
              fatalities, police_report_number, police_station, at_fault, estimated_damage, actual_cost,
              vehicle_drivable, driving_event_id, issue_id, work_order_id, root_cause, corrective_actions, notes)
  on public.incidents to authenticated;
grant update (vehicle_id, driver_id, occurred_at, location, lat, lng, incident_type, severity, description, injuries,
              fatalities, police_report_number, police_station, at_fault, estimated_damage, actual_cost,
              vehicle_drivable, driving_event_id, issue_id, work_order_id, root_cause, corrective_actions, notes, status)
  on public.incidents to authenticated;
revoke insert, update on public.incident_parties from authenticated;
grant insert (incident_id, party_type, name, phone, vehicle_plate, insurer, insurance_policy_number, statement)
  on public.incident_parties to authenticated;
grant update (party_type, name, phone, vehicle_plate, insurer, insurance_policy_number, statement)
  on public.incident_parties to authenticated;
revoke insert, update, delete on public.incident_events from authenticated;

-- ============================================================
-- Incident state machine
-- ============================================================
create or replace function app.incident_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client boolean := coalesce(nullif(current_setting('role', true), ''), 'none') in ('authenticated', 'anon')
                      and pg_trigger_depth() <= 1;
begin
  if tg_op = 'DELETE' then
    if v_client and old.status <> 'reported' then
      raise exception 'INCIDENT_NOT_DELETABLE';
    end if;
    return old;
  end if;

  if new.occurred_at > now() + interval '5 minutes'
     and (tg_op = 'INSERT' or new.occurred_at is distinct from old.occurred_at) then
    raise exception 'INVALID_INCIDENT_TIME';
  end if;

  if tg_op = 'INSERT' then
    if v_client then
      new.status := 'reported';
      new.resolved_at := null;
      new.closed_at := null;
      new.claim_id := null;
    end if;
    select t.currency into new.currency from public.tenants t where t.id = new.tenant_id;
    new.currency := coalesce(new.currency, 'USD');
    return new;
  end if;

  if v_client and new.currency is distinct from old.currency then
    raise exception 'FORBIDDEN';
  end if;
  if v_client and old.status = 'closed'
     and (to_jsonb(new) - array['notes', 'updated_at', 'updated_by'])
         is distinct from (to_jsonb(old) - array['notes', 'updated_at', 'updated_by']) then
    raise exception 'INCIDENT_LOCKED';
  end if;

  if new.status is distinct from old.status then
    if not ((old.status = 'reported' and new.status in ('investigating', 'resolved'))
            or (old.status = 'investigating' and new.status in ('awaiting_repair', 'resolved'))
            or (old.status = 'awaiting_repair' and new.status = 'resolved')
            or (old.status = 'resolved' and new.status in ('closed', 'investigating'))) then
      raise exception 'ILLEGAL_INCIDENT_TRANSITION';
    end if;
    if new.status = 'resolved' then
      new.resolved_at := now();
    elsif new.status = 'closed' then
      if new.severity in ('major', 'critical') and nullif(btrim(new.root_cause), '') is null then
        raise exception 'INCIDENT_ROOT_CAUSE_REQUIRED';
      end if;
      new.closed_at := now();
    else
      new.resolved_at := null;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function app.incident_guard() from public, anon, authenticated;

create or replace function app.incident_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vehicle text;
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.incident_events (tenant_id, incident_id, status, at, created_by)
    values (new.tenant_id, new.id, new.status, clock_timestamp(), auth.uid());
  end if;

  if tg_op = 'INSERT' then
    perform app.emit_event(new.tenant_id, 'incident.reported', 'incident', new.id,
      jsonb_build_object('incident_id', new.id, 'doc_number', new.doc_number, 'vehicle_id', new.vehicle_id,
        'driver_id', new.driver_id, 'incident_type', new.incident_type, 'severity', new.severity,
        'injuries', new.injuries, 'fatalities', new.fatalities, 'at_fault', new.at_fault,
        'vehicle_drivable', new.vehicle_drivable, 'estimated_damage', new.estimated_damage,
        'occurred_at', new.occurred_at),
      'incident.reported:' || new.id);
  end if;

  if new.severity in ('major', 'critical')
     and (tg_op = 'INSERT' or old.severity not in ('major', 'critical') or old.severity is distinct from new.severity) then
    select v.name into v_vehicle from public.vehicles v where v.id = new.vehicle_id;
    perform app.notify(
      new.tenant_id,
      'managers',
      'incidents.major',
      'critical',
      'incident',
      new.id,
      '/incidents/i/' || new.id,
      jsonb_build_object('doc_number', new.doc_number, 'vehicle', v_vehicle, 'severity', new.severity,
                         'incident_type', new.incident_type, 'injuries', new.injuries, 'fatalities', new.fatalities),
      -- English fallbacks; the SPA localizes by kind + params.
      initcap(new.severity) || ' incident ' || coalesce(new.doc_number, '') || ': ' || coalesce(v_vehicle, ''),
      replace(new.incident_type, '_', ' ') || case when new.injuries > 0 then ', ' || new.injuries || ' injured' else '' end,
      'incidents.major:' || new.id || ':' || new.severity
    );
  end if;
  return null;
end;
$$;
revoke execute on function app.incident_after() from public, anon, authenticated;

create trigger incidents_number
  before insert or update of number, doc_number on public.incidents
  for each row execute function app.assign_doc_number('incident', 'INC');
create trigger incidents_guard before insert or update or delete on public.incidents
  for each row execute function app.incident_guard();
create trigger incidents_stamp_actor before insert or update on public.incidents
  for each row execute function app.stamp_actor();
create trigger incidents_same_tenant
  before insert or update of vehicle_id, driver_id, issue_id, work_order_id on public.incidents
  for each row execute function app.assert_same_tenant('vehicle_id', 'vehicles', 'driver_id', 'drivers',
                                                      'issue_id', 'issues', 'work_order_id', 'work_orders');
create trigger incidents_after after insert or update of status, severity on public.incidents
  for each row execute function app.incident_after();
create trigger incidents_audit after insert or update or delete on public.incidents
  for each row execute function app.log_audit();

-- Parties follow their incident's lock.
create or replace function app.incident_party_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(nullif(current_setting('role', true), ''), 'none') in ('authenticated', 'anon') and pg_trigger_depth() <= 1
     and exists (select 1 from public.incidents i
                 where i.id = case when tg_op = 'DELETE' then old.incident_id else new.incident_id end
                   and i.status = 'closed') then
    raise exception 'INCIDENT_LOCKED';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;
revoke execute on function app.incident_party_guard() from public, anon, authenticated;
create trigger incident_parties_guard before insert or update or delete on public.incident_parties
  for each row execute function app.incident_party_guard();
create trigger incident_parties_stamp_actor before insert or update on public.incident_parties
  for each row execute function app.stamp_actor();
create trigger incident_parties_same_tenant before insert on public.incident_parties
  for each row execute function app.assert_same_tenant('incident_id', 'incidents');
create trigger incident_parties_audit after insert or update or delete on public.incident_parties
  for each row execute function app.log_audit();

-- ============================================================
-- RPCs
-- ============================================================
-- Work order for the damaged vehicle, linked back to the incident.
create or replace function public.incident_create_work_order(p_incident_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('incidents', 'manager');
  v_i public.incidents%rowtype;
  v_wo uuid;
begin
  if not app.module_enabled('maintenance') then
    raise exception 'MODULE_DISABLED';
  end if;
  select * into v_i from public.incidents i where i.id = p_incident_id and i.tenant_id = v_tenant for update;
  if not found then
    raise exception 'INCIDENT_NOT_FOUND';
  end if;
  if v_i.work_order_id is not null then
    raise exception 'INCIDENT_HAS_WORK_ORDER';
  end if;
  if v_i.status = 'closed' then
    raise exception 'INCIDENT_LOCKED';
  end if;
  insert into public.work_orders (vehicle_id, title, description, priority, issue_id)
  values (v_i.vehicle_id,
          left('Repair after incident ' || coalesce(v_i.doc_number, ''), 200),
          v_i.description,
          case v_i.severity when 'critical' then 'critical' when 'major' then 'high' when 'moderate' then 'normal' else 'low' end,
          v_i.issue_id)
  returning id into v_wo;
  update public.incidents set work_order_id = v_wo where id = p_incident_id;
  return v_wo;
end;
$$;
revoke execute on function public.incident_create_work_order(uuid) from public, anon;
grant execute on function public.incident_create_work_order(uuid) to authenticated;

-- claim_id is not client-writable: this links a claim the caller just drafted
-- for this incident (same tenant, pointing back at it).
create or replace function app.incident_link_claim(p_incident_id uuid, p_claim_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  if to_regclass('public.insurance_claims') is null then
    raise exception 'MODULE_DISABLED';
  end if;
  execute 'select exists (select 1 from public.insurance_claims c where c.id = $1 and c.incident_id = $2
                          and c.tenant_id = app.tenant_id())'
    into v_ok using p_claim_id, p_incident_id;
  if not v_ok then
    raise exception 'INCIDENT_NOT_FOUND';
  end if;
  update public.incidents set claim_id = p_claim_id where id = p_incident_id and tenant_id = app.tenant_id();
end;
$$;
revoke execute on function app.incident_link_claim(uuid, uuid) from public, anon;
grant execute on function app.incident_link_claim(uuid, uuid) to authenticated;

-- Draft insurance claim for the incident. insurance_claims belongs to the
-- Insurance module, so it is reached by name at run time.
create or replace function public.incident_create_claim(p_incident_id uuid, p_policy_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('incidents', 'manager');
  v_i public.incidents%rowtype;
  v_tz text;
  v_claim uuid;
begin
  if to_regclass('public.insurance_claims') is null or not app.module_enabled('insurance_mgmt') then
    raise exception 'MODULE_DISABLED';
  end if;
  select * into v_i from public.incidents i where i.id = p_incident_id and i.tenant_id = v_tenant for update;
  if not found then
    raise exception 'INCIDENT_NOT_FOUND';
  end if;
  if v_i.claim_id is not null then
    raise exception 'INCIDENT_HAS_CLAIM';
  end if;
  if v_i.status = 'closed' then
    raise exception 'INCIDENT_LOCKED';
  end if;
  select coalesce(t.timezone, 'UTC') into v_tz from public.tenants t where t.id = v_tenant;
  execute 'insert into public.insurance_claims (policy_id, vehicle_id, incident_id, loss_date, description, amount_claimed)
           values ($1, $2, $3, $4, $5, $6) returning id'
    into v_claim
    using p_policy_id, v_i.vehicle_id, v_i.id, (v_i.occurred_at at time zone v_tz)::date,
          left('Incident ' || coalesce(v_i.doc_number, '') || ': ' || v_i.description, 4000),
          coalesce(v_i.actual_cost, v_i.estimated_damage, 0);
  perform app.incident_link_claim(p_incident_id, v_claim);
  return v_claim;
end;
$$;
revoke execute on function public.incident_create_claim(uuid, uuid) from public, anon;
grant execute on function public.incident_create_claim(uuid, uuid) to authenticated;

-- Insurance claims point back at incidents once both modules are installed.
do $$
begin
  if to_regclass('public.insurance_claims') is not null
     and not exists (select 1 from pg_constraint where conname = 'insurance_claims_incident_id_fkey') then
    alter table public.insurance_claims
      add constraint insurance_claims_incident_id_fkey foreign key (incident_id)
      references public.incidents(id) on delete set null;
  end if;
end;
$$;

-- ============================================================
-- RLS: members read; managers write. The timeline is read-only.
-- ============================================================
set local lock_timeout = '1s';
do $$
declare
  t text;
begin
  foreach t in array array['incidents', 'incident_parties'] loop
    execute format('create policy %1$s_select on public.%1$I for select to authenticated
      using (tenant_id = (select app.tenant_id()) and (select app.module_enabled(''incidents'')))', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated
      with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
                  and (select app.module_enabled(''incidents'')))', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated
      using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
             and (select app.module_enabled(''incidents'')))
      with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
                  and (select app.module_enabled(''incidents'')))', t);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated
      using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
             and (select app.module_enabled(''incidents'')))', t);
  end loop;
end;
$$;
create policy incident_events_select on public.incident_events for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.module_enabled('incidents')));
