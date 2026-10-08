begin;
create temp table _t (name text, ok boolean, detail text);
grant all on _t to authenticated;

-- A second member with an old sign-in and two sessions.
create table if not exists auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null, created_at timestamptz default now());
insert into auth.users (id, email, email_confirmed_at, last_sign_in_at)
values ('5ec00000-0000-4000-8000-000000000001', 'viewer@demo.test', null, now() - interval '200 days');
insert into public.profiles (id, tenant_id, email, full_name, role)
values ('5ec00000-0000-4000-8000-000000000001', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'viewer@demo.test', 'Vera Viewer', 'viewer');
insert into auth.sessions (user_id) values ('5ec00000-0000-4000-8000-000000000001'), ('5ec00000-0000-4000-8000-000000000001');
insert into public.api_keys (tenant_id, name, key_prefix, key_hash, scopes)
values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'Forever key', 'fm_aaaaaaaaa', repeat('a', 64), '{vehicles:read}');
insert into public.audit_events (tenant_id, table_name, row_id, action, at, diff)
values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'vehicles', gen_random_uuid(), 'update', now() - interval '400 days', '{}'),
       ('5eed0000-0000-4000-8000-0000000000b1', 'vehicles', gen_random_uuid(), 'update', now() - interval '400 days', '{}');

-- Module off: refused
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
do $$ begin
  perform public.security_posture();
  insert into _t values ('module off: posture refused', false, null);
exception when others then insert into _t values ('module off: posture refused', sqlerrm = 'MODULE_DISABLED', sqlerrm); end $$;
reset role;
insert into public.tenant_modules (tenant_id, module_id, enabled) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'audit_security', true),
  ('5eed0000-0000-4000-8000-0000000000b1', 'audit_security', true)
on conflict (tenant_id, module_id) do update set enabled = true;

-- Owner
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
create temp table _p as select public.security_posture() as p;
insert into _t select 'posture counts', (select (p->>'members')::int >= 2 and (p->>'admins')::int >= 1
  and (p->>'stale_members')::int >= 1 and (p->>'unconfirmed_members')::int >= 1
  and (p->>'api_keys_no_expiry')::int >= 1 and p ? 'webhooks_failing' from _p), (select p::text from _p);
create temp table _m as select * from public.security_members();
insert into _t select 'members listed with sign-in', exists (select 1 from _m where email = 'viewer@demo.test' and last_sign_in_at < now() - interval '100 days')
  and not exists (select 1 from _m where id not in (select id from public.profiles where tenant_id = '170d2d86-5c22-4bcb-9d74-420c879419b2')), null;
insert into _t select 'audit tables listed', exists (select 1 from public.audit_tables() t where t = 'vehicles'), null;
do $$ begin
  perform public.save_security_settings(2, false, null);
  insert into _t values ('idle below 5 refused', false, null);
exception when others then insert into _t values ('idle below 5 refused', sqlerrm like 'SECURITY_INVALID_SETTING%', sqlerrm); end $$;
select public.save_security_settings(30, true, 365);
select public.save_security_settings(30, true, 365);
insert into _t select 'settings upserted, members can read', (select count(*) = 1 and bool_and(session_idle_minutes = 30) from public.security_settings), null;
do $$ begin
  insert into public.security_settings (tenant_id, session_idle_minutes) values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 60);
  insert into _t values ('direct settings write refused', false, null);
exception when others then insert into _t values ('direct settings write refused', sqlstate = '42501', sqlerrm); end $$;
do $$ begin
  perform public.revoke_member_sessions('129bbbae-fdfc-4d21-8a86-8949fec2403b');
  insert into _t values ('cannot sign out self', false, null);
exception when others then insert into _t values ('cannot sign out self', sqlerrm = 'CANNOT_SIGN_OUT_SELF', sqlerrm); end $$;
do $$ begin
  perform public.revoke_member_sessions('5ec00000-0000-4000-8000-0000000000ff');
  insert into _t values ('unknown member refused', false, null);
exception when others then insert into _t values ('unknown member refused', sqlerrm = 'MEMBER_NOT_FOUND', sqlerrm); end $$;
create temp table _rv as select public.revoke_member_sessions('5ec00000-0000-4000-8000-000000000001') as n;
reset role;
insert into _t select 'sessions revoked', (select n = 2 from _rv) and not exists (select 1 from auth.sessions where user_id = '5ec00000-0000-4000-8000-000000000001'), null;
insert into _t select 'revocation audited', exists (select 1 from public.audit_events where table_name = 'auth_sessions' and row_id = '5ec00000-0000-4000-8000-000000000001'), null;
insert into _t select 'settings change audited', exists (select 1 from public.audit_events where table_name = 'security_settings'), null;

-- Admin cannot sign out the owner; viewer cannot read posture
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5ec00000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"admin"}}', true);
do $$ begin
  perform public.revoke_member_sessions('129bbbae-fdfc-4d21-8a86-8949fec2403b');
  insert into _t values ('cannot sign out owner', false, null);
exception when others then insert into _t values ('cannot sign out owner', sqlerrm = 'CANNOT_SIGN_OUT_OWNER', sqlerrm); end $$;
select set_config('request.jwt.claims',
  '{"sub":"5ec00000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"viewer"}}', true);
do $$ begin
  perform public.security_posture();
  insert into _t values ('viewer refused', false, null);
exception when others then insert into _t values ('viewer refused', sqlerrm = 'FORBIDDEN', sqlerrm); end $$;
insert into _t select 'viewer reads settings (idle timer)', (select count(*) = 1 from public.security_settings), null;
reset role;

-- Retention: only this tenant's old rows go
select app.scan_due_security('170d2d86-5c22-4bcb-9d74-420c879419b2');
insert into _t select 'retention purges old rows', not exists (select 1 from public.audit_events where tenant_id = '170d2d86-5c22-4bcb-9d74-420c879419b2' and at < now() - interval '365 days'), null;
insert into _t select 'retention keeps recent rows', exists (select 1 from public.audit_events where tenant_id = '170d2d86-5c22-4bcb-9d74-420c879419b2'), null;
insert into _t select 'other tenant untouched', exists (select 1 from public.audit_events where tenant_id = '5eed0000-0000-4000-8000-0000000000b1' and at < now() - interval '365 days'), null;

-- @print
select name, ok, detail from _t order by ok, name;
rollback;
