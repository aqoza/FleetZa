-- Dry-run tests for 20261008000024_incidents.sql (PGlite replica:
-- node docs/buildout/pglite/harness.mjs run docs/buildout/tests/incidents_tests.sql).
-- The claim tests at the end run only when the Insurance module's migration
-- (20261008000023) is present; without it they check MODULE_DISABLED.
begin;
create temp table _t (name text, ok boolean, detail text);
grant all on _t to authenticated, service_role;

insert into public.tenant_modules (tenant_id, module_id, enabled) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'workflow_automation', true),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'notifications', true),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'maintenance', true)
on conflict (tenant_id, module_id) do update set enabled = true;
insert into public.drivers (id, tenant_id, first_name, last_name) values
  ('a7e1c0de-0024-4b2c-9d3e-4f5a6b7c8d01', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Salim', 'Harthi');

-- Module off
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
do $$ begin
  insert into public.incidents (vehicle_id, occurred_at, description) values ('5eed0000-0000-4000-8000-00000000e001', now(), 'x');
  insert into _t values ('module off: insert refused', false, null);
exception when others then insert into _t values ('module off: insert refused', sqlstate = '42501', sqlerrm); end $$;
reset role;
insert into public.tenant_modules (tenant_id, module_id, enabled)
values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'incidents', true)
on conflict (tenant_id, module_id) do update set enabled = true;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);

-- Reporting
insert into public.incidents (vehicle_id, driver_id, occurred_at, location, incident_type, severity, description, injuries,
                              at_fault, estimated_damage, vehicle_drivable, notes)
values ('5eed0000-0000-4000-8000-00000000e001', 'a7e1c0de-0024-4b2c-9d3e-4f5a6b7c8d01', now() - interval '2 hours',
        'Sohar roundabout', 'collision', 'major', 'Rear-ended at a roundabout', 1, 'third_party', 3500, false, 'i1');
create temp table _i on commit drop as select id from public.incidents where notes = 'i1';
grant all on _i to authenticated;
insert into _t select 'incident numbered INC, reported, tenant currency',
  (select doc_number ~ '^INC-\d{5}$' and status = 'reported' and claim_id is null
     and currency = (select currency from public.tenants where id = '170d2d86-5c22-4bcb-9d74-420c879419b2')
   from public.incidents where id = (select id from _i)), null;
insert into _t select 'timeline starts with reported',
  (select count(*) = 1 from public.incident_events where incident_id = (select id from _i) and status = 'reported'), null;
insert into _t select 'reported event emitted',
  (select count(*) = 1 from public.domain_events where event = 'incident.reported' and entity_id = (select id from _i)), null;
insert into _t select 'major incident notifies managers',
  (select count(*) > 0 from public.notifications where kind = 'incidents.major' and entity_id = (select id from _i)), null;
do $$ begin
  insert into public.incidents (vehicle_id, occurred_at, description) values ('5eed0000-0000-4000-8000-00000000e001', now() + interval '1 day', 'future');
  insert into _t values ('future time refused', false, null);
exception when others then insert into _t values ('future time refused', sqlerrm = 'INVALID_INCIDENT_TIME', sqlerrm); end $$;
do $$ begin
  insert into public.incidents (vehicle_id, occurred_at, description) values ('5eed0000-0000-4000-8000-00000000e0b1', now(), 'other tenant');
  insert into _t values ('other tenant vehicle refused', false, null);
exception when others then insert into _t values ('other tenant vehicle refused', sqlerrm like 'CROSS_TENANT_REFERENCE%', sqlerrm); end $$;
do $$ begin
  insert into public.incidents (vehicle_id, occurred_at, description, status) values ('5eed0000-0000-4000-8000-00000000e001', now(), 'x', 'closed');
  insert into _t values ('status not client-insertable', false, null);
exception when others then insert into _t values ('status not client-insertable', sqlstate = '42501', sqlerrm); end $$;
do $$ begin
  update public.incidents set claim_id = gen_random_uuid() where id = (select id from _i);
  insert into _t values ('claim link not client-writable', false, null);
exception when others then insert into _t values ('claim link not client-writable', sqlstate = '42501', sqlerrm); end $$;
insert into public.incidents (vehicle_id, occurred_at, incident_type, severity, description, notes)
values ('5eed0000-0000-4000-8000-00000000e002', now() - interval '1 day', 'near_miss', 'minor', 'Pedestrian stepped out', 'i2');
insert into _t select 'minor incident does not notify',
  not exists (select 1 from public.notifications n join public.incidents i on i.id = n.entity_id where i.notes = 'i2'), null;
