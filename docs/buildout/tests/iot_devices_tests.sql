-- Dry-run tests for 20261008000016_iot_devices.sql (PGlite replica:
-- node docs/buildout/pglite/harness.mjs run docs/buildout/tests/iot_devices_tests.sql).
begin;
create temp table _t (name text, ok boolean, detail text);
grant all on _t to authenticated, service_role;

insert into public.tenant_modules (tenant_id, module_id, enabled) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'notifications', true),
  ('5eed0000-0000-4000-8000-0000000000b1', 'iot_devices', true)
on conflict (tenant_id, module_id) do update set enabled = true;
insert into public.vehicles (id, tenant_id, name) values
  ('a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Reefer 1'),
  ('a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8db1', '5eed0000-0000-4000-8000-0000000000b1', 'Foreign truck');
insert into public.iot_devices (id, tenant_id, serial, name, device_type) values
  ('f0000000-0000-4000-8000-0000000000b1', '5eed0000-0000-4000-8000-0000000000b1', 'FOREIGN-1', 'Foreign sensor', 'temperature');

insert into _t select 'compare gt', app.iot_compare(5, 'gt', 4) and not app.iot_compare(4, 'gt', 4), null;
insert into _t select 'compare lte / eq', app.iot_compare(4, 'lte', 4) and app.iot_compare(4, 'eq', 4) and not app.iot_compare(5, 'lt', 4), null;

-- Module off
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
do $$ begin
  insert into public.iot_devices (serial, name) values ('X', 'X');
  insert into _t values ('module off: device refused', false, null);
exception when others then insert into _t values ('module off: device refused', sqlstate = '42501', sqlerrm); end $$;
reset role;
insert into public.tenant_modules (tenant_id, module_id, enabled)
values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'iot_devices', true)
on conflict (tenant_id, module_id) do update set enabled = true;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
insert into public.iot_devices (serial, name, device_type, vehicle_id) values
  ('TMP-001', 'Reefer probe', 'temperature', 'a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01'),
  ('FUEL-01', 'Tank gauge', 'fuel_level', null);
insert into _t select 'device created with actor', (select created_by is not null and last_reading = '{}'::jsonb
  from public.iot_devices where serial = 'TMP-001'), null;
do $$ begin
  insert into public.iot_devices (serial, name) values ('TMP-001', 'Dup');
  insert into _t values ('serial unique per tenant', false, null);
exception when others then insert into _t values ('serial unique per tenant', sqlstate = '23505', sqlerrm); end $$;
do $$ begin
  insert into public.iot_devices (serial, name, vehicle_id) values ('V-X', 'X', 'a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8db1');
  insert into _t values ('foreign vehicle refused', false, null);
exception when others then insert into _t values ('foreign vehicle refused', sqlerrm like 'CROSS_TENANT_REFERENCE%', sqlerrm); end $$;

-- Rules: device-specific (temp > 8, cooldown 30), type-wide (temperature < -25), all devices battery < 11.5.
insert into public.iot_alert_rules (name, device_id, metric, op, threshold, severity, cooldown_minutes)
select 'Reefer too warm', id, 'temperature', 'gt', 8, 'critical', 30 from public.iot_devices where serial = 'TMP-001';
insert into public.iot_alert_rules (name, device_type, metric, op, threshold, notify)
values ('Too cold', 'temperature', 'temperature', 'lt', -25, false);
insert into public.iot_alert_rules (name, metric, op, threshold, severity)
values ('Low battery', 'battery', 'lt', 11.5, 'warning');
do $$ begin
  insert into public.iot_alert_rules (name, metric, op, threshold) values ('Bad', 'Temp C', 'gt', 1);
  insert into _t values ('metric name checked', false, null);
exception when others then insert into _t values ('metric name checked', sqlstate = '23514', sqlerrm); end $$;
do $$ begin
  insert into public.iot_alert_rules (name, device_id, metric, op, threshold)
  values ('X', 'f0000000-0000-4000-8000-0000000000b1', 'temperature', 'gt', 1);
  insert into _t values ('foreign device rule refused', false, null);
exception when others then insert into _t values ('foreign device rule refused', sqlerrm like 'CROSS_TENANT_REFERENCE%' or sqlstate = '23503', sqlerrm); end $$;

