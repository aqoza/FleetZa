begin;
create temp table _t (name text, ok boolean, detail text);
grant all on _t to authenticated;

-- Fixture: the viewer is linked to employee Sara; Ravi has no login; one other-tenant employee.
insert into public.tenant_modules (tenant_id, module_id, enabled) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'employees', true),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'notifications', true),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'workflow_automation', true),
  ('5eed0000-0000-4000-8000-0000000000b1', 'employees', true),
  ('5eed0000-0000-4000-8000-0000000000b1', 'mobile_workforce', true)
on conflict (tenant_id, module_id) do update set enabled = true;
insert into public.employees (id, tenant_id, first_name, last_name, user_id, status) values
  ('e0000000-0000-4000-8000-000000000001', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Sara', 'Field',
   '5eed0000-0000-4000-8000-00000000a003', 'active'),
  ('e0000000-0000-4000-8000-000000000002', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Ravi', 'Tech', null, 'active'),
  ('e0000000-0000-4000-8000-0000000000b1', '5eed0000-0000-4000-8000-0000000000b1', 'Other', 'Tenant', null, 'active');

-- Module off: refused
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
do $$ begin
  perform public.field_checkin('check_in', null, null, null, null, null, 'e0000000-0000-4000-8000-000000000002');
  insert into _t values ('module off: check-in refused', false, null);
exception when others then insert into _t values ('module off: check-in refused', sqlerrm = 'MODULE_DISABLED', sqlerrm); end $$;
insert into _t select 'module off: tasks hidden', (select count(*) = 0 from public.field_tasks), null;
reset role;
insert into public.tenant_modules (tenant_id, module_id, enabled)
values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'mobile_workforce', true)
on conflict (tenant_id, module_id) do update set enabled = true;

-- Owner creates tasks
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
create temp table _a as
  with ins as (
    insert into public.field_tasks (title, employee_id, address, lat, lng, due_at, priority, checklist)
    values ('Install limiter', 'e0000000-0000-4000-8000-000000000001', 'Muscat', 23.588, 58.3829,
            now() + interval '1 day', 'high',
            '[{"label":"Fit device","done":false},{"label":"Seal","done":false}]')
    returning *)
  select * from ins;
grant select on _a to authenticated;
insert into _t select 'task numbered TSK', (select doc_number = 'TSK-00001' and status = 'assigned' from _a), (select doc_number from _a);
insert into _t select 'creator stamped', (select created_by = '129bbbae-fdfc-4d21-8a86-8949fec2403b' from _a), null;
create temp table _b as
  with ins as (
    insert into public.field_tasks (title, employee_id, due_at)
    values ('Overdue check', 'e0000000-0000-4000-8000-000000000001', now() - interval '2 hours')
    returning *)
  select * from ins;
grant select on _b to authenticated;
create temp table _c as
  with ins as (
    insert into public.field_tasks (title, employee_id) values ('Ravi job', 'e0000000-0000-4000-8000-000000000002')
    returning *)
  select * from ins;
grant select on _c to authenticated;
do $$ begin
  insert into public.field_tasks (title, employee_id, status) values ('x', 'e0000000-0000-4000-8000-000000000002', 'completed');
  insert into _t values ('client cannot set status', false, null);
exception when others then insert into _t values ('client cannot set status', sqlstate = '42501', sqlerrm); end $$;
do $$ begin
  insert into public.field_tasks (title, employee_id) values ('x', 'e0000000-0000-4000-8000-0000000000b1');
  insert into _t values ('other-tenant assignee refused', false, null);
exception when others then insert into _t values ('other-tenant assignee refused', true, sqlerrm); end $$;
do $$ begin
  insert into public.field_tasks (title, employee_id, checklist) values ('x', 'e0000000-0000-4000-8000-000000000002', '[{"label":""}]');
  insert into _t values ('bad checklist refused', false, null);
exception when others then insert into _t values ('bad checklist refused', sqlerrm = 'FIELD_INVALID_CHECKLIST', sqlerrm); end $$;
do $$ begin
  insert into public.field_tasks (title, employee_id, lat) values ('x', 'e0000000-0000-4000-8000-000000000002', 10);
  insert into _t values ('lat without lng refused', false, null);
exception when others then insert into _t values ('lat without lng refused', sqlstate = '23514', sqlerrm); end $$;
do $$ begin
  perform public.field_task_transition((select id from _c), 'completed', '{}');
  insert into _t values ('skip to completed refused', false, null);
exception when others then insert into _t values ('skip to completed refused', sqlerrm like 'ILLEGAL_FIELD_TASK_TRANSITION%', sqlerrm); end $$;
reset role;
insert into _t select 'assignee notified', exists (select 1 from public.notifications
  where kind = 'field.task_assigned' and recipient_id = '5eed0000-0000-4000-8000-00000000a003'
    and entity_id = (select id from _a)), null;
