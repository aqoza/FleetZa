-- IoT devices (module iot_devices): connected sensors, their readings, alert
-- rules and the alerts those rules raise.
--
-- 1) iot_devices: one row per sensor (serial unique per tenant), optionally
--    mounted on a vehicle or an asset (asset_id is a plain uuid, no foreign
--    key: assets belongs to another module). last_seen_at / last_reading are
--    server-maintained: last_reading holds the newest value per metric,
--    {"temperature": {"value": 4.2, "unit": "C", "at": "..."}, ...}.
-- 2) iot_readings: one row per (device, metric, recorded_at). Written by the
--    public API (POST /api/v1/iot/readings, service role, source 'api') or by
--    managers (source 'manual'). Readings are immutable.
-- 3) iot_alert_rules: metric <op> threshold, scoped to one device, to a device
--    type, or (neither) to every device. cooldown_minutes stops a rule from
--    raising a second alert for the same device inside that window.
-- 4) iot_alerts: raised by the reading trigger when a reading is the newest
--    for its metric and breaks an active rule; status open → acknowledged →
--    resolved (or open → resolved). Notifies managers (iot.alert) when the
--    rule says so and emits the iot.alert automation event.
--
-- Raised codes: INVALID_READING_TIME, ILLEGAL_ALERT_TRANSITION
-- (+ CROSS_TENANT_REFERENCE, FORBIDDEN). Additive only.

set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- ============================================================
-- Tables
-- ============================================================
create table public.iot_devices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  serial text not null check (char_length(btrim(serial)) between 1 and 100),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  device_type text not null default 'other' check (device_type in ('temperature', 'humidity', 'fuel_level',
    'tire_pressure', 'door', 'battery', 'engine', 'obd', 'other')),
  vehicle_id uuid references public.vehicles(id) on delete set null,
  asset_id uuid,
  asset_label text check (asset_label is null or char_length(asset_label) <= 120),
  status text not null default 'active' check (status in ('active', 'inactive', 'faulty')),
  last_seen_at timestamptz,
  last_reading jsonb not null default '{}'::jsonb,
  notes text check (notes is null or char_length(notes) <= 2000),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, serial)
);
create index iot_devices_vehicle_idx on public.iot_devices (vehicle_id);
create index iot_devices_tenant_idx on public.iot_devices (tenant_id, status);
alter table public.iot_devices enable row level security;
revoke all on public.iot_devices from anon;
revoke insert, update on public.iot_devices from authenticated;
grant insert (serial, name, device_type, vehicle_id, asset_id, asset_label, status, notes)
  on public.iot_devices to authenticated;
grant update (serial, name, device_type, vehicle_id, asset_id, asset_label, status, notes)
  on public.iot_devices to authenticated;

create table public.iot_readings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  device_id uuid not null references public.iot_devices(id) on delete cascade,
  recorded_at timestamptz not null,
  metric text not null check (metric ~ '^[a-z][a-z0-9_]{0,49}$'),
  value numeric not null check (value between -1e12 and 1e12),
  unit text check (unit is null or char_length(unit) <= 20),
  source text not null default 'manual' check (source in ('api', 'manual')),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (device_id, metric, recorded_at)
);
create index iot_readings_device_metric_idx on public.iot_readings (device_id, metric, recorded_at desc);
create index iot_readings_tenant_idx on public.iot_readings (tenant_id, recorded_at desc);
alter table public.iot_readings enable row level security;
revoke all on public.iot_readings from anon;
revoke insert, update on public.iot_readings from authenticated;
grant insert (device_id, recorded_at, metric, value, unit, source) on public.iot_readings to authenticated;

create table public.iot_alert_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  device_id uuid references public.iot_devices(id) on delete cascade,
  device_type text check (device_type is null or device_type in ('temperature', 'humidity', 'fuel_level',
    'tire_pressure', 'door', 'battery', 'engine', 'obd', 'other')),
  metric text not null check (metric ~ '^[a-z][a-z0-9_]{0,49}$'),
  op text not null check (op in ('gt', 'gte', 'lt', 'lte', 'eq')),
  threshold numeric not null,
  severity text not null default 'warning' check (severity in ('info', 'warning', 'critical')),
  cooldown_minutes integer not null default 30 check (cooldown_minutes between 0 and 10080),
  notify boolean not null default true,
  active boolean not null default true,
  notes text check (notes is null or char_length(notes) <= 2000),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index iot_alert_rules_tenant_idx on public.iot_alert_rules (tenant_id, metric) where active;
create index iot_alert_rules_device_idx on public.iot_alert_rules (device_id);
alter table public.iot_alert_rules enable row level security;
revoke all on public.iot_alert_rules from anon;
revoke insert, update on public.iot_alert_rules from authenticated;
grant insert (name, device_id, device_type, metric, op, threshold, severity, cooldown_minutes, notify, active, notes)
  on public.iot_alert_rules to authenticated;