do $$ begin
  insert into public.iot_readings (device_id, recorded_at, metric, value, source)
  select id, now(), 'temperature', 4, 'api' from public.iot_devices where serial = 'TMP-001';
  insert into _t values ('client cannot claim api source', false, null);
exception when others then insert into _t values ('client cannot claim api source', sqlerrm = 'FORBIDDEN', sqlerrm); end $$;
do $$ begin
  insert into public.iot_readings (device_id, recorded_at, metric, value)
  select id, now() + interval '1 day', 'temperature', 4 from public.iot_devices where serial = 'TMP-001';
  insert into _t values ('future reading refused', false, null);
exception when others then insert into _t values ('future reading refused', sqlerrm = 'INVALID_READING_TIME', sqlerrm); end $$;

-- Reading 1: normal.
insert into public.iot_readings (device_id, recorded_at, metric, value, unit)
select id, now() - interval '60 minutes', 'temperature', 4.2, 'C' from public.iot_devices where serial = 'TMP-001';
insert into _t select 'last reading stored', (select (last_reading -> 'temperature' ->> 'value')::numeric = 4.2
  and last_seen_at is not null from public.iot_devices where serial = 'TMP-001'), null;
insert into _t select 'normal reading: no alert', (select count(*) = 0 from public.iot_alerts), null;
-- Reading 2: too warm -> alert.
insert into public.iot_readings (device_id, recorded_at, metric, value, unit)
select id, now() - interval '50 minutes', 'temperature', 9.5, 'C' from public.iot_devices where serial = 'TMP-001';
insert into _t select 'too warm raises alert', (select count(*) = 1 and max(severity) = 'critical' and max(value) = 9.5
  from public.iot_alerts where rule_name = 'Reefer too warm'), null;
-- Reading 3: still warm, 10 min later: inside cooldown.
insert into public.iot_readings (device_id, recorded_at, metric, value, unit)
select id, now() - interval '40 minutes', 'temperature', 10, 'C' from public.iot_devices where serial = 'TMP-001';
insert into _t select 'cooldown suppresses repeat', (select count(*) = 1 from public.iot_alerts where rule_name = 'Reefer too warm'), null;
-- Reading 4: backfilled older warm reading: history only.
insert into public.iot_readings (device_id, recorded_at, metric, value, unit)
select id, now() - interval '200 minutes', 'temperature', 30, 'C' from public.iot_devices where serial = 'TMP-001';
insert into _t select 'backfill: no alert, last value kept', (select count(*) = 1 from public.iot_alerts)
  and (select (last_reading -> 'temperature' ->> 'value')::numeric = 10 from public.iot_devices where serial = 'TMP-001'), null;
-- Reading 5: 45 min after the alert: cooldown over.
insert into public.iot_readings (device_id, recorded_at, metric, value, unit)
select id, now() - interval '5 minutes', 'temperature', 11, 'C' from public.iot_devices where serial = 'TMP-001';
insert into _t select 'after cooldown alerts again', (select count(*) = 2 from public.iot_alerts where rule_name = 'Reefer too warm'), null;
-- Type-wide cold rule (no notify) + all-device battery rule on the fuel gauge.
insert into public.iot_readings (device_id, recorded_at, metric, value)
select id, now() - interval '1 minute', 'temperature', -30 from public.iot_devices where serial = 'TMP-001';
insert into public.iot_readings (device_id, recorded_at, metric, value, unit)
select id, now() - interval '1 minute', 'battery', 11.1, 'V' from public.iot_devices where serial = 'FUEL-01';
insert into public.iot_readings (device_id, recorded_at, metric, value, unit)
select id, now() - interval '1 minute', 'fuel_level', 40, '%' from public.iot_devices where serial = 'FUEL-01';
insert into _t select 'type rule and all-device rule fire', (select count(*) filter (where rule_name = 'Too cold') = 1
  and count(*) filter (where rule_name = 'Low battery') = 1 from public.iot_alerts), null;
insert into _t select 'last_reading keeps one key per metric', (select last_reading ? 'battery' and last_reading ? 'fuel_level'
  from public.iot_devices where serial = 'FUEL-01'), null;
do $$ begin
  insert into public.iot_readings (device_id, recorded_at, metric, value)
  select device_id, recorded_at, metric, 1 from public.iot_readings limit 1;
  insert into _t values ('duplicate reading refused', false, null);