insert into _t select 'no notification without login', not exists (select 1 from public.notifications
  where kind = 'field.task_assigned' and entity_id = (select id from _c)), null;
insert into _t select 'task audited', exists (select 1 from public.audit_events where table_name = 'field_tasks'), null;

-- Viewer linked to Sara works their own task
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000a003","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"viewer"}}', true);
insert into _t select 'viewer sees own tasks only', (select count(*) = 2 and bool_and(employee_id = 'e0000000-0000-4000-8000-000000000001') from public.field_tasks), null;
do $$ begin
  update public.field_tasks set title = 'hacked' where id = (select id from _a);
  insert into _t values ('viewer cannot edit task', (select title = 'Install limiter' from public.field_tasks where id = (select id from _a)), 'no error');
exception when others then insert into _t values ('viewer cannot edit task', true, sqlerrm); end $$;
insert into _t select 'viewer accepts', (select status = 'accepted' and accepted_at is not null
  from public.field_task_transition((select id from _a), 'accepted', '{}')), null;
insert into _t select 'viewer starts', (select status = 'in_progress' from public.field_task_transition((select id from _a), 'in_progress', '{}')), null;
do $$ begin
  perform public.field_task_transition((select id from _a), null, '{"checklist":[{"label":"Fit device","done":true}]}');
  insert into _t values ('viewer cannot drop checklist items', false, null);
exception when others then insert into _t values ('viewer cannot drop checklist items', sqlerrm = 'FIELD_INVALID_CHECKLIST', sqlerrm); end $$;
do $$ begin
  perform public.field_task_transition((select id from _a), null, '{"checklist":[{"label":"Renamed","done":true},{"label":"Seal","done":false}]}');
  insert into _t values ('viewer cannot rename checklist', false, null);
exception when others then insert into _t values ('viewer cannot rename checklist', sqlerrm = 'FIELD_INVALID_CHECKLIST', sqlerrm); end $$;
insert into _t select 'viewer saves progress', (select status = 'in_progress' and checklist -> 0 ->> 'done' = 'true'
  from public.field_task_transition((select id from _a), null, '{"checklist":[{"label":"Fit device","done":true},{"label":"Seal","done":false}]}')), null;
do $$ begin
  perform public.field_task_transition((select id from _a), 'completed', '{"signature_data":"javascript:alert(1)"}');
  insert into _t values ('bad signature refused', false, null);
exception when others then insert into _t values ('bad signature refused', sqlerrm = 'FIELD_INVALID_SIGNATURE', sqlerrm); end $$;
do $$ begin
  perform public.field_task_transition((select id from _b), 'canceled', '{}');
  insert into _t values ('viewer cannot cancel', false, null);
exception when others then insert into _t values ('viewer cannot cancel', sqlerrm = 'FORBIDDEN', sqlerrm); end $$;
do $$ begin
  perform public.field_task_transition((select id from _c), 'accepted', '{}');
  insert into _t values ('viewer cannot touch others', false, null);
exception when others then insert into _t values ('viewer cannot touch others', sqlerrm = 'FIELD_TASK_NOT_FOUND', sqlerrm); end $$;
insert into _t select 'viewer completes with signature', (select status = 'completed' and completed_at is not null
  and signature_data like 'data:image/png;base64,%' and completion_notes = 'Done'
  from public.field_task_transition((select id from _a), 'completed',
    '{"completion_notes":"  Done ","signature_data":"data:image/png;base64,iVBORw0KGgo=","checklist":[{"label":"Fit device","done":true},{"label":"Seal","done":true}]}')), null;
do $$ begin
  perform public.field_task_transition((select id from _a), null, '{"completion_notes":"later"}');
  insert into _t values ('completed task locked', false, null);
exception when others then insert into _t values ('completed task locked', sqlerrm = 'DOC_LOCKED', sqlerrm); end $$;
-- Check-ins
insert into _t select 'viewer checks in with location', (select kind = 'check_in' and employee_id = 'e0000000-0000-4000-8000-000000000001'
  and lat = 23.588 and accuracy_m = 12.3 and created_by = '5eed0000-0000-4000-8000-00000000a003'
  from public.field_checkin('check_in', (select id from _b), 23.588, 58.3829, 12.34, 'On site')), null;
insert into _t select 'check-in without location ok', (select lat is null from public.field_checkin('check_out')), null;
do $$ begin
  perform public.field_checkin('check_in', null, 10, null);
  insert into _t values ('half location refused', false, null);
exception when others then insert into _t values ('half location refused', sqlerrm = 'FIELD_INVALID_LOCATION', sqlerrm); end $$;
do $$ begin
  perform public.field_checkin('check_in', null, 95, 10);
  insert into _t values ('out-of-range lat refused', false, null);