update public.incidents set severity = 'critical' where notes = 'i2';
insert into _t select 'raising to critical notifies',
  exists (select 1 from public.notifications n join public.incidents i on i.id = n.entity_id
          where i.notes = 'i2' and n.params->>'severity' = 'critical'), null;

-- Parties
insert into public.incident_parties (incident_id, party_type, name, phone, vehicle_plate, insurer, statement)
values ((select id from _i), 'third_party_driver', 'Khalid Al Balushi', '+968 9555 1212', '3344 AB', 'Oman Insurance', 'Did not see the van stop.');
insert into public.incident_parties (incident_id, party_type, name) values ((select id from _i), 'witness', 'Shop owner');
insert into _t select 'parties recorded', (select count(*) = 2 from public.incident_parties where incident_id = (select id from _i)), null;

-- Work order
create temp table _w on commit drop as select public.incident_create_work_order((select id from _i)) as id;
grant all on _w to authenticated;
insert into _t select 'work order created for the vehicle and linked',
  (select w.vehicle_id = '5eed0000-0000-4000-8000-00000000e001' and w.priority = 'high' and w.title like 'Repair after incident INC-%'
   from public.work_orders w where w.id = (select id from _w))
  and (select work_order_id = (select id from _w) from public.incidents where id = (select id from _i)), null;
do $$ begin
  perform public.incident_create_work_order((select id from _i));
  insert into _t values ('second work order refused', false, null);
exception when others then insert into _t values ('second work order refused', sqlerrm = 'INCIDENT_HAS_WORK_ORDER', sqlerrm); end $$;

-- Status flow
do $$ begin
  update public.incidents set status = 'closed' where id = (select id from _i);
  insert into _t values ('cannot jump to closed', false, null);
exception when others then insert into _t values ('cannot jump to closed', sqlerrm = 'ILLEGAL_INCIDENT_TRANSITION', sqlerrm); end $$;
update public.incidents set status = 'investigating' where id = (select id from _i);
update public.incidents set status = 'awaiting_repair' where id = (select id from _i);
update public.incidents set status = 'resolved', actual_cost = 3100 where id = (select id from _i);
insert into _t select 'resolve stamps resolved_at',
  (select status = 'resolved' and resolved_at is not null and actual_cost = 3100 from public.incidents where id = (select id from _i)), null;
do $$ begin
  update public.incidents set status = 'closed' where id = (select id from _i);
  insert into _t values ('major needs a root cause to close', false, null);
exception when others then insert into _t values ('major needs a root cause to close', sqlerrm = 'INCIDENT_ROOT_CAUSE_REQUIRED', sqlerrm); end $$;
update public.incidents set status = 'closed', root_cause = 'Third party following too closely',
  corrective_actions = 'Defensive driving refresher' where id = (select id from _i);
insert into _t select 'close stamps closed_at',
  (select status = 'closed' and closed_at is not null from public.incidents where id = (select id from _i)), null;
insert into _t select 'timeline has every step',
  (select array_agg(status order by at) = array['reported', 'investigating', 'awaiting_repair', 'resolved', 'closed']
   from public.incident_events where incident_id = (select id from _i)), null;
do $$ begin
  update public.incidents set actual_cost = 1 where id = (select id from _i);
  insert into _t values ('closed incident locked', false, null);
exception when others then insert into _t values ('closed incident locked', sqlerrm = 'INCIDENT_LOCKED', sqlerrm); end $$;
update public.incidents set notes = 'i1 filed' where id = (select id from _i);
insert into _t select 'notes stay editable when closed', (select notes = 'i1 filed' from public.incidents where id = (select id from _i)), null;
do $$ begin
  insert into public.incident_parties (incident_id, name) values ((select id from _i), 'late witness');
  insert into _t values ('closed incident takes no parties', false, null);
exception when others then insert into _t values ('closed incident takes no parties', sqlerrm = 'INCIDENT_LOCKED', sqlerrm); end $$;
do $$ begin
  delete from public.incidents where id = (select id from _i);
  insert into _t values ('only reported incidents deletable', false, null);
