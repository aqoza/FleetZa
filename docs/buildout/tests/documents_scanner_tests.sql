begin;
create temp table _t (name text, ok boolean, detail text);

insert into _t select 'disabled module returns 0',
  app.scan_due_documents('170d2d86-5c22-4bcb-9d74-420c879419b2') = 0, null;

insert into public.tenant_modules (tenant_id, module_id, enabled) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'documents', true),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'notifications', true)
on conflict (tenant_id, module_id) do update set enabled = true;

insert into public.documents (tenant_id, name, storage_path, expires_on) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'Lapsed permit', '170d2d86-5c22-4bcb-9d74-420c879419b2/a1/a.pdf', current_date - 3),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'Week card', '170d2d86-5c22-4bcb-9d74-420c879419b2/a2/b.pdf', current_date + 5),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'Month licence', '170d2d86-5c22-4bcb-9d74-420c879419b2/a3/c.pdf', current_date + 20),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'Far contract', '170d2d86-5c22-4bcb-9d74-420c879419b2/a4/d.pdf', current_date + 90),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'Ancient scan', '170d2d86-5c22-4bcb-9d74-420c879419b2/a5/e.pdf', current_date - 400),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'No expiry', '170d2d86-5c22-4bcb-9d74-420c879419b2/a6/f.pdf', null);

create temp table _managers as
  select count(*)::int as n from public.profiles
  where tenant_id = '170d2d86-5c22-4bcb-9d74-420c879419b2' and role in ('owner','admin','manager');

create temp table _run1 as select app.scan_due_documents('170d2d86-5c22-4bcb-9d74-420c879419b2') as n;
insert into _t select 'first run: 3 docs x managers', (select n from _run1) = 3 * (select n from _managers),
  format('run1=%s managers=%s', (select n from _run1), (select n from _managers));

insert into _t select 'second run is deduplicated',
  app.scan_due_documents('170d2d86-5c22-4bcb-9d74-420c879419b2') = 0, null;

insert into _t select 'severities by stage',
  (select array_agg(distinct severity order by severity) from public.notifications
     where kind = 'documents.expiring') = array['critical','warning'], null;

insert into _t select 'far, ancient and undated skipped',
  not exists (select 1 from public.notifications where kind = 'documents.expiring'
              and params->>'document' in ('Far contract','Ancient scan','No expiry')), null;

insert into _t select 'link + title',
  exists (select 1 from public.notifications where kind = 'documents.expiring'
          and params->>'stage' = 'expired' and link = '/documents/expiring'
          and title = 'Lapsed permit expired'), null;

update public.documents set expires_on = current_date + 25 where name = 'Week card';
insert into _t select 'new expiry date notifies again',
  app.scan_due_documents('170d2d86-5c22-4bcb-9d74-420c879419b2') = (select n from _managers), null;

insert into _t select 'not executable by authenticated',
  not has_function_privilege('authenticated', 'app.scan_due_documents(uuid)', 'execute'), null;

delete from public.notifications;
delete from public.notification_state;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
create temp table _refresh as select public.refresh_notifications(true) as n;
reset role;
insert into _t select 'refresh_notifications runs the scanner', (select n from _refresh) >= 3 * (select n from _managers),
  format('refresh=%s', (select n from _refresh));

-- @print
select name, ok, detail from _t order by ok, name;
rollback;
