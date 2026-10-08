-- Workflow automation: "when <event> happens and <conditions>, do <actions>".
--
-- 1) automation_rules (manager-written, module-gated) and automation_runs
--    (server-written log, one row per rule evaluated against an event).
-- 2) A dispatcher inside app.emit_event. The foundation version stored the
--    event and returned. This version (same signature, same return, same
--    module gate) stores it exactly as before and then calls every function
--    named app.on_event_<suffix>(bigint) that exists, each in its own
--    exception block, in name order. This migration ships
--    app.on_event_automation; the integrations module adds its own
--    (webhook deliveries) without touching emit_event again. For a tenant
--    with neither module on, emit_event still returns null before doing
--    anything, so nothing changes for them.
-- 3) app.run_automation_rules: evaluates a tenant's active rules for one
--    event. Conditions are compared against the event payload; actions are
--    notify (app.notify), create_issue (an issue on the payload's vehicle)
--    and webhook (only when the integrations module has shipped
--    app.enqueue_webhook). Every rule runs in its own exception block, so a
--    failing rule is logged and the write that raised the event never fails.
--    Actions can raise events of their own (create_issue → issue.created);
--    those are stored but do not run rules again (no loops).
-- 4) public.test_automation_rule: dry-run conditions against a sample payload.
-- 5) Event triggers on existing tables (production-safety rule §0.2: AFTER,
--    no-op unless workflow_automation or integrations is on, exception-safe):
--    vehicle.created, customer.created, issue.created, issue.resolved,
--    work_order.completed, inspection.failed, renewal.completed,
--    invoice.issued, payment.received, certificate.issued.
--
-- Raised codes: AUTOMATION_INVALID_RULE.
-- Additive only. The emit_event replacement keeps the foundation behavior
-- byte-for-byte up to the new dispatch call.

set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- ============================================================
-- 1) Tables
-- ============================================================
create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  description text,
  event text not null check (event ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$'),
  conditions jsonb not null default '[]'::jsonb check (jsonb_typeof(conditions) = 'array'),
  actions jsonb not null default '[]'::jsonb check (jsonb_typeof(actions) = 'array'),
  active boolean not null default true,
  run_count integer not null default 0,
  last_run_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index automation_rules_tenant_event_idx on public.automation_rules (tenant_id, event) where active;
create index automation_rules_tenant_name_idx on public.automation_rules (tenant_id, name);

create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  rule_id uuid not null references public.automation_rules(id) on delete cascade,
  event_id bigint references public.domain_events(id) on delete set null,
  event text not null,
  status text not null check (status in ('success', 'skipped', 'failed')),
  actions_run integer not null default 0,
  detail text,
  created_at timestamptz not null default now()
);
create index automation_runs_tenant_created_idx on public.automation_runs (tenant_id, created_at desc);
create index automation_runs_rule_created_idx on public.automation_runs (rule_id, created_at desc);
create index automation_runs_event_idx on public.automation_runs (event_id);

alter table public.automation_rules enable row level security;
alter table public.automation_runs enable row level security;

-- Run bookkeeping (run_count, last_run_at) is not an edit: no stamp, no audit.
create trigger automation_rules_updated_at
  before update of name, description, event, conditions, actions, active on public.automation_rules
  for each row execute function app.set_updated_at();
create trigger automation_rules_stamp_actor
  before insert or update of name, description, event, conditions, actions, active on public.automation_rules
  for each row execute function app.stamp_actor();
create trigger automation_rules_audit
  after insert or delete or update of name, description, event, conditions, actions, active
  on public.automation_rules
  for each row execute function app.log_audit();

-- Shape check: what the engine can run is what the table accepts.
create or replace function app.validate_automation_rule()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  c jsonb;
  a jsonb;
