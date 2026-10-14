-- Production-safe module read sweep. Demo module flags are rolled back.
begin;
set local lock_timeout='3s';
set local statement_timeout='60s';
create temp table _read_checks(name text, ok boolean, detail text);
grant all on _read_checks to authenticated;
create temp table _read_tables as
select c.relname, exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='tenant_id' and not a.attisdropped) as tenant_owned
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' and has_table_privilege('authenticated',c.oid,'SELECT');
grant select on _read_tables to authenticated;
insert into public.tenant_modules(tenant_id,module_id,enabled)
select '170d2d86-5c22-4bcb-9d74-420c879419b2',m,true from unnest(array['fleet','drivers','fuel','gps_tracking','driver_behavior','trip_planning','dispatch','maintenance','preventive','inspections','issues','workshop','predictive_ai','renewals','speed_limiters','sl_certificates','insurance_mgmt','incidents','regulatory','tms','logistics_delivery','assets','inventory','purchasing','sales','pos','crm','finance','billing','contracts','employees','payroll_hr','mobile_workforce','customers','suppliers','customer_portal','vendor_portal','reports','bi_analytics','documents','workflow_automation','integrations','iot_devices','notifications','audit_security','multi_company']) m
on conflict(tenant_id,module_id) do update set enabled=true;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}',true);
do $$
declare r record; leaked boolean; fn text;
begin
for r in select * from _read_tables order by relname loop
  begin
    execute format('select 1 from public.%I limit 1',r.relname);
    if r.tenant_owned then
      execute format('select exists(select 1 from public.%I where tenant_id is distinct from app.tenant_id())',r.relname) into leaked;
      if leaked then raise exception 'CROSS_TENANT_READ'; end if;
    end if;
    insert into _read_checks values('table: '||r.relname,true,null);
  exception when others then insert into _read_checks values('table: '||r.relname,false,sqlstate||': '||sqlerrm);
  end;
end loop;
foreach fn in array array['audit_tables','branch_stats','finance_balances','finance_pending_counts','insurance_uninsured_vehicles','inventory_low_stock','inventory_summary','inventory_valuation','predictive_vehicle_health','security_members','security_posture','fuel_summary','sales_summary','sales_report_pipeline','sales_report_receivables','sales_report_revenue','sales_report_payments','sales_report_jobs_pending_invoice','sales_report_certificates_pending_invoice','sales_report_renewals_to_quote'] loop
  begin
    execute format('select * from public.%I()',fn);
    insert into _read_checks values('report: '||fn,true,null);
  exception when others then insert into _read_checks values('report: '||fn,false,sqlstate||': '||sqlerrm);
  end;
end loop;
end $$;
-- @print
select name,ok,detail from _read_checks order by ok,name;
do $$ begin
if exists(select 1 from _read_checks where ok is distinct from true) then
raise exception 'MODULE_READ_REGRESSION: %',(select json_agg(r) from _read_checks r where not ok);
end if; end $$;
rollback;
