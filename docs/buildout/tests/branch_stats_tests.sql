begin;
create temp table _t (name text, ok boolean, detail text);
grant all on _t to authenticated;

insert into public.tenant_modules (tenant_id, module_id, enabled) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'multi_company', true)
on conflict (tenant_id, module_id) do update set enabled = true;

insert into public.branches (id, tenant_id, name) values
  ('b0000000-0000-4000-8000-000000000001', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Muscat'),
  ('b0000000-0000-4000-8000-000000000002', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Sohar');
create temp table _veh as select id from public.vehicles where tenant_id = '170d2d86-5c22-4bcb-9d74-420c879419b2' order by id limit 2;
update public.vehicles set branch_id = 'b0000000-0000-4000-8000-000000000001' where id in (select id from _veh);

-- Guard: another tenant's branch is refused.
insert into public.branches (id, tenant_id, name) values ('b0000000-0000-4000-8000-0000000000ff', '5eed0000-0000-4000-8000-0000000000b1', 'Foreign');
do $$
begin
  update public.vehicles set branch_id = 'b0000000-0000-4000-8000-0000000000ff'
   where id = (select id from _veh limit 1);
  insert into _t values ('cross-tenant vehicle branch refused', false, 'no error');
exception when others then
  insert into _t values ('cross-tenant vehicle branch refused', sqlerrm like 'CROSS_TENANT_REFERENCE%', sqlerrm);
end $$;
do $$
begin
  update public.drivers set branch_id = 'b0000000-0000-4000-8000-0000000000ff'
   where id = (select id from public.drivers where tenant_id = '170d2d86-5c22-4bcb-9d74-420c879419b2' limit 1);
  insert into _t values ('cross-tenant driver branch refused',
    not exists (select 1 from public.drivers where tenant_id = '170d2d86-5c22-4bcb-9d74-420c879419b2'), 'no drivers to test');
exception when others then
  insert into _t values ('cross-tenant driver branch refused', sqlerrm like 'CROSS_TENANT_REFERENCE%', sqlerrm);
end $$;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
create temp table _s as select * from public.branch_stats();
reset role;

insert into _t select 'only own tenant branches', (select count(*) from _s) = 2, (select count(*)::text from _s);
insert into _t select 'vehicle count', (select vehicle_count from _s where branch_id = 'b0000000-0000-4000-8000-000000000001') = (select count(*) from _veh), null;
insert into _t select 'empty branch zeros', (select vehicle_count + driver_count + employee_count + warehouse_count from _s where branch_id = 'b0000000-0000-4000-8000-000000000002') = 0, null;

-- @print
select name, ok, detail from _t order by ok, name;
rollback;
