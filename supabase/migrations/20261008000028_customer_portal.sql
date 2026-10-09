-- Customer portal (module customer_portal, requires customers): capability
-- links a customer opens without an account, at /portal/:token, and the
-- service requests they send from it.
--
-- 1) customer_portal_access: one row per link (customer, unguessable token,
--    label, active, expires_at, last_accessed_at) with what the link shows:
--    show_vehicles, show_certificates, show_invoices, show_quotes,
--    show_contracts, and whether it can send requests (allow_requests).
--    Managers create, change, revoke and delete links; the token is a
--    secret, so only managers read rows. A new link is a new row.
-- 2) portal_service_requests: numbered SRQ-00001 (doc type
--    'service_request'), sent from the portal only. status new → in_review
--    → scheduled → done; any open status → rejected or done; done and
--    rejected reopen to in_review. Managers triage (status, scheduled_for,
--    internal_notes, handled_by); members read. resolved_at follows
--    done/rejected (ILLEGAL_REQUEST_TRANSITION).
-- 3) public.customer_portal_view(token) and public.customer_portal_request(
--    token, ...) are what the worker calls with the service role
--    (worker/customerPortal.ts), the only path from a token to data. They
--    return whitelisted fields only, each section gated by its flag AND the
--    owning module: vehicles (fleet), certificates (speed_limiters, with the
--    public verify id; the verify endpoint itself is untouched), invoices
--    (billing; issued, part paid and paid only), quotes (sales; sent and
--    accepted, with their public link token), contracts (contracts; active
--    only, read dynamically so this migration does not depend on it) and the
--    customer's recent requests. An inactive, expired or unknown token, or a
--    tenant with the module off, reads as a bad token.
-- 4) A new request notifies managers (customer_portal.request) and emits
--    service_request.created.
--
-- Rate limiting: none, same posture as the public quote link.
-- Raised codes: PORTAL_LINK_INVALID, PORTAL_REQUESTS_DISABLED,
-- PORTAL_REQUEST_INVALID, ILLEGAL_REQUEST_TRANSITION (+ CROSS_TENANT_REFERENCE,
-- FORBIDDEN). Additive only.

