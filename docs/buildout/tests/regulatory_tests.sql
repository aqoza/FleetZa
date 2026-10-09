-- Dry-run tests for 20261008000025_regulatory.sql (PGlite replica:
-- node docs/buildout/pglite/harness.mjs run docs/buildout/tests/regulatory_tests.sql).
begin;
create temp table _t (name text, ok boolean, detail text);
grant all on _t to authenticated, service_role;

insert into public.tenant_modules (tenant_id, module_id, enabled) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'notifications', true),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'employees', true)
on conflict (tenant_id, module_id) do update set enabled = true;
insert into public.drivers (id, tenant_id, first_name, last_name, status) values
  ('a7e1c0de-0025-4b2c-9d3e-4f5a6b7c8d01', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Salim', 'Harthi', 'active'),
  ('a7e1c0de-0025-4b2c-9d3e-4f5a6b7c8d02', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Old', 'Driver', 'inactive');
insert into public.employees (id, tenant_id, first_name, status) values
  ('a7e1c0de-0025-4b2c-9d3e-4f5a6b7c8e01', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Aisha', 'active'),
  ('a7e1c0de-0025-4b2c-9d3e-4f5a6b7c8e02', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Gone', 'terminated');
insert into public.documents (id, tenant_id, name, storage_path) values
  ('a7e1c0de-0025-4b2c-9d3e-4f5a6b7c8f01', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Inspection.pdf',
   '170d2d86-5c22-4bcb-9d74-420c879419b2/a7e1c0de-0025-4b2c-9d3e-4f5a6b7c8f01/Inspection.pdf'),
  ('a7e1c0de-0025-4b2c-9d3e-4f5a6b7c8f0b', '5eed0000-0000-4000-8000-0000000000b1', 'Other.pdf',
   '5eed0000-0000-4000-8000-0000000000b1/a7e1c0de-0025-4b2c-9d3e-4f5a6b7c8f0b/Other.pdf');

-- Module off
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
do $$ begin
  insert into public.compliance_requirements (code, title, applies_to) values ('X', 'x', 'company');
  insert into _t values ('module off: insert refused', false, null);
exception when others then insert into _t values ('module off: insert refused', sqlstate = '42501', sqlerrm); end $$;
do $$ begin
  perform public.regulatory_seed_templates('OM');
  insert into _t values ('module off: seeding refused', false, null);
exception when others then insert into _t values ('module off: seeding refused', sqlerrm = 'MODULE_DISABLED', sqlerrm); end $$;
reset role;
insert into public.tenant_modules (tenant_id, module_id, enabled)
values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'regulatory', true)
on conflict (tenant_id, module_id) do update set enabled = true;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);

-- Templates
create temp table _n (n integer);
grant all on _n to authenticated;
insert into _n select public.regulatory_seed_templates('om');
insert into _t select 'Oman templates seeded unverified',
  (select n > 5 from _n)
  and (select count(*) = (select n from _n) from public.compliance_requirements where country = 'OM' and not verified)
  and exists (select 1 from public.compliance_requirements where code = 'OM-SL' and applies_to = 'vehicle' and title_ar is not null), null;
insert into _t select 'seeding again adds nothing', public.regulatory_seed_templates('OM') = 0, null;
select public.regulatory_seed_templates('FR');
insert into _t select 'unknown country gets the generic list',
  exists (select 1 from public.compliance_requirements where code = 'GEN-CO-VAT' and country is null), null;

-- Requirements
insert into public.compliance_requirements (code, title, applies_to, category, frequency_months, lead_days, country)
values (' veh-insp ', 'Annual inspection', 'vehicle', 'safety', 12, 30, 'om');
insert into _t select 'code and country normalized, verified by default',
  exists (select 1 from public.compliance_requirements where code = 'VEH-INSP' and country = 'OM' and verified), null;
do $$ begin
  insert into public.compliance_requirements (code, title, applies_to) values ('Veh-Insp', 'dup', 'vehicle');
  insert into _t values ('duplicate code refused', false, null);
exception when others then insert into _t values ('duplicate code refused', sqlstate = '23505', sqlerrm); end $$;
do $$ begin
  insert into public.compliance_requirements (code, title, applies_to, reference_url) values ('BAD-URL', 'x', 'company', 'javascript:alert(1)');
  insert into _t values ('non-http reference refused', false, null);
exception when others then insert into _t values ('non-http reference refused', sqlstate = '23514', sqlerrm); end $$;
insert into public.compliance_requirements (code, title, applies_to, category, frequency_months, lead_days)
values ('CO-VAT', 'VAT return', 'company', 'tax', 3, 14),
       ('DRV-MED', 'Medical', 'driver', 'safety', null, 30),
       ('EMP-VISA', 'Visa', 'employee', 'permit', 24, 60);

-- Generation
insert into _t select 'vehicle generation covers company vehicles in service',
  public.regulatory_generate_obligations((select id from public.compliance_requirements where code = 'VEH-INSP'), current_date + 20)
    = (select count(*) from public.vehicles where tenant_id = '170d2d86-5c22-4bcb-9d74-420c879419b2'
       and ownership = 'company' and status <> 'retired'), null;
insert into _t select 'generating again skips subjects with an open obligation',
  public.regulatory_generate_obligations((select id from public.compliance_requirements where code = 'VEH-INSP'), current_date + 40) = 0, null;
select public.regulatory_generate_obligations((select id from public.compliance_requirements where code = 'CO-VAT'), current_date - 3);
insert into _t select 'company obligation has no subject',
  exists (select 1 from public.compliance_obligations o join public.compliance_requirements r on r.id = o.requirement_id
              where r.code = 'CO-VAT' and o.subject_type = 'company' and o.subject_id is null), null;
select public.regulatory_generate_obligations((select id from public.compliance_requirements where code = 'DRV-MED'), current_date + 5);
insert into _t select 'driver generation skips inactive drivers',
  exists (select 1 from public.compliance_obligations where subject_id = 'a7e1c0de-0025-4b2c-9d3e-4f5a6b7c8d01')
  and not exists (select 1 from public.compliance_obligations where subject_id = 'a7e1c0de-0025-4b2c-9d3e-4f5a6b7c8d02'), null;
select public.regulatory_generate_obligations((select id from public.compliance_requirements where code = 'EMP-VISA'), current_date + 50);
insert into _t select 'employee generation skips terminated employees',
  exists (select 1 from public.compliance_obligations where subject_id = 'a7e1c0de-0025-4b2c-9d3e-4f5a6b7c8e01')
  and not exists (select 1 from public.compliance_obligations where subject_id = 'a7e1c0de-0025-4b2c-9d3e-4f5a6b7c8e02'), null;
update public.compliance_requirements set active = false where code = 'GEN-CO-VAT';
do $$ begin
  perform public.regulatory_generate_obligations((select id from public.compliance_requirements where code = 'GEN-CO-VAT'), current_date);
  insert into _t values ('inactive requirement generates nothing', false, null);
exception when others then insert into _t values ('inactive requirement generates nothing', sqlerrm = 'REQUIREMENT_INACTIVE', sqlerrm); end $$;

-- Obligation rules
do $$ begin
  insert into public.compliance_obligations (requirement_id, subject_type, subject_id, due_date)
  values ((select id from public.compliance_requirements where code = 'VEH-INSP'), 'driver', 'a7e1c0de-0025-4b2c-9d3e-4f5a6b7c8d01', current_date);
  insert into _t values ('subject type must match the requirement', false, null);
exception when others then insert into _t values ('subject type must match the requirement', sqlerrm = 'OBLIGATION_SUBJECT_MISMATCH', sqlerrm); end $$;
do $$ begin
  insert into public.compliance_obligations (requirement_id, subject_type, subject_id, due_date)
  values ((select id from public.compliance_requirements where code = 'VEH-INSP'), 'vehicle', '5eed0000-0000-4000-8000-00000000e0b1', current_date);
  insert into _t values ('other tenant vehicle refused', false, null);
exception when others then insert into _t values ('other tenant vehicle refused', sqlerrm = 'OBLIGATION_SUBJECT_NOT_FOUND', sqlerrm); end $$;
do $$ begin
  update public.compliance_obligations set subject_id = '5eed0000-0000-4000-8000-00000000e002'
  where subject_id = '5eed0000-0000-4000-8000-00000000e001';
  insert into _t values ('subject fixed after creation', false, null);
exception when others then insert into _t values ('subject fixed after creation', sqlstate = '42501' or sqlerrm = 'OBLIGATION_LOCKED', sqlerrm); end $$;
do $$ begin
  update public.compliance_obligations set evidence_document_id = 'a7e1c0de-0025-4b2c-9d3e-4f5a6b7c8f0b'
  where subject_id = '5eed0000-0000-4000-8000-00000000e001';
  insert into _t values ('other tenant evidence refused', false, null);
exception when others then insert into _t values ('other tenant evidence refused', sqlerrm = 'CROSS_TENANT_REFERENCE', sqlerrm); end $$;
do $$ begin
  update public.compliance_obligations set status = 'compliant', completed_on = current_date + 5
  where subject_id = '5eed0000-0000-4000-8000-00000000e001';
  insert into _t values ('future completion refused', false, null);
exception when others then insert into _t values ('future completion refused', sqlerrm = 'INVALID_COMPLETION_DATE', sqlerrm); end $$;
do $$ begin
  update public.compliance_requirements set applies_to = 'driver' where code = 'VEH-INSP';
  insert into _t values ('scope fixed once obligations exist', false, null);
exception when others then insert into _t values ('scope fixed once obligations exist', sqlerrm = 'REQUIREMENT_IN_USE', sqlerrm); end $$;
do $$ begin
  delete from public.compliance_requirements where code = 'VEH-INSP';
  insert into _t values ('requirement with obligations not deletable', false, null);
exception when others then insert into _t values ('requirement with obligations not deletable', sqlerrm = 'REQUIREMENT_IN_USE', sqlerrm); end $$;
delete from public.compliance_requirements where code = 'BH-CR' or code = 'GEN-EMP-PERMIT';
insert into _t select 'unused requirement deletable', not exists (select 1 from public.compliance_requirements where code = 'GEN-EMP-PERMIT'), null;

-- Completion
create temp table _o on commit drop as
  select o.id, o.due_date from public.compliance_obligations o
  where o.subject_id = '5eed0000-0000-4000-8000-00000000e001';
grant all on _o to authenticated;
create temp table _next (id uuid);
grant all on _next to authenticated;
insert into _next select public.obligation_complete((select id from _o), null, 'a7e1c0de-0025-4b2c-9d3e-4f5a6b7c8f01', 'Passed');
insert into _t select 'completion stamps today, evidence and notes',
  exists (select 1 from public.compliance_obligations where id = (select id from _o) and status = 'compliant'
          and completed_on = (now() at time zone (select coalesce(timezone, 'UTC') from public.tenants where id = '170d2d86-5c22-4bcb-9d74-420c879419b2'))::date
          and evidence_document_id = 'a7e1c0de-0025-4b2c-9d3e-4f5a6b7c8f01' and notes = 'Passed'), null;
insert into _t select 'early completion schedules the next from the due date',
  (select due_date = ((select due_date from _o) + interval '12 months')::date and status = 'pending'
   from public.compliance_obligations where id = (select id from _next)), null;
insert into _t select 'completing again does not duplicate the next',
  public.obligation_complete((select id from _o)) is null
  and (select count(*) = 2 from public.compliance_obligations where subject_id = '5eed0000-0000-4000-8000-00000000e001'), null;
delete from _next;
insert into _next select public.obligation_complete((select o.id from public.compliance_obligations o
                                                     join public.compliance_requirements r on r.id = o.requirement_id
                                                     where r.code = 'CO-VAT' and o.status = 'pending'));
insert into _t select 'late completion schedules the next from completion',
  (select due_date = ((now() at time zone (select coalesce(timezone, 'UTC') from public.tenants where id = '170d2d86-5c22-4bcb-9d74-420c879419b2'))::date + interval '3 months')::date from public.compliance_obligations where id = (select id from _next)), null;
insert into _t select 'one-off requirement schedules nothing',
  public.obligation_complete((select id from public.compliance_obligations
                              where subject_id = 'a7e1c0de-0025-4b2c-9d3e-4f5a6b7c8d01')) is null, null;
update public.compliance_obligations set status = 'pending' where subject_id = 'a7e1c0de-0025-4b2c-9d3e-4f5a6b7c8d01';
insert into _t select 'reopening clears the completion date',
  (select completed_on is null from public.compliance_obligations where subject_id = 'a7e1c0de-0025-4b2c-9d3e-4f5a6b7c8d01'), null;
reset role;

-- Scanner
insert into public.compliance_obligations (tenant_id, requirement_id, subject_type, subject_id, due_date)
select '170d2d86-5c22-4bcb-9d74-420c879419b2', id, 'employee', 'a7e1c0de-0025-4b2c-9d3e-4f5a6b7c8e01', current_date - 2
from public.compliance_requirements where code = 'EMP-VISA' and tenant_id = '170d2d86-5c22-4bcb-9d74-420c879419b2';
select app.scan_due_regulatory('170d2d86-5c22-4bcb-9d74-420c879419b2');
insert into _t select 'overdue obligations notify managers per requirement',
  exists (select 1 from public.notifications n join public.compliance_requirements r on r.id = n.entity_id
          where n.kind = 'regulatory.obligation_due' and r.code = 'EMP-VISA' and n.params->>'stage' = 'overdue'
            and n.params->>'count' = '1' and n.severity = 'critical'), null;
insert into _t select 'due-soon obligations notify with a warning',
  exists (select 1 from public.notifications n join public.compliance_requirements r on r.id = n.entity_id
          where n.kind = 'regulatory.obligation_due' and r.code = 'VEH-INSP' and n.params->>'stage' = 'lead'
            and n.severity = 'warning' and (n.params->>'count')::int >= 1), null;
insert into _t select 'obligations outside the lead window stay quiet',
  not exists (select 1 from public.notifications n join public.compliance_requirements r on r.id = n.entity_id
              where n.kind = 'regulatory.obligation_due' and r.code = 'CO-VAT'), null;
create temp table _c as select count(*) as n from public.notifications where kind = 'regulatory.obligation_due';
select app.scan_due_regulatory('170d2d86-5c22-4bcb-9d74-420c879419b2');
insert into _t select 'scanning again is deduplicated',
  (select count(*) from public.notifications where kind = 'regulatory.obligation_due') = (select n from _c), null;

-- Viewer
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000a003","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"viewer"}}', true);
insert into _t select 'viewer reads the register and obligations',
  (select count(*) > 0 from public.compliance_requirements) and (select count(*) > 0 from public.compliance_obligations), null;
do $$ begin
  insert into public.compliance_requirements (code, title, applies_to) values ('VIEW', 'x', 'company');
  insert into _t values ('viewer cannot add requirements', false, null);
exception when others then insert into _t values ('viewer cannot add requirements', sqlstate = '42501', sqlerrm); end $$;
do $$ begin
  perform public.obligation_complete((select id from public.compliance_obligations where status = 'pending' limit 1));
  insert into _t values ('viewer cannot complete obligations', false, null);
exception when others then insert into _t values ('viewer cannot complete obligations', sqlerrm = 'FORBIDDEN' or sqlstate = '42501', sqlerrm); end $$;
reset role;

-- Other tenant
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000b001","role":"authenticated","app_metadata":{"tenant_id":"5eed0000-0000-4000-8000-0000000000b1","role":"owner"}}', true);
insert into _t select 'cross-tenant isolation',
  (select count(*) = 0 from public.compliance_requirements) and (select count(*) = 0 from public.compliance_obligations), null;
reset role;

-- @print
select name, ok, detail from _t order by ok, name;
rollback;