exception when others then insert into _t values ('out-of-range lat refused', sqlerrm = 'FIELD_INVALID_LOCATION', sqlerrm); end $$;
do $$ begin
  perform public.field_checkin('check_in', (select id from _c));
  insert into _t values ('check-in on others task refused', false, null);
exception when others then insert into _t values ('check-in on others task refused', sqlerrm = 'FIELD_TASK_NOT_FOUND', sqlerrm); end $$;
do $$ begin
  perform public.field_checkin('check_in', null, null, null, null, null, 'e0000000-0000-4000-8000-000000000002');
  insert into _t values ('viewer cannot check in others', false, null);
exception when others then insert into _t values ('viewer cannot check in others', sqlerrm = 'FORBIDDEN', sqlerrm); end $$;
do $$ begin
  insert into public.field_checkins (employee_id, kind) values ('e0000000-0000-4000-8000-000000000001', 'check_in');
  insert into _t values ('direct check-in write refused', false, null);
exception when others then insert into _t values ('direct check-in write refused', sqlstate = '42501', sqlerrm); end $$;
insert into _t select 'viewer sees own check-ins', (select count(*) = 2 from public.field_checkins), null;
reset role;
insert into _t select 'completion event emitted', exists (select 1 from public.domain_events
  where event = 'field_task.completed' and entity_id = (select id from _a) and (payload ->> 'signed')::boolean), null;

-- Owner (no employee profile) and manager actions
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
do $$ begin
  perform public.field_checkin('check_in');
  insert into _t values ('no profile check-in refused', false, null);
exception when others then insert into _t values ('no profile check-in refused', sqlerrm = 'FIELD_NO_EMPLOYEE_PROFILE', sqlerrm); end $$;
insert into _t select 'manager checks in for staff', (select employee_id = 'e0000000-0000-4000-8000-000000000002'
  from public.field_checkin('check_in', (select id from _c), null, null, null, null, 'e0000000-0000-4000-8000-000000000002')), null;
insert into _t select 'manager sees all check-ins', (select count(*) = 3 from public.field_checkins), null;
insert into _t select 'manager cancels', (select status = 'canceled' and canceled_at is not null
  from public.field_task_transition((select id from _c), 'canceled', '{}')), null;
insert into _t select 'manager replaces checklist', (select jsonb_array_length(checklist) = 1
  from public.field_task_transition((select id from _b), null, '{"checklist":[{"label":"New step"}]}')), null;
update public.field_tasks set employee_id = 'e0000000-0000-4000-8000-000000000002' where id = (select id from _b);
update public.field_tasks set employee_id = 'e0000000-0000-4000-8000-000000000001' where id = (select id from _b);
reset role;
insert into _t select 'reassign back is deduped', (select count(*) = 1 from public.notifications
  where kind = 'field.task_assigned' and entity_id = (select id from _b)), 'dedupe keeps one per assignee';

-- Overdue scanner
insert into _t select 'scanner notifies overdue', app.scan_due_field('170d2d86-5c22-4bcb-9d74-420c879419b2') > 0, null;
insert into _t select 'overdue to assignee', exists (select 1 from public.notifications
  where kind = 'field.task_overdue' and entity_id = (select id from _b)
    and recipient_id = '5eed0000-0000-4000-8000-00000000a003'), null;
insert into _t select 'overdue to managers', exists (select 1 from public.notifications
  where kind = 'field.task_overdue' and entity_id = (select id from _b)
    and recipient_id = '129bbbae-fdfc-4d21-8a86-8949fec2403b'), null;
insert into _t select 'scanner is idempotent', app.scan_due_field('170d2d86-5c22-4bcb-9d74-420c879419b2') = 0, null;
insert into _t select 'scanner skips module off', app.scan_due_field('5eed0000-0000-4000-8000-0000000000b1') = 0, null;

-- Other tenant sees nothing of ours
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000b001","role":"authenticated","app_metadata":{"tenant_id":"5eed0000-0000-4000-8000-0000000000b1","role":"owner"}}', true);
insert into _t select 'cross-tenant isolation', (select count(*) = 0 from public.field_tasks) and (select count(*) = 0 from public.field_checkins), null;
do $$ begin
  perform public.field_task_transition((select id from _b), 'accepted', '{}');
  insert into _t values ('cross-tenant transition refused', false, null);
exception when others then insert into _t values ('cross-tenant transition refused', sqlerrm = 'FIELD_TASK_NOT_FOUND', sqlerrm); end $$;
do $$ begin
  perform public.field_checkin('check_in', null, null, null, null, null, 'e0000000-0000-4000-8000-000000000001');
  insert into _t values ('cross-tenant check-in refused', false, null);
exception when others then insert into _t values ('cross-tenant check-in refused', sqlerrm = 'FIELD_EMPLOYEE_NOT_FOUND', sqlerrm); end $$;
reset role;

-- @print
select name, ok, detail from _t order by ok, name;
rollback;