set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- ============================================================
-- Tables
-- ============================================================
create table public.customer_portal_access (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  token uuid not null default gen_random_uuid(),
  label text check (label is null or char_length(label) <= 100),
  active boolean not null default true,
  expires_at timestamptz,
  show_vehicles boolean not null default true,
  show_certificates boolean not null default true,
  show_invoices boolean not null default true,
  show_quotes boolean not null default true,
  show_contracts boolean not null default true,
  allow_requests boolean not null default true,
  last_accessed_at timestamptz,
  access_count integer not null default 0,
  revoked_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index customer_portal_access_token_uk on public.customer_portal_access (token);
create index customer_portal_access_tenant_idx on public.customer_portal_access (tenant_id, created_at desc);
create index customer_portal_access_customer_idx on public.customer_portal_access (customer_id);

create table public.portal_service_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  number integer,
  doc_number text,
  customer_id uuid not null references public.customers(id) on delete cascade,
  access_id uuid references public.customer_portal_access(id) on delete set null,
  request_type text not null default 'service'
    check (request_type in ('service', 'inspection', 'installation', 'renewal', 'support', 'other')),
  vehicle_id uuid references public.vehicles(id) on delete set null,
  description text not null check (char_length(btrim(description)) between 1 and 2000),
  preferred_date date,
  contact_name text check (contact_name is null or char_length(contact_name) <= 120),
  contact_phone text check (contact_phone is null or char_length(contact_phone) <= 40),
  status text not null default 'new' check (status in ('new', 'in_review', 'scheduled', 'done', 'rejected')),
  scheduled_for date,
  internal_notes text check (internal_notes is null or char_length(internal_notes) <= 4000),
  handled_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index portal_service_requests_tenant_number_uk on public.portal_service_requests (tenant_id, number);
create unique index portal_service_requests_tenant_doc_number_uk on public.portal_service_requests (tenant_id, doc_number);
create index portal_service_requests_tenant_status_idx on public.portal_service_requests (tenant_id, status, created_at desc);
create index portal_service_requests_customer_idx on public.portal_service_requests (customer_id, created_at desc);
create index portal_service_requests_access_idx on public.portal_service_requests (access_id) where access_id is not null;
create index portal_service_requests_vehicle_idx on public.portal_service_requests (vehicle_id) where vehicle_id is not null;
create index portal_service_requests_handled_by_idx on public.portal_service_requests (handled_by) where handled_by is not null;

alter table public.customer_portal_access enable row level security;
alter table public.portal_service_requests enable row level security;
revoke all on public.customer_portal_access from anon;
revoke all on public.portal_service_requests from anon;
-- The token, stamps and counters are server-side.
revoke insert, update on public.customer_portal_access from authenticated;
grant insert (customer_id, label, expires_at, show_vehicles, show_certificates, show_invoices, show_quotes,
              show_contracts, allow_requests)
  on public.customer_portal_access to authenticated;
grant update (label, active, expires_at, show_vehicles, show_certificates, show_invoices, show_quotes,
              show_contracts, allow_requests)
  on public.customer_portal_access to authenticated;
-- Requests come from the portal; staff only triage them.
revoke insert, update, delete on public.portal_service_requests from authenticated;
grant update (status, scheduled_for, internal_notes, handled_by) on public.portal_service_requests to authenticated;

-- ============================================================
-- Links
-- ============================================================
-- revoked_at follows active; a link's customer and token never change.
create or replace function app.customer_portal_access_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.customer_id is distinct from old.customer_id or new.token is distinct from old.token then
    raise exception 'FORBIDDEN';
  end if;
  if new.active and not old.active then
    new.revoked_at := null;
  elsif not new.active and old.active then
    new.revoked_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function app.customer_portal_access_guard() from public, anon, authenticated;

create trigger customer_portal_access_guard before update on public.customer_portal_access
  for each row execute function app.customer_portal_access_guard();
create trigger customer_portal_access_stamp_actor before insert or update on public.customer_portal_access
  for each row execute function app.stamp_actor();
create trigger customer_portal_access_audit after insert or update or delete on public.customer_portal_access
  for each row execute function app.log_audit();
create trigger customer_portal_access_same_tenant before insert or update of customer_id on public.customer_portal_access
  for each row execute function app.assert_same_tenant('customer_id', 'customers');

-- ============================================================
-- Requests
-- ============================================================
create or replace function app.portal_request_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    if not ((old.status in ('new', 'in_review', 'scheduled') and new.status in ('in_review', 'scheduled', 'done', 'rejected'))
            or (old.status in ('done', 'rejected') and new.status = 'in_review')) then
      raise exception 'ILLEGAL_REQUEST_TRANSITION';
    end if;
    if new.status in ('done', 'rejected') then
      new.resolved_at := now();
    else
      new.resolved_at := null;
    end if;
    -- Whoever first picks it up handles it, unless someone was named.
    if new.handled_by is null and old.handled_by is null then
      new.handled_by := auth.uid();
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function app.portal_request_guard() from public, anon, authenticated;

create trigger portal_service_requests_number
  before insert or update of number, doc_number on public.portal_service_requests
  for each row execute function app.assign_doc_number('service_request', 'SRQ');
create trigger portal_service_requests_guard before update on public.portal_service_requests
  for each row execute function app.portal_request_guard();
create trigger portal_service_requests_stamp_actor before insert or update on public.portal_service_requests
  for each row execute function app.stamp_actor();
create trigger portal_service_requests_same_tenant before insert or update of handled_by on public.portal_service_requests
  for each row execute function app.assert_same_tenant('handled_by', 'profiles');
create trigger portal_service_requests_audit after insert or update or delete on public.portal_service_requests
  for each row execute function app.log_audit();

-- ============================================================
-- Token resolution (service role only)
-- ============================================================
create or replace function app.customer_portal_link(p_token uuid)
returns public.customer_portal_access
language sql
stable
security definer
set search_path = ''
as $$
  select a.*
  from public.customer_portal_access a
  where a.token = p_token
    and a.active
    and (a.expires_at is null or a.expires_at > now())
    and app.tenant_module_enabled(a.tenant_id, 'customer_portal')
$$;
revoke execute on function app.customer_portal_link(uuid) from public, anon, authenticated;

create or replace function public.customer_portal_view(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.customer_portal_access;
  v_today date;
  v_vehicles boolean;
  v_certs boolean;
  v_invoices boolean;
  v_quotes boolean;
  v_contracts boolean;
  v_contract_rows jsonb := '[]'::jsonb;
begin
  select * into v_link from app.customer_portal_link(p_token);
  if v_link.id is null then
    return null;
  end if;

  -- One write per view is enough for "last opened"; skip it within a minute.
  update public.customer_portal_access
     set last_accessed_at = now(), access_count = access_count + 1
   where id = v_link.id
     and (last_accessed_at is null or last_accessed_at < now() - interval '1 minute');

  select (now() at time zone coalesce(t.timezone, 'UTC'))::date into v_today
  from public.tenants t where t.id = v_link.tenant_id;

  v_vehicles := v_link.show_vehicles and app.tenant_module_enabled(v_link.tenant_id, 'fleet');
  v_certs := v_link.show_certificates and app.tenant_module_enabled(v_link.tenant_id, 'speed_limiters');
  v_invoices := v_link.show_invoices and app.tenant_module_enabled(v_link.tenant_id, 'billing');
  v_quotes := v_link.show_quotes and app.tenant_module_enabled(v_link.tenant_id, 'sales');
  v_contracts := v_link.show_contracts and app.tenant_module_enabled(v_link.tenant_id, 'contracts')
                 and to_regclass('public.contracts') is not null;

  if v_contracts then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', c.id, 'doc_number', c.doc_number, 'title', c.title, 'contract_type', c.contract_type,
               'start_date', c.start_date, 'end_date', c.end_date, 'billing_frequency', c.billing_frequency)
             order by c.start_date desc), '[]'::jsonb)
      from (select * from public.contracts
            where tenant_id = $1 and customer_id = $2 and status = 'active'
            order by start_date desc limit 50) c
    $q$ into v_contract_rows using v_link.tenant_id, v_link.customer_id;
  end if;

  return jsonb_build_object(
    'company', (select jsonb_build_object('name', t.name, 'name_ar', t.name_ar, 'phone', t.phone, 'email', t.email,
                                          'address', t.address, 'website', t.website)
                from public.tenants t where t.id = v_link.tenant_id),
    'customer', (select jsonb_build_object('name', cu.name) from public.customers cu where cu.id = v_link.customer_id),
    'today', v_today,
    'sections', jsonb_build_object('vehicles', v_vehicles, 'certificates', v_certs, 'invoices', v_invoices,
                                   'quotes', v_quotes, 'contracts', v_contracts, 'requests', v_link.allow_requests),
    'vehicles', case when v_vehicles then coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', v.id, 'name', v.name, 'license_plate', v.license_plate, 'make', v.make, 'model', v.model,
               'year', v.year, 'ownership', v.ownership)
             order by v.name)
      from (select * from public.vehicles
            where tenant_id = v_link.tenant_id and customer_id = v_link.customer_id
            order by name limit 500) v), '[]'::jsonb) else '[]'::jsonb end,
    'certificates', case when v_certs then coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'certificate_number', c.certificate_number, 'vehicle', v.name,
               'license_plate', v.license_plate, 'issued_at', c.issued_at, 'expires_at', c.expires_at,
               'state', case
                          when c.status = 'revoked' then 'revoked'
                          when c.superseded_by is not null then 'superseded'
                          when c.expires_at is not null and c.expires_at::date < v_today then 'expired'
                          else 'valid'
                        end)
             order by c.issued_at desc)
      from (select * from public.speed_limiter_certificates
            where tenant_id = v_link.tenant_id and customer_id = v_link.customer_id
            order by issued_at desc limit 200) c
      left join public.vehicles v on v.id = c.vehicle_id), '[]'::jsonb) else '[]'::jsonb end,
    'invoices', case when v_invoices then coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'doc_number', i.doc_number, 'title', i.title, 'issue_date', i.issue_date,
               'due_date', i.due_date, 'currency', i.currency, 'total', i.total, 'amount_paid', i.amount_paid,
               'balance', greatest(i.total - i.amount_paid, 0), 'status', i.status)
             order by i.issue_date desc, i.number desc)
      from (select * from public.invoices
            where tenant_id = v_link.tenant_id and customer_id = v_link.customer_id
              and status in ('issued', 'partially_paid', 'paid')
            order by issue_date desc, number desc limit 100) i), '[]'::jsonb) else '[]'::jsonb end,
    'quotes', case when v_quotes then coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', q.id, 'doc_number', q.doc_number, 'title', q.title, 'issue_date', q.issue_date,
               'valid_until', q.valid_until, 'currency', q.currency, 'total', q.total, 'status', q.status,
               'public_token', q.public_token)
             order by q.issue_date desc, q.number desc)
      from (select * from public.quotes
            where tenant_id = v_link.tenant_id and customer_id = v_link.customer_id
              and status in ('sent', 'accepted')
            order by issue_date desc, number desc limit 50) q), '[]'::jsonb) else '[]'::jsonb end,
    'contracts', v_contract_rows,
    'requests', case when v_link.allow_requests then coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'doc_number', r.doc_number, 'request_type', r.request_type, 'status', r.status,
               'created_at', r.created_at, 'scheduled_for', r.scheduled_for, 'vehicle', v.name)
             order by r.created_at desc)
      from (select * from public.portal_service_requests
            where tenant_id = v_link.tenant_id and customer_id = v_link.customer_id
            order by created_at desc limit 20) r
      left join public.vehicles v on v.id = r.vehicle_id), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;