exception when others then insert into _t values ('only reported incidents deletable', sqlerrm = 'INCIDENT_NOT_DELETABLE', sqlerrm); end $$;
update public.incidents set status = 'resolved' where notes = 'i2';
update public.incidents set status = 'investigating' where notes = 'i2';
insert into _t select 'resolved can reopen and clears resolved_at',
  (select status = 'investigating' and resolved_at is null from public.incidents where notes = 'i2'), null;
insert into public.incidents (vehicle_id, occurred_at, description, notes)
values ('5eed0000-0000-4000-8000-00000000e002', now(), 'Mistake', 'i3');
delete from public.incidents where notes = 'i3';
insert into _t select 'reported incident deletable', not exists (select 1 from public.incidents where notes = 'i3'), null;

-- Claims (Insurance module)
do $$
declare v_policy uuid; v_claim uuid; v_inc uuid;
begin
  select id into v_inc from public.incidents where notes = 'i2';
  if to_regclass('public.insurance_claims') is null then
    begin
      perform public.incident_create_claim(v_inc, gen_random_uuid());
      insert into _t values ('claim without Insurance refused', false, null);
    exception when others then insert into _t values ('claim without Insurance refused', sqlerrm = 'MODULE_DISABLED', sqlerrm); end;
    return;
  end if;
  insert into _t values ('insurance FK installed',
    exists (select 1 from pg_constraint where conname = 'insurance_claims_incident_id_fkey'), null);
end $$;
reset role;
do $$
begin
  if to_regclass('public.insurance_claims') is not null then
    insert into public.tenant_modules (tenant_id, module_id, enabled)
    values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'insurance_mgmt', true)
    on conflict (tenant_id, module_id) do update set enabled = true;
    execute $q$insert into public.insurance_policies (tenant_id, policy_number, insurer_name, start_date, end_date, notes)
      values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'P-1', 'Gulf Shield', current_date - 100, current_date + 100, 'ip')$q$;
  end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
do $$
declare v_policy uuid; v_claim uuid; v_inc uuid; v_ok boolean;
begin
  if to_regclass('public.insurance_claims') is null then return; end if;
  select id into v_inc from public.incidents where notes = 'i2';
  execute $q$select id from public.insurance_policies where notes = 'ip'$q$ into v_policy;
  v_claim := public.incident_create_claim(v_inc, v_policy);
  execute $q$select incident_id = $1 and status = 'draft' and description like 'Incident INC-%' from public.insurance_claims where id = $2$q$
    into v_ok using v_inc, v_claim;
  insert into _t values ('claim drafted from the incident and linked',
    v_ok and (select claim_id = v_claim from public.incidents where id = v_inc), null);
  begin
    perform public.incident_create_claim(v_inc, v_policy);
    insert into _t values ('second claim refused', false, null);
  exception when others then insert into _t values ('second claim refused', sqlerrm = 'INCIDENT_HAS_CLAIM', sqlerrm); end;
end $$;
reset role;

-- Viewer
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000a003","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"viewer"}}', true);
insert into _t select 'viewer reads incidents, parties and the timeline',
  (select count(*) = 2 from public.incidents) and (select count(*) = 2 from public.incident_parties)
  and (select count(*) > 0 from public.incident_events), null;
do $$ begin
  insert into public.incidents (vehicle_id, occurred_at, description) values ('5eed0000-0000-4000-8000-00000000e001', now(), 'viewer');
  insert into _t values ('viewer cannot report', false, null);
exception when others then insert into _t values ('viewer cannot report', sqlstate = '42501', sqlerrm); end $$;
do $$ begin
  perform public.incident_create_work_order((select id from public.incidents where notes = 'i2'));
  insert into _t values ('viewer cannot open work orders', false, null);
exception when others then insert into _t values ('viewer cannot open work orders', sqlerrm = 'FORBIDDEN' or sqlstate = '42501', sqlerrm); end $$;
update public.incidents set notes = 'viewer' where notes = 'i2';
insert into _t select 'viewer update is a no-op', exists (select 1 from public.incidents where notes = 'i2'), null;
reset role;

-- Other tenant
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000b001","role":"authenticated","app_metadata":{"tenant_id":"5eed0000-0000-4000-8000-0000000000b1","role":"owner"}}', true);
insert into _t select 'cross-tenant isolation',
  (select count(*) = 0 from public.incidents) and (select count(*) = 0 from public.incident_parties)
  and (select count(*) = 0 from public.incident_events), null;
reset role;

-- @print
select name, ok, detail from _t order by ok, name;
rollback;
