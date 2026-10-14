-- Run on real PostgreSQL (PGlite has no statement_timeout interrupt).
-- Demo only; temporary scanner functions and module settings are rolled back.
begin;
set local lock_timeout='3s';
set local statement_timeout='60s';
create temp table _timeout_marker(ran boolean);
grant all on _timeout_marker to authenticated;
create function app.scan_due_000_audit_slow(uuid) returns integer language plpgsql
as $$ begin perform pg_sleep(1); return 5; end $$;
create function app.scan_due_001_audit_marker(uuid) returns integer language plpgsql
as $$ begin insert into _timeout_marker values(true); return 1; end $$;
insert into public.tenant_modules(tenant_id,module_id,enabled)
values('170d2d86-5c22-4bcb-9d74-420c879419b2','notifications',true)
on conflict(tenant_id,module_id) do update set enabled=true;
update public.notification_state set last_scan_at=now()-interval '1 hour',last_scan_count=-1
where tenant_id='170d2d86-5c22-4bcb-9d74-420c879419b2';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}',true);
set local statement_timeout='300ms';
do $$
declare n integer;
begin
  n:=public.refresh_notifications(true);
  if n<>0 then raise exception 'Expected timeout before scanner result'; end if;
  if exists(select 1 from _timeout_marker) then raise exception 'Later scanner ran after timeout'; end if;
  if not exists(select 1 from public.notification_state where tenant_id=app.tenant_id() and last_scan_at=now() and last_scan_count=0) then
    raise exception 'Throttle claim lost'; end if;
end $$;
set local statement_timeout='60s';
rollback;
select '3 real-timer notification checks passed; all writes and test functions rolled back' as result;