revoke execute on function public.customer_portal_view(uuid) from public, anon, authenticated;
grant execute on function public.customer_portal_view(uuid) to service_role;

create or replace function public.customer_portal_request(
  p_token uuid,
  p_request_type text,
  p_description text,
  p_vehicle_id uuid default null,
  p_preferred_date date default null,
  p_contact_name text default null,
  p_contact_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.customer_portal_access;
  v_req public.portal_service_requests;
  v_customer text;
  v_vehicle text;
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
begin
  select * into v_link from app.customer_portal_link(p_token);
  if v_link.id is null then
    raise exception 'PORTAL_LINK_INVALID';
  end if;
  if not v_link.allow_requests then
    raise exception 'PORTAL_REQUESTS_DISABLED';
  end if;
  if v_description is null or char_length(v_description) > 2000
     or coalesce(p_request_type, '') not in ('service', 'inspection', 'installation', 'renewal', 'support', 'other')
     or char_length(coalesce(p_contact_name, '')) > 120 or char_length(coalesce(p_contact_phone, '')) > 40 then
    raise exception 'PORTAL_REQUEST_INVALID';
  end if;
  if p_vehicle_id is not null then
    select v.name into v_vehicle from public.vehicles v
    where v.id = p_vehicle_id and v.tenant_id = v_link.tenant_id and v.customer_id = v_link.customer_id;
    if v_vehicle is null then
      raise exception 'PORTAL_REQUEST_INVALID';
    end if;
  end if;

  insert into public.portal_service_requests (tenant_id, customer_id, access_id, request_type, vehicle_id, description,
                                              preferred_date, contact_name, contact_phone)
  values (v_link.tenant_id, v_link.customer_id, v_link.id, p_request_type, p_vehicle_id, v_description,
          p_preferred_date, nullif(btrim(coalesce(p_contact_name, '')), ''), nullif(btrim(coalesce(p_contact_phone, '')), ''))
  returning * into v_req;

  begin
    select cu.name into v_customer from public.customers cu where cu.id = v_link.customer_id;
    perform app.notify(
      v_req.tenant_id, 'managers', 'customer_portal.request', 'info', 'service_request', v_req.id,
      '/customer-portal?request=' || v_req.id,
      jsonb_build_object('number', v_req.doc_number, 'customer', v_customer, 'type', v_req.request_type,
                         'vehicle', v_vehicle),
      -- English fallbacks; the SPA localizes by kind + params.
      'New service request ' || coalesce(v_req.doc_number, '') || ' from ' || coalesce(v_customer, ''),
      left(v_description, 200),
      'customer_portal.request:' || v_req.id, null);
    perform app.emit_event(v_req.tenant_id, 'service_request.created', 'service_request', v_req.id,
      jsonb_build_object('id', v_req.id, 'doc_number', v_req.doc_number, 'customer_id', v_req.customer_id,
                         'customer', v_customer, 'request_type', v_req.request_type, 'vehicle_id', v_req.vehicle_id,
                         'vehicle', v_vehicle, 'preferred_date', v_req.preferred_date, 'description', v_description),
      'service_request.created:' || v_req.id);
  exception when others then
    raise warning 'customer_portal_request side effects: % (%)', sqlerrm, sqlstate;
  end;

  return jsonb_build_object('id', v_req.id, 'doc_number', v_req.doc_number, 'status', v_req.status);
end;
$$;
revoke execute on function public.customer_portal_request(uuid, text, text, uuid, date, text, text) from public, anon, authenticated;
grant execute on function public.customer_portal_request(uuid, text, text, uuid, date, text, text) to service_role;

-- ============================================================
-- RLS policies, LAST. Links are a secret: managers only. Requests:
-- members read, managers triage.
-- ============================================================
set local lock_timeout = '1s';

create policy customer_portal_access_select on public.customer_portal_access for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
         and (select app.module_enabled('customer_portal')));
create policy customer_portal_access_insert on public.customer_portal_access for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
              and (select app.module_enabled('customer_portal')));
create policy customer_portal_access_update on public.customer_portal_access for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
         and (select app.module_enabled('customer_portal')))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
              and (select app.module_enabled('customer_portal')));
create policy customer_portal_access_delete on public.customer_portal_access for delete to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
         and (select app.module_enabled('customer_portal')));

create policy portal_service_requests_select on public.portal_service_requests for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.module_enabled('customer_portal')));
create policy portal_service_requests_update on public.portal_service_requests for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
         and (select app.module_enabled('customer_portal')))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
              and (select app.module_enabled('customer_portal')));
