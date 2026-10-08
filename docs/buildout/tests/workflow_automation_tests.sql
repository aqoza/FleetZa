begin;
create temp table _t (name text, ok boolean, detail text);
grant all on _t to authenticated;

-- Pure evaluation
insert into _t select 'eq numeric-aware', app.automation_condition_match('{"field":"n","op":"eq","value":5}', '{"n":"5.0"}'), null;
insert into _t select 'eq case-insensitive text', app.automation_condition_match('{"field":"p","op":"eq","value":"HIGH"}', '{"p":"high"}'), null;
insert into _t select 'gt numeric', app.automation_condition_match('{"field":"t","op":"gt","value":"100"}', '{"t":250.5}'), null;
insert into _t select 'lt missing is false', not app.automation_condition_match('{"field":"x","op":"lt","value":1}', '{}'), null;
insert into _t select 'neq missing is true', app.automation_condition_match('{"field":"x","op":"neq","value":1}', '{}'), null;
insert into _t select 'in list', app.automation_condition_match('{"field":"p","op":"in","value":["high","critical"]}', '{"p":"critical"}'), null;
insert into _t select 'contains text', app.automation_condition_match('{"field":"title","op":"contains","value":"brake"}', '{"title":"Front Brake noise"}'), null;
insert into _t select 'nested path', app.automation_condition_match('{"field":"a.b","op":"eq","value":"z"}', '{"a":{"b":"z"}}'), null;
insert into _t select 'exists', app.automation_condition_match('{"field":"a","op":"exists"}', '{"a":"x"}')
  and not app.automation_condition_match('{"field":"a","op":"exists"}', '{"a":""}'), null;
insert into _t select 'empty conditions match', app.automation_conditions_match('[]', '{}'), null;
insert into _t select 'render', app.automation_render('{name} is {status}', '{"name":"Truck 7","status":"down"}') = 'Truck 7 is down', null;

-- Validation
do $$ begin
  insert into public.automation_rules (tenant_id, name, event, actions) values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'bad', 'issue.created', '[]');
  insert into _t values ('rule without actions refused', false, null);
exception when others then insert into _t values ('rule without actions refused', sqlerrm like 'AUTOMATION_INVALID_RULE%', sqlerrm); end $$;
do $$ begin
  insert into public.automation_rules (tenant_id, name, event, actions) values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'bad', 'issue.created', '[{"type":"set_field"}]');
  insert into _t values ('unknown action refused', false, null);
exception when others then insert into _t values ('unknown action refused', sqlerrm like 'AUTOMATION_INVALID_RULE%', sqlerrm); end $$;

-- Module off: emit_event stores nothing, rules never run.
insert into public.automation_rules (tenant_id, name, event, conditions, actions, run_count) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'Critical issue alert', 'issue.created',
   '[{"field":"priority","op":"in","value":["high","critical"]}]',
   '[{"type":"notify","audience":"managers","severity":"critical","message":"{title} on a vehicle"}]', 99),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'Failed inspection to issue', 'inspection.failed', '[]',
   '[{"type":"create_issue","title":"Follow up failed inspection","priority":"high"}]', 0),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'Broken rule', 'issue.created', '[]',
   '[{"type":"webhook","subscription_id":"00000000-0000-4000-8000-000000000000"}]', 0);
insert into _t select 'client cannot set run_count', (select run_count from public.automation_rules where name = 'Critical issue alert') = 0, null;

create temp table _veh as select id from public.vehicles where tenant_id = '170d2d86-5c22-4bcb-9d74-420c879419b2' limit 1;
insert into public.issues (tenant_id, vehicle_id, title, priority) select '170d2d86-5c22-4bcb-9d74-420c879419b2', id, 'Pre-module', 'critical' from _veh;
insert into _t select 'module off: no events', not exists (select 1 from public.domain_events where tenant_id = '170d2d86-5c22-4bcb-9d74-420c879419b2'), null;

insert into public.tenant_modules (tenant_id, module_id, enabled) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'workflow_automation', true), ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'notifications', true), ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'issues', true)
on conflict (tenant_id, module_id) do update set enabled = true;

-- Matching event
insert into public.issues (tenant_id, vehicle_id, title, priority) select '170d2d86-5c22-4bcb-9d74-420c879419b2', id, 'Brakes failing', 'critical' from _veh;
insert into _t select 'issue.created stored', exists (select 1 from public.domain_events where event = 'issue.created' and payload->>'title' = 'Brakes failing'), null;
insert into _t select 'rule ran + counted',
  (select run_count from public.automation_rules where name = 'Critical issue alert') = 1, null;
insert into _t select 'notification sent with rendered title',
  exists (select 1 from public.notifications where kind = 'automation.rule' and title = 'Brakes failing on a vehicle'), null;
insert into _t select 'broken rule logged as failed, write still succeeded',
  exists (select 1 from public.automation_runs r join public.automation_rules a on a.id = r.rule_id
          where a.name = 'Broken rule' and r.status = 'failed' and r.detail like '%integrations%'), null;

-- Non-matching event
insert into public.issues (tenant_id, vehicle_id, title, priority) select '170d2d86-5c22-4bcb-9d74-420c879419b2', id, 'Wiper squeak', 'low' from _veh;
insert into _t select 'non-matching logged as skipped',
  exists (select 1 from public.automation_runs r join public.domain_events e on e.id = r.event_id
          where e.payload->>'title' = 'Wiper squeak' and r.status = 'skipped'), null;

-- create_issue action, and no loop from the issue.created it raises
insert into public.inspections (tenant_id, vehicle_id, status) select '170d2d86-5c22-4bcb-9d74-420c879419b2', id, 'fail' from _veh;
insert into _t select 'create_issue made an issue',
  exists (select 1 from public.issues where title = 'Follow up failed inspection' and priority = 'high'), null;
insert into _t select 'nested issue.created stored but rules did not re-run',
  exists (select 1 from public.domain_events where event = 'issue.created' and payload->>'title' = 'Follow up failed inspection')
  and not exists (select 1 from public.automation_runs r join public.domain_events e on e.id = r.event_id
                  where e.payload->>'title' = 'Follow up failed inspection'), null;
insert into _t select 'engine flag cleared', coalesce(current_setting('app.automation_running', true), '') = '', null;

-- Transitions
update public.issues set status = 'resolved' where title = 'Brakes failing';
insert into _t select 'issue.resolved emitted', exists (select 1 from public.domain_events where event = 'issue.resolved'), null;

-- Dry run as owner
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
create temp table _dry as select public.test_automation_rule(
  '[{"field":"priority","op":"eq","value":"high"},{"field":"total","op":"gt","value":100}]',
  '{"priority":"high","total":50}') as r;
reset role;
insert into _t select 'dry run reports per condition',
  (select (r->>'matched')::boolean = false and (r->'conditions'->0->>'matched')::boolean and not (r->'conditions'->1->>'matched')::boolean from _dry),
  (select r::text from _dry);

-- @print
select name, ok, detail from _t order by ok, name;
rollback;
