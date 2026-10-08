begin;
create temp table _t (name text, ok boolean, detail text);
grant all on _t to authenticated;

insert into public.tenant_modules (tenant_id, module_id, enabled) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'notifications', true)
on conflict (tenant_id, module_id) do update set enabled = true;

-- Two for the demo owner, one for another member of the tenant.
create temp table _other as
  select id from public.profiles where tenant_id = '170d2d86-5c22-4bcb-9d74-420c879419b2' and id <> '129bbbae-fdfc-4d21-8a86-8949fec2403b' limit 1;
grant all on _other to authenticated;
insert into public.notifications (tenant_id, recipient_id, kind, title) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', '129bbbae-fdfc-4d21-8a86-8949fec2403b', 'test.a', 'A'),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', '129bbbae-fdfc-4d21-8a86-8949fec2403b', 'test.b', 'B');
insert into public.notifications (tenant_id, recipient_id, kind, title)
  select '170d2d86-5c22-4bcb-9d74-420c879419b2', id, 'test.c', 'C' from _other;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);

insert into _t select 'marks one by id',
  public.mark_notifications_read(array(select id from public.notifications where kind = 'test.a')) = 1, null;
insert into _t select 'already read is not counted again',
  public.mark_notifications_read(array(select id from public.notifications where kind = 'test.a')) = 0, null;
insert into _t select 'mark all marks only own unread', public.mark_notifications_read() = 1, null;
insert into _t select 'mark unread again', public.mark_notifications_read(null, false) = 2, null;
reset role;

insert into _t select 'other member untouched',
  (select read_at is null from public.notifications where kind = 'test.c' limit 1)
  and (select count(*) from public.notifications where kind = 'test.c') = (select count(*) from _other), null;
insert into _t select 'anon cannot execute',
  not has_function_privilege('anon', 'public.mark_notifications_read(uuid[], boolean)', 'execute'), null;

-- @print
select name, ok, detail from _t order by ok, name;
rollback;