grant update (name, device_id, device_type, metric, op, threshold, severity, cooldown_minutes, notify, active, notes)
  on public.iot_alert_rules to authenticated;

create table public.iot_alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  rule_id uuid references public.iot_alert_rules(id) on delete set null,
  device_id uuid not null references public.iot_devices(id) on delete cascade,
  reading_id uuid references public.iot_readings(id) on delete set null,
  rule_name text not null,
  metric text not null,
  op text not null,
  threshold numeric not null,
  value numeric not null,
  unit text,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  triggered_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  resolved_at timestamptz,
  resolved_by uuid,
  note text check (note is null or char_length(note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index iot_alerts_tenant_idx on public.iot_alerts (tenant_id, status, triggered_at desc);
create index iot_alerts_device_idx on public.iot_alerts (device_id, triggered_at desc);
create index iot_alerts_rule_idx on public.iot_alerts (rule_id, device_id, triggered_at desc);
create index iot_alerts_reading_idx on public.iot_alerts (reading_id);
alter table public.iot_alerts enable row level security;
revoke all on public.iot_alerts from anon;
revoke insert, update, delete on public.iot_alerts from authenticated;
-- Clients only move an alert along (acknowledge / resolve) and annotate it.
grant update (status, note) on public.iot_alerts to authenticated;

-- ============================================================
-- Helpers
-- ============================================================
create or replace function app.iot_compare(p_value numeric, p_op text, p_threshold numeric)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_op
    when 'gt' then p_value > p_threshold
    when 'gte' then p_value >= p_threshold
    when 'lt' then p_value < p_threshold
    when 'lte' then p_value <= p_threshold
    when 'eq' then p_value = p_threshold
    else false
  end;
$$;
grant execute on function app.iot_compare(numeric, text, numeric) to authenticated, service_role;

-- ============================================================
-- Triggers
-- ============================================================
-- Before insert (invoker, so a client cannot claim the API source).
create or replace function app.iot_reading_before()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source = 'api' and current_user::text = 'authenticated' then
    raise exception 'FORBIDDEN';
  end if;
  if new.recorded_at > now() + interval '10 minutes' or new.recorded_at < timestamptz '2000-01-01' then
    raise exception 'INVALID_READING_TIME';
  end if;
  new.created_by := coalesce(new.created_by, auth.uid());
  return new;
end;
$$;
revoke execute on function app.iot_reading_before() from public, anon, authenticated;

-- After insert: refresh the device's last values; a reading that is the
-- newest for its metric is checked against the active rules.
create or replace function app.iot_reading_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.iot_devices;
  v_prev_at timestamptz;
  v_rule public.iot_alert_rules;
  v_alert uuid;
begin
  select * into v_device from public.iot_devices where id = new.device_id;
  if v_device.id is null then
    return null;
  end if;
  v_prev_at := (v_device.last_reading -> new.metric ->> 'at')::timestamptz;

  update public.iot_devices d
     set last_seen_at = greatest(coalesce(d.last_seen_at, new.recorded_at), new.recorded_at),
         last_reading = case
           when v_prev_at is null or v_prev_at < new.recorded_at then
             d.last_reading || jsonb_build_object(new.metric,
               jsonb_build_object('value', new.value, 'unit', new.unit, 'at', new.recorded_at))
           else d.last_reading
         end
   where d.id = new.device_id;

  -- Backfilled (older) readings are history only; inactive devices raise nothing.
  if (v_prev_at is not null and v_prev_at >= new.recorded_at) or v_device.status = 'inactive' then
    return null;
  end if;

  for v_rule in
    select * from public.iot_alert_rules r
     where r.tenant_id = new.tenant_id
       and r.active
       and r.metric = new.metric
       and (r.device_id = new.device_id
            or (r.device_id is null and (r.device_type is null or r.device_type = v_device.device_type)))
  loop
    continue when not app.iot_compare(new.value, v_rule.op, v_rule.threshold);
    continue when exists (
      select 1 from public.iot_alerts a
       where a.rule_id = v_rule.id and a.device_id = new.device_id
         and a.triggered_at > new.recorded_at - make_interval(mins => v_rule.cooldown_minutes)
         and a.triggered_at <= new.recorded_at
    );

    insert into public.iot_alerts (tenant_id, rule_id, device_id, reading_id, rule_name, metric, op, threshold,
                                   value, unit, severity, triggered_at)
    values (new.tenant_id, v_rule.id, new.device_id, new.id, v_rule.name, new.metric, v_rule.op, v_rule.threshold,
            new.value, new.unit, v_rule.severity, new.recorded_at)
    returning id into v_alert;

    if v_rule.notify then
      perform app.notify(
        new.tenant_id, 'managers', 'iot.alert', v_rule.severity,
        'iot_alert', v_alert, '/iot/alerts',
        jsonb_build_object('rule', v_rule.name, 'device', v_device.name, 'device_id', new.device_id,
                           'metric', new.metric, 'value', new.value, 'unit', new.unit,
                           'threshold', v_rule.threshold, 'op', v_rule.op, 'at', new.recorded_at),
        v_rule.name || ': ' || v_device.name,
        new.metric || ' = ' || new.value::text || coalesce(' ' || new.unit, ''),
        'iot.alert:' || v_alert);
    end if;

    perform app.emit_event(
      new.tenant_id, 'iot.alert', 'iot_alert', v_alert,
      jsonb_build_object('rule_id', v_rule.id, 'rule', v_rule.name, 'severity', v_rule.severity,
                         'device_id', new.device_id, 'device', v_device.name, 'serial', v_device.serial,
                         'vehicle_id', v_device.vehicle_id, 'metric', new.metric, 'value', new.value,
                         'unit', new.unit, 'threshold', v_rule.threshold, 'op', v_rule.op,
                         'at', new.recorded_at),
      'iot_alert:' || v_alert);
  end loop;
  return null;
end;
$$;
revoke execute on function app.iot_reading_after() from public, anon, authenticated;

-- Alert workflow: open → acknowledged → resolved, or open → resolved.
create or replace function app.iot_alert_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.status is distinct from old.status then
    if not ((old.status = 'open' and new.status in ('acknowledged', 'resolved'))
            or (old.status = 'acknowledged' and new.status = 'resolved')) then
      raise exception 'ILLEGAL_ALERT_TRANSITION';
    end if;
    if new.status = 'acknowledged' then
      new.acknowledged_at := now();
      new.acknowledged_by := auth.uid();
    elsif new.status = 'resolved' then
      new.resolved_at := now();
      new.resolved_by := auth.uid();
      if old.status = 'open' then
        new.acknowledged_at := coalesce(old.acknowledged_at, now());
        new.acknowledged_by := coalesce(old.acknowledged_by, auth.uid());
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function app.iot_alert_before_update() from public, anon, authenticated;

create trigger iot_devices_stamp_actor before insert or update on public.iot_devices
  for each row execute function app.stamp_actor();
create trigger iot_devices_same_tenant before insert or update of vehicle_id on public.iot_devices
  for each row execute function app.assert_same_tenant('vehicle_id', 'vehicles');
create trigger iot_devices_audit after insert or update or delete on public.iot_devices
  for each row execute function app.log_audit();

create trigger iot_readings_before before insert on public.iot_readings
  for each row execute function app.iot_reading_before();
create trigger iot_readings_same_tenant before insert on public.iot_readings
  for each row execute function app.assert_same_tenant('device_id', 'iot_devices');
create trigger iot_readings_after after insert on public.iot_readings
  for each row execute function app.iot_reading_after();

create trigger iot_alert_rules_stamp_actor before insert or update on public.iot_alert_rules
  for each row execute function app.stamp_actor();
create trigger iot_alert_rules_same_tenant before insert or update of device_id on public.iot_alert_rules
  for each row execute function app.assert_same_tenant('device_id', 'iot_devices');
create trigger iot_alert_rules_audit after insert or update or delete on public.iot_alert_rules
  for each row execute function app.log_audit();

create trigger iot_alerts_before_update before update on public.iot_alerts
  for each row execute function app.iot_alert_before_update();

-- ============================================================
-- RLS: members read; managers write devices, readings and rules and work
-- the alerts. Alerts are raised only by the server.
-- ============================================================
set local lock_timeout = '1s';
do $$
declare
  t text;
begin
  foreach t in array array['iot_devices', 'iot_readings', 'iot_alert_rules', 'iot_alerts'] loop
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (tenant_id = (select app.tenant_id()) and (select app.module_enabled(''iot_devices'')))',
      t || '_select', t);
  end loop;
  foreach t in array array['iot_devices', 'iot_readings', 'iot_alert_rules'] loop
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
                     and (select app.module_enabled(''iot_devices'')))',
      t || '_insert', t);
  end loop;
  foreach t in array array['iot_devices', 'iot_alert_rules', 'iot_alerts'] loop
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
                and (select app.module_enabled(''iot_devices'')))
         with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
                     and (select app.module_enabled(''iot_devices'')))',
      t || '_update', t);
  end loop;
  foreach t in array array['iot_devices', 'iot_alert_rules'] loop
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
                and (select app.module_enabled(''iot_devices'')))',
      t || '_delete', t);
  end loop;
end;
$$;
