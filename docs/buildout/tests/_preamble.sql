-- Shared test helpers for cluster dry-runs (run AFTER the migration, inside the
-- same transaction). Everything is rolled back.
--   demo tenant 170d2d86-5c22-4bcb-9d74-420c879419b2
--   owner   129bbbae-fdfc-4d21-8a86-8949fec2403b   manager 950e38aa-2bd7-4c55-9dfc-9b4255316548
--   viewer: any uuid with role 'viewer' in the JWT (production has no viewer profile;
--           locally 5eed0000-0000-4000-8000-00000000a003 has one)
-- Usage:
--   reset role; select pg_temp.set_module('inventory', true);   -- as postgres
--   select pg_temp.become('129bbbae-fdfc-4d21-8a86-8949fec2403b', 'owner');  -- now authenticated
--   perform pg_temp.ok('07a my test', <bool>, <detail>);         -- inside DO blocks
--   select pg_temp.put('po', v_id); pg_temp.get('po')            -- carry ids between blocks
-- Every DO block that switches role must `reset role` at its start if it needs postgres.
reset role;
create temp table _results (name text primary key, pass boolean not null, detail text) on commit drop;
grant all on _results to public;
create temp table _ctx (k text primary key, v uuid) on commit drop;
grant all on _ctx to public;

create function pg_temp.become(p_uid uuid, p_role text,
  p_tenant uuid default '170d2d86-5c22-4bcb-9d74-420c879419b2')
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_uid, 'role', 'authenticated',
    'app_metadata', json_build_object('tenant_id', p_tenant, 'role', p_role))::text, true);
  set local role authenticated;
end $$;

create function pg_temp.ok(p_name text, p_pass boolean, p_detail text default null)
returns void language sql as $$
  insert into _results values (p_name, coalesce(p_pass, false), p_detail)
  on conflict (name) do update set pass = excluded.pass, detail = excluded.detail;
$$;

create function pg_temp.put(p_k text, p_v uuid) returns void language sql as $$
  insert into _ctx values (p_k, p_v) on conflict (k) do update set v = excluded.v;
$$;
create function pg_temp.get(p_k text) returns uuid language sql as $$
  select v from _ctx where k = p_k;
$$;

-- postgres-only helper (call after `reset role`)
create function pg_temp.set_module(p_module text, p_enabled boolean,
  p_tenant uuid default '170d2d86-5c22-4bcb-9d74-420c879419b2')
returns void language sql as $$
  insert into public.tenant_modules (tenant_id, module_id, enabled)
  values (p_tenant, p_module, p_enabled)
  on conflict (tenant_id, module_id) do update set enabled = excluded.enabled;
$$;