begin
  if jsonb_array_length(new.conditions) > 20 then
    raise exception 'AUTOMATION_INVALID_RULE: too many conditions';
  end if;
  for c in select value from jsonb_array_elements(new.conditions) loop
    if jsonb_typeof(c) <> 'object'
       or coalesce(btrim(c ->> 'field'), '') = ''
       or coalesce(c ->> 'op', '') not in ('eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'in', 'exists')
       or (c ->> 'op' = 'in' and jsonb_typeof(c -> 'value') <> 'array') then
      raise exception 'AUTOMATION_INVALID_RULE: condition %', c;
    end if;
  end loop;

  if jsonb_array_length(new.actions) = 0 or jsonb_array_length(new.actions) > 10 then
    raise exception 'AUTOMATION_INVALID_RULE: a rule needs 1 to 10 actions';
  end if;
  for a in select value from jsonb_array_elements(new.actions) loop
    if jsonb_typeof(a) <> 'object' then
      raise exception 'AUTOMATION_INVALID_RULE: action %', a;
    end if;
    case a ->> 'type'
      when 'notify' then
        if coalesce(a ->> 'audience', '') not in ('managers', 'admins', 'all')
           or coalesce(a ->> 'severity', 'info') not in ('info', 'warning', 'critical')
           or char_length(btrim(coalesce(a ->> 'message', ''))) not between 1 and 500 then
          raise exception 'AUTOMATION_INVALID_RULE: notify %', a;
        end if;
      when 'create_issue' then
        if char_length(btrim(coalesce(a ->> 'title', ''))) not between 1 and 200
           or coalesce(a ->> 'priority', 'normal') not in ('low', 'normal', 'high', 'critical') then
          raise exception 'AUTOMATION_INVALID_RULE: create_issue %', a;
        end if;
      when 'webhook' then
        if coalesce(a ->> 'subscription_id', '') !~ '^[0-9a-f-]{36}$' then
          raise exception 'AUTOMATION_INVALID_RULE: webhook %', a;
        end if;
      else
        raise exception 'AUTOMATION_INVALID_RULE: action type %', a ->> 'type';
    end case;
  end loop;
  return new;
end;
$$;
revoke execute on function app.validate_automation_rule() from public, anon, authenticated;

-- run_count / last_run_at belong to the engine: a client insert or update
-- cannot set them (the engine marks itself with app.automation_running).
create or replace function app.protect_automation_counters()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.automation_running', true), '') <> 'on' then
    if tg_op = 'INSERT' then
      new.run_count := 0;
      new.last_run_at := null;
    else
      new.run_count := old.run_count;
      new.last_run_at := old.last_run_at;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function app.protect_automation_counters() from public, anon, authenticated;

create trigger automation_rules_protect_counters
  before insert or update on public.automation_rules
  for each row execute function app.protect_automation_counters();

create trigger automation_rules_validate
  before insert or update of conditions, actions on public.automation_rules
  for each row execute function app.validate_automation_rule();

-- ============================================================
-- 2) Condition evaluation (pure)
-- ============================================================
-- A payload value by dotted path ("vehicle.status" → payload #> {vehicle,status}).
create or replace function app.automation_value(p_payload jsonb, p_field text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select p_payload #> string_to_array(btrim(p_field), '.');
$$;

-- Equality with numeric awareness: "5" = 5, "5.0" = 5.
create or replace function app.automation_equals(p_a jsonb, p_b jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_a is null or p_b is null or jsonb_typeof(p_a) = 'null' or jsonb_typeof(p_b) = 'null' then false
    when (p_a #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$' and (p_b #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$'
      then (p_a #>> '{}')::numeric = (p_b #>> '{}')::numeric
    else lower(p_a #>> '{}') = lower(p_b #>> '{}')
  end;
$$;

-- -1 / 0 / 1, numeric when both sides are numbers, else text; null if either side is missing.
create or replace function app.automation_compare(p_a jsonb, p_b jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_a is null or p_b is null or jsonb_typeof(p_a) = 'null' or jsonb_typeof(p_b) = 'null' then null
    when (p_a #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$' and (p_b #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$'
      then sign((p_a #>> '{}')::numeric - (p_b #>> '{}')::numeric)::integer
    when (p_a #>> '{}') < (p_b #>> '{}') then -1
    when (p_a #>> '{}') > (p_b #>> '{}') then 1
    else 0
  end;
$$;

create or replace function app.automation_condition_match(p_condition jsonb, p_payload jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v jsonb := app.automation_value(p_payload, p_condition ->> 'field');
  target jsonb := p_condition -> 'value';
  op text := p_condition ->> 'op';
begin
  case op
    when 'exists' then
      return v is not null and jsonb_typeof(v) <> 'null' and coalesce(v #>> '{}', '') <> '';
    when 'eq' then
      return app.automation_equals(v, target);
    when 'neq' then
      return not app.automation_equals(v, target);
    when 'gt' then
      return coalesce(app.automation_compare(v, target) > 0, false);
    when 'gte' then
      return coalesce(app.automation_compare(v, target) >= 0, false);
    when 'lt' then
      return coalesce(app.automation_compare(v, target) < 0, false);
    when 'lte' then
      return coalesce(app.automation_compare(v, target) <= 0, false);
    when 'contains' then
      if v is null or target is null then
        return false;
      elsif jsonb_typeof(v) = 'array' then
        return exists (select 1 from jsonb_array_elements(v) e where app.automation_equals(e, target));
      else
        return position(lower(target #>> '{}') in lower(coalesce(v #>> '{}', ''))) > 0;
      end if;
    when 'in' then
      return jsonb_typeof(target) = 'array'
        and exists (select 1 from jsonb_array_elements(target) e where app.automation_equals(v, e));
    else
      return false;
  end case;
end;
$$;

create or replace function app.automation_conditions_match(p_conditions jsonb, p_payload jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(app.automation_condition_match(c, p_payload)), true)
  from jsonb_array_elements(coalesce(p_conditions, '[]'::jsonb)) c;
$$;

-- "{name} needs attention" → "Truck 7 needs attention". Unknown fields render empty.
create or replace function app.automation_render(p_template text, p_payload jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out text := coalesce(p_template, '');
  m text[];
begin
  for m in select regexp_matches(coalesce(p_template, ''), '\{([a-zA-Z0-9_.]+)\}', 'g') loop
    v_out := replace(v_out, '{' || m[1] || '}', coalesce(app.automation_value(p_payload, m[1]) #>> '{}', ''));
  end loop;
  return left(v_out, 500);
end;
$$;

revoke execute on function app.automation_value(jsonb, text) from public, anon;
revoke execute on function app.automation_equals(jsonb, jsonb) from public, anon;
revoke execute on function app.automation_compare(jsonb, jsonb) from public, anon;
revoke execute on function app.automation_condition_match(jsonb, jsonb) from public, anon;
revoke execute on function app.automation_conditions_match(jsonb, jsonb) from public, anon;
revoke execute on function app.automation_render(text, jsonb) from public, anon;

-- ============================================================
-- 3) The engine
-- ============================================================
create or replace function app.run_automation_rules(p_event bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.domain_events%rowtype;
  v_rule public.automation_rules%rowtype;
  v_action jsonb;
  v_actions integer;
  v_total integer := 0;
  v_vehicle uuid;
  v_title text;
begin
  select * into v_event from public.domain_events where id = p_event;
  if not found or not app.tenant_module_enabled(v_event.tenant_id, 'workflow_automation') then
    return 0;
  end if;
  -- An action that raises an event of its own must not run rules again.
  if coalesce(current_setting('app.automation_running', true), '') = 'on' then
    return 0;
  end if;
  perform set_config('app.automation_running', 'on', true);

  for v_rule in
    select * from public.automation_rules r
    where r.tenant_id = v_event.tenant_id and r.active and r.event = v_event.event
    order by r.created_at, r.id
  loop
    begin
      if not app.automation_conditions_match(v_rule.conditions, v_event.payload) then
        insert into public.automation_runs (tenant_id, rule_id, event_id, event, status, detail)
        values (v_event.tenant_id, v_rule.id, v_event.id, v_event.event, 'skipped', 'conditions not met');
        continue;
      end if;

      v_actions := 0;
      for v_action in select value from jsonb_array_elements(v_rule.actions) loop
        case v_action ->> 'type'
          when 'notify' then
            perform app.notify(
              v_event.tenant_id,
              v_action ->> 'audience',
              'automation.rule',
              coalesce(v_action ->> 'severity', 'info'),
              v_event.entity_type,
              v_event.entity_id,
              '/automation/rules/' || v_rule.id,
              jsonb_build_object('rule', v_rule.name, 'rule_id', v_rule.id, 'event', v_event.event,
                                 'message', app.automation_render(v_action ->> 'message', v_event.payload)),
              app.automation_render(v_action ->> 'message', v_event.payload),
              v_rule.name,
              'automation.rule:' || v_rule.id || ':' || v_event.id || ':' || v_actions);
          when 'create_issue' then
            if not app.tenant_module_enabled(v_event.tenant_id, 'issues') then
              raise exception 'the issues module is off';
            end if;
            v_vehicle := case when (v_event.payload ->> 'vehicle_id') ~ '^[0-9a-f-]{36}$'
                              then (v_event.payload ->> 'vehicle_id')::uuid end;
            if v_vehicle is null or not exists (
              select 1 from public.vehicles v where v.id = v_vehicle and v.tenant_id = v_event.tenant_id) then
              raise exception 'the event has no vehicle to raise an issue on';
            end if;
            v_title := nullif(btrim(app.automation_render(v_action ->> 'title', v_event.payload)), '');
            insert into public.issues (tenant_id, vehicle_id, title, priority, description)
            values (v_event.tenant_id, v_vehicle, left(coalesce(v_title, v_rule.name), 200),
                    coalesce(v_action ->> 'priority', 'normal'),
                    'Raised by automation rule "' || v_rule.name || '" on ' || v_event.event || '.');
          when 'webhook' then
            if to_regprocedure('app.enqueue_webhook(uuid,bigint)') is null then
              raise exception 'webhooks need the integrations module';
            end if;
            execute 'select app.enqueue_webhook($1, $2)'
              using (v_action ->> 'subscription_id')::uuid, v_event.id;
          else
            raise exception 'unknown action %', v_action ->> 'type';
        end case;
        v_actions := v_actions + 1;
      end loop;

      insert into public.automation_runs (tenant_id, rule_id, event_id, event, status, actions_run)
      values (v_event.tenant_id, v_rule.id, v_event.id, v_event.event, 'success', v_actions);
      update public.automation_rules
         set run_count = run_count + 1, last_run_at = now()
       where id = v_rule.id;
      v_total := v_total + 1;
    exception when others then
      -- The block rolled back this rule's actions; record why, keep going.
      insert into public.automation_runs (tenant_id, rule_id, event_id, event, status, detail)
      values (v_event.tenant_id, v_rule.id, v_event.id, v_event.event, 'failed', left(sqlerrm, 500));
    end;
  end loop;

  perform set_config('app.automation_running', '', true);
  return v_total;
exception when others then
  perform set_config('app.automation_running', '', true);
  raise warning 'run_automation_rules: % (%)', sqlerrm, sqlstate;
  return v_total;
end;
$$;
revoke execute on function app.run_automation_rules(bigint) from public, anon, authenticated;

create or replace function app.on_event_automation(p_event bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.run_automation_rules(p_event);
end;
$$;
revoke execute on function app.on_event_automation(bigint) from public, anon, authenticated;

-- Same signature, return and module gate as the foundation version; the
-- dispatch loop after the insert is the only addition.
create or replace function app.emit_event(
  p_tenant uuid,
  p_event text,
  p_entity_type text,
  p_entity_id uuid,
  p_payload jsonb,
  p_dedupe_key text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_fn text;
begin
  if p_tenant is null or p_event is null then
    return null;
  end if;
  if not (app.tenant_module_enabled(p_tenant, 'workflow_automation')
          or app.tenant_module_enabled(p_tenant, 'integrations')) then
    return null;
  end if;
  insert into public.domain_events (tenant_id, event, entity_type, entity_id, payload, actor, dedupe_key)
  values (p_tenant, p_event, p_entity_type, p_entity_id, coalesce(p_payload, '{}'::jsonb),
          auth.uid(), p_dedupe_key)
  on conflict (tenant_id, dedupe_key) where dedupe_key is not null
  do nothing
  returning id into v_id;

  if v_id is not null then
    for v_fn in
      select p.proname
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app'
        and p.proname like 'on\_event\_%'
        and pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_event bigint'
      order by p.proname
    loop
      begin
        execute format('select app.%I($1)', v_fn) using v_id;
      exception when others then
        raise warning 'emit_event: app.% failed: % (%)', v_fn, sqlerrm, sqlstate;
      end;
    end loop;
  end if;
  return v_id;
end;
$$;
revoke execute on function app.emit_event(uuid, text, text, uuid, jsonb, text)
  from public, anon, authenticated;

-- ============================================================
-- 4) Dry run for the rule builder
-- ============================================================
create or replace function public.test_automation_rule(p_conditions jsonb, p_payload jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if app.tenant_id() is null or not app.is_manager() or not app.module_enabled('workflow_automation') then
    raise exception 'FORBIDDEN';
  end if;
  if jsonb_typeof(coalesce(p_conditions, '[]'::jsonb)) <> 'array' then
    raise exception 'AUTOMATION_INVALID_RULE: conditions must be a list';
  end if;
  return jsonb_build_object(
    'matched', app.automation_conditions_match(p_conditions, coalesce(p_payload, '{}'::jsonb)),
    'conditions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'field', c ->> 'field',
               'op', c ->> 'op',
               'actual', app.automation_value(coalesce(p_payload, '{}'::jsonb), c ->> 'field'),
               'matched', app.automation_condition_match(c, coalesce(p_payload, '{}'::jsonb)))
             order by ord)
      from jsonb_array_elements(coalesce(p_conditions, '[]'::jsonb)) with ordinality as x(c, ord)
    ), '[]'::jsonb));
end;
$$;
revoke execute on function public.test_automation_rule(jsonb, jsonb) from public, anon;
grant execute on function public.test_automation_rule(jsonb, jsonb) to authenticated;

-- ============================================================
-- 5) Event triggers on existing tables (AFTER, gated, exception-safe)
-- ============================================================
create or replace function app.trg_automation_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event text;
  v_payload jsonb;
  v_dedupe text;
begin
  if not (app.tenant_module_enabled(new.tenant_id, 'workflow_automation')
          or app.tenant_module_enabled(new.tenant_id, 'integrations')) then
    return null;
  end if;

  begin
    case tg_table_name
      when 'vehicles' then
        v_event := 'vehicle.created';
        v_payload := jsonb_build_object('vehicle_id', new.id, 'name', new.name, 'license_plate', new.license_plate,
          'vehicle_type', new.vehicle_type, 'status', new.status, 'make', new.make, 'model', new.model,
          'year', new.year, 'ownership', new.ownership, 'customer_id', new.customer_id, 'branch_id', new.branch_id);
        v_dedupe := v_event || ':' || new.id;
      when 'customers' then
        v_event := 'customer.created';
        v_payload := jsonb_build_object('customer_id', new.id, 'name', new.name, 'status', new.status,
          'city', new.city, 'country', new.country);
        v_dedupe := v_event || ':' || new.id;
      when 'issues' then
        if tg_op = 'INSERT' then
          v_event := 'issue.created';
          v_dedupe := v_event || ':' || new.id;
        elsif new.status in ('resolved', 'closed') and old.status not in ('resolved', 'closed') then
          v_event := 'issue.resolved';
        else
          return null;
        end if;
        v_payload := jsonb_build_object('issue_id', new.id, 'vehicle_id', new.vehicle_id, 'title', new.title,
          'status', new.status, 'priority', new.priority, 'source', new.source);
      when 'work_orders' then
        if not (new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'completed')) then
          return null;
        end if;
        v_event := 'work_order.completed';
        v_payload := jsonb_build_object('work_order_id', new.id, 'number', new.number, 'vehicle_id', new.vehicle_id,
          'title', new.title, 'priority', new.priority, 'odometer', new.odometer);
      when 'inspections' then
        if not (new.status = 'fail' and (tg_op = 'INSERT' or old.status is distinct from 'fail')) then
          return null;
        end if;
        v_event := 'inspection.failed';
        v_payload := jsonb_build_object('inspection_id', new.id, 'vehicle_id', new.vehicle_id,
          'driver_id', new.driver_id, 'odometer', new.odometer);
      when 'renewals' then
        if not (new.completed_at is not null and (tg_op = 'INSERT' or old.completed_at is null)) then
          return null;
        end if;
        v_event := 'renewal.completed';
        v_payload := jsonb_build_object('renewal_id', new.id, 'vehicle_id', new.vehicle_id, 'name', new.name,
          'renewal_type', new.renewal_type, 'due_date', new.due_date, 'amount', new.amount);
      when 'invoices' then
        if not (new.status = 'issued' and (tg_op = 'INSERT' or old.status = 'draft')) then
          return null;
        end if;
        v_event := 'invoice.issued';
        v_payload := jsonb_build_object('invoice_id', new.id, 'doc_number', new.doc_number, 'total', new.total,
          'currency', new.currency, 'customer_id', new.customer_id, 'vehicle_id', new.vehicle_id,
          'due_date', new.due_date);
        v_dedupe := v_event || ':' || new.id;
      when 'payments' then
        v_event := 'payment.received';
        v_payload := jsonb_build_object('payment_id', new.id, 'invoice_id', new.invoice_id, 'amount', new.amount,
          'method', new.method, 'paid_at', new.paid_at);
        v_dedupe := v_event || ':' || new.id;
      when 'speed_limiter_certificates' then
        v_event := 'certificate.issued';
        v_payload := jsonb_build_object('certificate_id', new.id, 'certificate_number', new.certificate_number,
          'vehicle_id', new.vehicle_id, 'customer_id', new.customer_id, 'expires_at', new.expires_at,
          'status', new.status);
        v_dedupe := v_event || ':' || new.id;
      else
        return null;
    end case;

    perform app.emit_event(new.tenant_id, v_event, split_part(v_event, '.', 1), new.id, v_payload, v_dedupe);
  exception when others then
    raise warning 'trg_automation_events (%): % (%)', tg_table_name, sqlerrm, sqlstate;
  end;
  return null;
end;
$$;
revoke execute on function app.trg_automation_events() from public, anon, authenticated;

-- Triggers on existing tables last, under a short lock timeout.
set local lock_timeout = '1s';

create trigger vehicles_automation_events after insert on public.vehicles
  for each row execute function app.trg_automation_events();
create trigger customers_automation_events after insert on public.customers
  for each row execute function app.trg_automation_events();
create trigger issues_automation_events after insert or update of status on public.issues
  for each row execute function app.trg_automation_events();
create trigger work_orders_automation_events after insert or update of status on public.work_orders
  for each row execute function app.trg_automation_events();
create trigger inspections_automation_events after insert or update of status on public.inspections
  for each row execute function app.trg_automation_events();
create trigger renewals_automation_events after insert or update of completed_at on public.renewals
  for each row execute function app.trg_automation_events();
create trigger invoices_automation_events after insert or update of status on public.invoices
  for each row execute function app.trg_automation_events();
create trigger payments_automation_events after insert on public.payments
  for each row execute function app.trg_automation_events();
create trigger speed_limiter_certificates_automation_events after insert on public.speed_limiter_certificates
  for each row execute function app.trg_automation_events();

-- ============================================================
-- 6) RLS policies, LAST (each CREATE POLICY locks auth/storage tables).
-- ============================================================
create policy automation_rules_select on public.automation_rules for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.module_enabled('workflow_automation')));
create policy automation_rules_insert on public.automation_rules for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
              and (select app.module_enabled('workflow_automation')));
create policy automation_rules_update on public.automation_rules for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
         and (select app.module_enabled('workflow_automation')))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
              and (select app.module_enabled('workflow_automation')));
create policy automation_rules_delete on public.automation_rules for delete to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
         and (select app.module_enabled('workflow_automation')));
-- Server-written log: read-only to members.
create policy automation_runs_select on public.automation_runs for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.module_enabled('workflow_automation')));
