-- Integrations: outbound webhooks.
--
-- 1) webhook_subscriptions (admin-managed, module-gated): an https URL and
--    the event names it wants ('*' = every event). The signing secret lives
--    in webhook_secrets, which no client role can read: it is returned once
--    by create_webhook_subscription / rotate_webhook_secret and read by the
--    worker through claim_webhook_deliveries (service role only).
-- 2) webhook_deliveries: the outbox. One row per (subscription, event),
--    filled by app.on_event_webhooks, which app.emit_event dispatches to
--    (the dispatcher shipped with workflow automation, 20261008000006), and
--    by app.enqueue_webhook (the automation "webhook" action).
-- 3) The worker (POST /api/integrations/dispatch) claims due rows with a
--    2-minute lease, signs and posts them, and reports each attempt through
--    record_webhook_attempt, which owns the state machine: delivered, or
--    retry with backoff 1/4/16/64/256 minutes, or failed after 6 attempts
--    (admins are notified once per subscription per day).
--
-- Raised codes: WEBHOOK_INVALID_NAME, WEBHOOK_INVALID_URL,
-- WEBHOOK_INVALID_EVENTS, WEBHOOK_NOT_FOUND, WEBHOOK_DELIVERY_NOT_FOUND.
-- Additive only; nothing here touches an existing table.

set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- ============================================================
-- 1) Validation helpers
-- ============================================================
create or replace function app.valid_webhook_url(p_url text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  -- https only, no credentials, no local or private-network hosts. The
  -- worker repeats this check (shared/webhooks.ts) right before each call.
  select p_url is not null
     and char_length(p_url) between 12 and 2000
     and p_url ~ '^https://[^/?#@\s]+(/[^\s]*)?$'
     and lower(split_part(split_part(substr(p_url, 9), '/', 1), ':', 1)) !~
         '^(localhost|.*\.localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\..*|10\..*|192\.168\..*|169\.254\..*|172\.(1[6-9]|2[0-9]|3[01])\..*|\[.*)$';
$$;

create or replace function app.valid_webhook_events(p_events text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_events is not null
     and cardinality(p_events) between 1 and 50
     and not exists (
       select 1 from unnest(p_events) as e
       where e is null or e !~ '^([a-z][a-z_]*\.[a-z][a-z_]*|\*)$'
     );
$$;

-- ============================================================
-- 2) Tables
-- ============================================================
create table public.webhook_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  url text not null check (app.valid_webhook_url(url)),
  events text[] not null check (app.valid_webhook_events(events)),
  active boolean not null default true,
  failure_count integer not null default 0,
  last_delivery_at timestamptz,
  last_success_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index webhook_subscriptions_tenant_idx on public.webhook_subscriptions (tenant_id, created_at desc);

create table public.webhook_secrets (
  subscription_id uuid primary key references public.webhook_subscriptions(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  secret text not null check (secret ~ '^whsec_[0-9a-f]{48}$'),
  rotated_at timestamptz not null default now()
);

create table public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  subscription_id uuid not null references public.webhook_subscriptions(id) on delete cascade,
  event_id bigint references public.domain_events(id) on delete set null,
  event text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  response_code integer,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index webhook_deliveries_subscription_event_uk
  on public.webhook_deliveries (subscription_id, event_id) where event_id is not null;
create index webhook_deliveries_due_idx
  on public.webhook_deliveries (tenant_id, next_attempt_at) where status = 'pending';
create index webhook_deliveries_tenant_created_idx on public.webhook_deliveries (tenant_id, created_at desc);
create index webhook_deliveries_subscription_idx on public.webhook_deliveries (subscription_id, created_at desc);
create index webhook_deliveries_event_idx on public.webhook_deliveries (event_id) where event_id is not null;

alter table public.webhook_subscriptions enable row level security;
alter table public.webhook_secrets enable row level security;
alter table public.webhook_deliveries enable row level security;

-- Clients create subscriptions through the RPC (it mints the secret) and may
-- only edit these four columns; counters and the outbox are server-written.
revoke all on public.webhook_subscriptions from anon;
revoke insert, update, truncate on public.webhook_subscriptions from authenticated;
grant update (name, url, events, active) on public.webhook_subscriptions to authenticated;
revoke all on public.webhook_secrets from anon, authenticated;
revoke all on public.webhook_deliveries from anon;
revoke insert, update, delete, truncate on public.webhook_deliveries from authenticated;

-- Edits by people bump updated_at / actor / audit; delivery bookkeeping
-- (failure_count, last_*_at) does not.
create trigger webhook_subscriptions_updated_at
  before update of name, url, events, active on public.webhook_subscriptions
  for each row execute function app.set_updated_at();
create trigger webhook_subscriptions_stamp_actor
  before insert or update of name, url, events, active on public.webhook_subscriptions
  for each row execute function app.stamp_actor();
create trigger webhook_subscriptions_audit
  after insert or delete or update of name, url, events, active on public.webhook_subscriptions
  for each row execute function app.log_audit();

-- ============================================================
-- 3) Enqueueing
-- ============================================================
create or replace function app.webhook_envelope(p_event public.domain_events)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_event.id,
    'event', p_event.event,
    'entity_type', p_event.entity_type,
    'entity_id', p_event.entity_id,
    'occurred_at', p_event.occurred_at,
    'data', p_event.payload
  );
