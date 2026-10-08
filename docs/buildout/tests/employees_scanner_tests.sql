begin;
create temp table _t (name text, ok boolean, detail text);

-- Module off: nothing happens.
insert into _t select 'disabled module returns 0',
  app.scan_due_employees('170d2d86-5c22-4bcb-9d74-420c879419b2') = 0, null;

insert into public.tenant_modules (tenant_id, module_id, enabled) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'employees', true),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'notifications', true)
on conflict (tenant_id, module_id) do update set enabled = true;

insert into public.employees (tenant_id, first_name, last_name, status, passport_expiry, residence_permit_expiry, work_permit_expiry) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'Exp', 'Ired', 'active', current_date - 3, null, null),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'Week', 'Left', 'active', null, current_date + 5, null),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'Month', 'Left', 'on_leave', null, null, current_date + 20),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'Two', 'Months', 'active', current_date + 45, null, null),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'Far', 'Away', 'active', current_date + 200, null, null),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'Gone', 'Person', 'terminated', current_date - 1, null, null);

create temp table _managers as
  select count(*)::int as n from public.profiles
  where tenant_id = '170d2d86-5c22-4bcb-9d74-420c879419b2' and role in ('owner','admin','manager');

create temp table _run1 as select app.scan_due_employees('170d2d86-5c22-4bcb-9d74-420c879419b2') as n;
insert into _t select 'first run: 4 docs x managers', (select n from _run1) = 4 * (select n from _managers),
  format('run1=%s managers=%s', (select n from _run1), (select n from _managers));

insert into _t select 'second run is deduplicated',
  app.scan_due_employees('170d2d86-5c22-4bcb-9d74-420c879419b2') = 0, null;

insert into _t select 'severities by stage',
  (select array_agg(distinct severity order by severity) from public.notifications
     where kind = 'employees.document_expiring') = array['critical','info','warning'], null;

insert into _t select 'terminated and far-off skipped',
  not exists (select 1 from public.notifications where kind = 'employees.document_expiring'
              and (params->>'employee' in ('Gone Person','Far Away'))), null;

insert into _t select 'link + params',
  exists (select 1 from public.notifications where kind = 'employees.document_expiring'
          and params->>'stage' = 'expired' and params->>'document' = 'passport'
          and link like '/employees/%' and title = 'Exp Ired: passport expired'), null;

-- Renewing moves into a new stage key: a new expiry notifies again.
update public.employees set residence_permit_expiry = current_date + 25 where first_name = 'Week';
insert into _t select 'new expiry date notifies again',
  app.scan_due_employees('170d2d86-5c22-4bcb-9d74-420c879419b2') = (select n from _managers), null;

-- Other tenant untouched.
insert into _t select 'other tenant gets nothing',
  not exists (select 1 from public.notifications where tenant_id = '5eed0000-0000-4000-8000-0000000000b1'), null;

-- Clients cannot call it.
insert into _t select 'not executable by authenticated',
  not has_function_privilege('authenticated', 'app.scan_due_employees(uuid)', 'execute'), null;

-- refresh_notifications discovers it (as the demo owner).
delete from public.notifications;
delete from public.notification_state;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
create temp table _refresh as select public.refresh_notifications(true) as n;
reset role;
insert into _t select 'refresh_notifications runs the scanner', (select n from _refresh) >= 4 * (select n from _managers),
  format('refresh=%s', (select n from _refresh));

-- @print
select name, ok, detail from _t order by ok, name;
rollback;