exception when others then insert into _t values ('duplicate reading refused', sqlstate = '23505', sqlerrm); end $$;
do $$ begin
  insert into public.iot_alerts (tenant_id, device_id, rule_name, metric, op, threshold, value, severity, triggered_at)
  select tenant_id, id, 'x', 'x', 'gt', 1, 2, 'info', now() from public.iot_devices limit 1;
  insert into _t values ('alerts not client-insertable', false, null);
exception when others then insert into _t values ('alerts not client-insertable', sqlstate = '42501', sqlerrm); end $$;

-- Alert workflow.
update public.iot_alerts set status = 'acknowledged' where rule_name = 'Low battery';
insert into _t select 'acknowledge stamps', (select acknowledged_at is not null and acknowledged_by is not null
  from public.iot_alerts where rule_name = 'Low battery'), null;
update public.iot_alerts set status = 'resolved', note = 'Battery replaced' where rule_name = 'Low battery';
insert into _t select 'resolve stamps', (select resolved_at is not null and note = 'Battery replaced'
  from public.iot_alerts where rule_name = 'Low battery'), null;
do $$ begin
  update public.iot_alerts set status = 'open' where rule_name = 'Low battery';
  insert into _t values ('cannot reopen', false, null);
exception when others then insert into _t values ('cannot reopen', sqlerrm = 'ILLEGAL_ALERT_TRANSITION', sqlerrm); end $$;
update public.iot_alerts set status = 'resolved' where rule_name = 'Too cold';
insert into _t select 'open -> resolved also acknowledges', (select acknowledged_at is not null and resolved_at is not null
  from public.iot_alerts where rule_name = 'Too cold'), null;
do $$ begin
  update public.iot_alerts set value = 0 where rule_name = 'Too cold';
  insert into _t values ('alert facts not editable', false, null);
exception when others then insert into _t values ('alert facts not editable', sqlstate = '42501', sqlerrm); end $$;

-- Inactive device: readings stored, no alerts.
update public.iot_devices set status = 'inactive' where serial = 'FUEL-01';
insert into public.iot_readings (device_id, recorded_at, metric, value)
select id, now(), 'battery', 10 from public.iot_devices where serial = 'FUEL-01';
insert into _t select 'inactive device raises nothing', (select count(*) = 1 from public.iot_alerts where rule_name = 'Low battery'), null;
reset role;

insert into _t select 'notifications follow rule.notify', (select count(distinct dedupe_key) = 3
  from public.notifications where kind = 'iot.alert'), null;

-- Service role (the API) inserts with an explicit tenant.
set local role service_role;
insert into public.iot_readings (tenant_id, device_id, recorded_at, metric, value, unit, source)
select tenant_id, id, now() - interval '30 seconds', 'temperature', 5, 'C', 'api' from public.iot_devices where serial = 'TMP-001';
insert into _t select 'api reading accepted', (select count(*) = 1 from public.iot_readings where source = 'api'), null;
reset role;

-- Viewer
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000a003","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"viewer"}}', true);
insert into _t select 'viewer reads devices and alerts', (select count(*) = 2 from public.iot_devices)
  and (select count(*) = 4 from public.iot_alerts), null;
do $$ begin
  update public.iot_alerts set status = 'acknowledged' where status = 'open';
  if found then insert into _t values ('viewer cannot acknowledge', false, null);
  else insert into _t values ('viewer cannot acknowledge', true, 'no rows'); end if;
exception when others then insert into _t values ('viewer cannot acknowledge', sqlstate = '42501', sqlerrm); end $$;
reset role;

-- Other tenant
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000b001","role":"authenticated","app_metadata":{"tenant_id":"5eed0000-0000-4000-8000-0000000000b1","role":"owner"}}', true);
insert into _t select 'cross-tenant isolation', (select count(*) = 1 from public.iot_devices)
  and (select count(*) = 0 from public.iot_readings) and (select count(*) = 0 from public.iot_alerts), null;
reset role;

-- Deleting a device cleans up.
delete from public.iot_devices where serial = 'TMP-001';
insert into _t select 'device delete cascades', (select count(*) = 0 from public.iot_readings r
  join public.iot_devices d on d.id = r.device_id where d.serial = 'TMP-001')
  and (select count(*) = 0 from public.iot_alert_rules where name = 'Reefer too warm')
  and (select count(*) = 1 from public.iot_alerts), null;

-- @print
select name, ok, detail from _t order by ok, name;
rollback;