$$;

-- The automation "webhook" action. Returns the delivery id, or null when the
-- subscription is paused or already has this event.
create or replace function app.enqueue_webhook(p_subscription uuid, p_event bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.domain_events;
  v_active boolean;
  v_id uuid;
begin
  select * into v_event from public.domain_events where id = p_event;
  if not found then
    raise exception 'WEBHOOK_NOT_FOUND: event %', p_event;
  end if;
  if not app.tenant_module_enabled(v_event.tenant_id, 'integrations') then
    raise exception 'MODULE_DISABLED: integrations';
  end if;
  select active into v_active
  from public.webhook_subscriptions
  where id = p_subscription and tenant_id = v_event.tenant_id;
  if not found then
    raise exception 'WEBHOOK_NOT_FOUND: subscription %', p_subscription;
  end if;
  if not v_active then
    return null;
  end if;
  insert into public.webhook_deliveries (tenant_id, subscription_id, event_id, event, payload)
  values (v_event.tenant_id, p_subscription, v_event.id, v_event.event, app.webhook_envelope(v_event))
  on conflict (subscription_id, event_id) where event_id is not null do nothing
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function app.enqueue_webhook(uuid, bigint) from public, anon, authenticated;

-- Called by app.emit_event for every stored event.
create or replace function app.on_event_webhooks(p_event bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.domain_events;
begin
  select * into v_event from public.domain_events where id = p_event;
  if not found or not app.tenant_module_enabled(v_event.tenant_id, 'integrations') then
    return;
  end if;
  insert into public.webhook_deliveries (tenant_id, subscription_id, event_id, event, payload)
  select v_event.tenant_id, s.id, v_event.id, v_event.event, app.webhook_envelope(v_event)
  from public.webhook_subscriptions s
  where s.tenant_id = v_event.tenant_id
    and s.active
    and (v_event.event = any (s.events) or '*' = any (s.events))
  on conflict (subscription_id, event_id) where event_id is not null do nothing;
end;
$$;
revoke execute on function app.on_event_webhooks(bigint) from public, anon, authenticated;

-- ============================================================
-- 4) Admin RPCs
-- ============================================================
create or replace function app.new_webhook_secret()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'whsec_' || encode(extensions.gen_random_bytes(24), 'hex');
$$;
revoke execute on function app.new_webhook_secret() from public, anon, authenticated;

create or replace function public.create_webhook_subscription(p_name text, p_url text, p_events text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('integrations', 'admin');
  v_events text[];
  v_id uuid;
  v_secret text := app.new_webhook_secret();
begin
  if p_name is null or char_length(btrim(p_name)) not between 1 and 100 then
    raise exception 'WEBHOOK_INVALID_NAME';
  end if;
  if not app.valid_webhook_url(btrim(p_url)) then
    raise exception 'WEBHOOK_INVALID_URL';
  end if;
  select array_agg(distinct e order by e) into v_events from unnest(p_events) as e;
  if not app.valid_webhook_events(v_events) then
    raise exception 'WEBHOOK_INVALID_EVENTS';
  end if;
  insert into public.webhook_subscriptions (tenant_id, name, url, events)
  values (v_tenant, btrim(p_name), btrim(p_url), v_events)
  returning id into v_id;
  insert into public.webhook_secrets (subscription_id, tenant_id, secret) values (v_id, v_tenant, v_secret);
  return jsonb_build_object('id', v_id, 'secret', v_secret); -- the only time the secret is shown
end;
$$;

create or replace function public.rotate_webhook_secret(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('integrations', 'admin');
  v_secret text := app.new_webhook_secret();
begin
  update public.webhook_secrets
     set secret = v_secret, rotated_at = now()
   where subscription_id = p_id and tenant_id = v_tenant;
  if not found then
    raise exception 'WEBHOOK_NOT_FOUND';
  end if;
  return v_secret;
end;
$$;

-- Queues a "webhook.test" delivery so an admin can check their endpoint.
create or replace function public.send_test_webhook(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('integrations', 'admin');
  v_id uuid;
begin
  if not exists (select 1 from public.webhook_subscriptions where id = p_id and tenant_id = v_tenant) then
    raise exception 'WEBHOOK_NOT_FOUND';
  end if;
  insert into public.webhook_deliveries (tenant_id, subscription_id, event, payload)
  values (v_tenant, p_id, 'webhook.test',
          jsonb_build_object('id', null, 'event', 'webhook.test', 'entity_type', null, 'entity_id', null,
                             'occurred_at', now(), 'data', jsonb_build_object('message', 'Test delivery from FleetMaster')))
  returning id into v_id;
  return v_id;
end;
$$;

-- Puts a failed (or stuck) delivery back in the queue with a fresh budget.
create or replace function public.retry_webhook_delivery(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('integrations', 'admin');
begin
  update public.webhook_deliveries
     set status = 'pending', attempts = 0, next_attempt_at = now()
   where id = p_id and tenant_id = v_tenant and status <> 'delivered';
  if not found then
    raise exception 'WEBHOOK_DELIVERY_NOT_FOUND';
  end if;
end;
$$;

revoke execute on function public.create_webhook_subscription(text, text, text[]) from public, anon;
revoke execute on function public.rotate_webhook_secret(uuid) from public, anon;
revoke execute on function public.send_test_webhook(uuid) from public, anon;
revoke execute on function public.retry_webhook_delivery(uuid) from public, anon;
grant execute on function public.create_webhook_subscription(text, text, text[]) to authenticated;
grant execute on function public.rotate_webhook_secret(uuid) to authenticated;
grant execute on function public.send_test_webhook(uuid) to authenticated;
grant execute on function public.retry_webhook_delivery(uuid) to authenticated;

-- ============================================================
-- 5) Worker RPCs (service role only)
-- ============================================================
create or replace function app.webhook_backoff(p_attempts integer)
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '1 minute' * power(4, greatest(p_attempts, 1) - 1);
$$;

-- Claims up to p_limit due deliveries of one tenant. The lease (next attempt
-- pushed 2 minutes out) keeps a concurrent dispatcher off the same rows; a
-- worker that dies mid-call leaves them to be retried after the lease.
create or replace function public.claim_webhook_deliveries(p_tenant uuid, p_limit integer default 20)
returns table (id uuid, url text, secret text, event text, payload jsonb, attempts integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.tenant_module_enabled(p_tenant, 'integrations') then
    return;
  end if;
  return query
  with due as (
    select d.id
    from public.webhook_deliveries d
    join public.webhook_subscriptions s on s.id = d.subscription_id
    where d.tenant_id = p_tenant
      and d.status = 'pending'
      and d.next_attempt_at <= now()
      and s.active
    order by d.next_attempt_at
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
    for update of d skip locked
  ), leased as (
    update public.webhook_deliveries d
       set next_attempt_at = now() + interval '2 minutes'
      from due
     where d.id = due.id
    returning d.id, d.subscription_id, d.event, d.payload, d.attempts
  )
  select l.id, s.url, k.secret, l.event, l.payload, l.attempts
  from leased l
  join public.webhook_subscriptions s on s.id = l.subscription_id
  join public.webhook_secrets k on k.subscription_id = l.subscription_id;
end;
$$;

create or replace function public.record_webhook_attempt(
  p_id uuid,
  p_ok boolean,
  p_response_code integer default null,
  p_error text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.webhook_deliveries;
  v_name text;
  v_status text;
begin
  select * into d from public.webhook_deliveries where id = p_id for update;
  if not found or d.status <> 'pending' then
    return null;
  end if;
  d.attempts := d.attempts + 1;
  v_status := case when p_ok then 'delivered' when d.attempts >= 6 then 'failed' else 'pending' end;

  update public.webhook_deliveries
     set attempts = d.attempts,
         status = v_status,
         last_attempt_at = now(),
         response_code = p_response_code,
         last_error = case when p_ok then null else left(p_error, 500) end,
         delivered_at = case when p_ok then now() end,
         next_attempt_at = case when v_status = 'pending' then now() + app.webhook_backoff(d.attempts)
                                else next_attempt_at end
   where id = p_id;

  update public.webhook_subscriptions
     set failure_count = case when p_ok then 0 else failure_count + 1 end,
         last_delivery_at = now(),
         last_success_at = case when p_ok then now() else last_success_at end
   where id = d.subscription_id
  returning name into v_name;

  if v_status = 'failed' then
    begin
      perform app.notify(
        d.tenant_id, 'admins', 'integrations.webhook_failed', 'warning',
        'webhook_subscription', d.subscription_id, '/integrations/deliveries',
        jsonb_build_object('name', v_name, 'event', d.event, 'code', p_response_code, 'error', left(p_error, 200)),
        'Webhook delivery failed: ' || coalesce(v_name, ''),
        d.event || coalesce(' (' || p_response_code || ')', ''),
        'webhook_failed:' || d.subscription_id || ':' || to_char(now(), 'YYYY-MM-DD'));
    exception when others then
      raise warning 'record_webhook_attempt: notify failed: %', sqlerrm;
    end;
  end if;
  return v_status;
end;
$$;

revoke execute on function public.claim_webhook_deliveries(uuid, integer) from public, anon, authenticated;
revoke execute on function public.record_webhook_attempt(uuid, boolean, integer, text) from public, anon, authenticated;
grant execute on function public.claim_webhook_deliveries(uuid, integer) to service_role;
grant execute on function public.record_webhook_attempt(uuid, boolean, integer, text) to service_role;

-- ============================================================
-- 6) RLS policies, LAST (each CREATE POLICY locks auth/storage tables).
-- ============================================================
set local lock_timeout = '1s';

create policy webhook_subscriptions_select on public.webhook_subscriptions for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_admin())
         and (select app.module_enabled('integrations')));
create policy webhook_subscriptions_update on public.webhook_subscriptions for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_admin())
         and (select app.module_enabled('integrations')))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_admin())
              and (select app.module_enabled('integrations')));
create policy webhook_subscriptions_delete on public.webhook_subscriptions for delete to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_admin())
         and (select app.module_enabled('integrations')));
create policy webhook_deliveries_select on public.webhook_deliveries for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_admin())
         and (select app.module_enabled('integrations')));
-- webhook_secrets: RLS on, no policy, no grants. Service role only.
