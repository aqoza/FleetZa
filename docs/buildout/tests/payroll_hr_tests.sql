begin;
create temp table _t (name text, ok boolean, detail text);
grant all on _t to authenticated;

-- Fixture: Saudi tenant, two employees with salaries, the viewer linked to one.
update public.tenants set country = 'SA', currency = 'SAR', currency_decimals = 2
 where id = '170d2d86-5c22-4bcb-9d74-420c879419b2';
insert into public.tenant_modules (tenant_id, module_id, enabled) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'employees', true),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'notifications', true),
  ('5eed0000-0000-4000-8000-0000000000b1', 'employees', true),
  ('5eed0000-0000-4000-8000-0000000000b1', 'payroll_hr', true)
on conflict (tenant_id, module_id) do update set enabled = true;
insert into public.employees (id, tenant_id, first_name, last_name, nationality, hire_date,
  basic_salary, housing_allowance, transport_allowance, other_allowance, hourly_rate, user_id, status)
values
  ('e0000000-0000-4000-8000-000000000001', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Sara', 'Saudi', 'SA',
   '2020-01-01', 6000, 1500, 500, 0, null, '5eed0000-0000-4000-8000-00000000a003', 'active'),
  ('e0000000-0000-4000-8000-000000000002', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Ravi', 'Expat', 'IN',
   '2026-09-16', 3000, 0, 0, 200, 20, null, 'active'),
  ('e0000000-0000-4000-8000-000000000003', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Nora', 'Nopay', 'SA',
   '2020-01-01', null, null, null, null, null, null, 'active'),
  ('e0000000-0000-4000-8000-0000000000b1', '5eed0000-0000-4000-8000-0000000000b1', 'Other', 'Tenant', 'SA',
   '2020-01-01', 9000, 0, 0, 0, null, null, 'active');

-- Module off: refused
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
do $$ begin
  perform public.hr_seed(null);
  insert into _t values ('module off: seed refused', false, null);
exception when others then insert into _t values ('module off: seed refused', sqlerrm = 'MODULE_DISABLED', sqlerrm); end $$;
reset role;
insert into public.tenant_modules (tenant_id, module_id, enabled)
values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'payroll_hr', true)
on conflict (tenant_id, module_id) do update set enabled = true;

-- Owner: seed + settings
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
create temp table _seed as select public.hr_seed(array[5, 6]) as n;
insert into _t select 'seed creates six types', (select n = 6 from _seed), (select n::text from _seed);
insert into _t select 'seed is idempotent', public.hr_seed(array[0]) = 0, null;
insert into _t select 'seed wrote weekend once', (select weekend_days = '{5,6}' from public.hr_settings), null;
do $$ begin
  perform public.save_hr_settings(array[5, 6], 0.5, 1.25, 0, 0, true);
  insert into _t values ('bad daily hours refused', false, null);
exception when others then insert into _t values ('bad daily hours refused', sqlerrm = 'HR_INVALID_SETTING', sqlerrm); end $$;
select public.save_hr_settings(array[6, 5, 5], 8, 1.5, 9.75, 11.75, true);
insert into _t select 'settings saved (dedup weekend)', (select weekend_days = '{5,6}' and overtime_multiplier = 1.5 from public.hr_settings), null;
do $$ begin
  update public.hr_settings set standard_daily_hours = 9;
  insert into _t values ('direct settings write refused', (select standard_daily_hours = 8 from public.hr_settings), 'no error, row unchanged?');
exception when others then insert into _t values ('direct settings write refused', sqlstate = '42501', sqlerrm); end $$;
insert into _t select 'workdays exclude Fri/Sat', app.hr_workdays('{5,6}', '2026-10-01', '2026-10-10') = 6, null;

-- Leave: manager files, overlap guarded
create temp table _lt as select id, code from public.leave_types;
grant select on _lt to authenticated;
create temp table _r1 as select * from public.request_leave('e0000000-0000-4000-8000-000000000001',
  (select id from _lt where code = 'annual'), '2026-10-04', '2026-10-08', 'Trip');
insert into _t select 'leave days computed (Sun-Thu = 5)', (select days = 5 and status = 'pending' from _r1), (select days::text from _r1);
insert into _t select 'leave request notifies managers', exists (select 1 from public.notifications where kind = 'hr.leave_requested'), null;
do $$ begin
  perform public.request_leave('e0000000-0000-4000-8000-000000000001', (select id from _lt where code = 'annual'), '2026-10-09', '2026-10-10', null);
  insert into _t values ('weekend-only leave refused', false, null);
exception when others then insert into _t values ('weekend-only leave refused', sqlerrm = 'LEAVE_NO_WORKDAYS', sqlerrm); end $$;
do $$ begin
  perform public.request_leave('e0000000-0000-4000-8000-0000000000b1', (select id from _lt where code = 'annual'), '2026-10-04', '2026-10-05', null);
  insert into _t values ('other tenant employee refused', false, null);
exception when others then insert into _t values ('other tenant employee refused', sqlerrm = 'EMPLOYEE_NOT_FOUND', sqlerrm); end $$;
do $$ begin
  perform public.request_leave('e0000000-0000-4000-8000-000000000001', (select id from _lt where code = 'annual'), '2026-10-08', '2026-10-08', null);
  insert into _t values ('overlap with pending refused', false, null);
exception when others then insert into _t values ('overlap with pending refused', sqlerrm = 'LEAVE_OVERLAP', sqlerrm); end $$;
select public.leave_transition((select id from _r1), 'approved', 'Enjoy');
create temp table _r2 as select * from public.request_leave('e0000000-0000-4000-8000-000000000001',
  (select id from _lt where code = 'sick'), '2026-10-12', '2026-10-12', null);
do $$ begin
  perform public.request_leave('e0000000-0000-4000-8000-000000000001', (select id from _lt where code = 'sick'), '2026-10-07', '2026-10-11', null);
  insert into _t values ('overlap with approved refused', false, null);
exception when others then insert into _t values ('overlap with approved refused', sqlerrm = 'LEAVE_OVERLAP', sqlerrm); end $$;
do $$ begin
  perform public.leave_transition((select id from _r1), 'rejected', null);
  insert into _t values ('approved -> rejected illegal', false, null);
exception when others then insert into _t values ('approved -> rejected illegal', sqlerrm like 'ILLEGAL_LEAVE_TRANSITION%', sqlerrm); end $$;
do $$ begin
  insert into public.leave_requests (employee_id, leave_type_id, start_date, end_date)
  values ('e0000000-0000-4000-8000-000000000001', (select id from _lt where code = 'annual'), '2026-11-01', '2026-11-02');
  insert into _t values ('direct leave insert refused', false, null);
exception when others then insert into _t values ('direct leave insert refused', sqlstate = '42501', sqlerrm); end $$;
create temp table _bal as select * from public.leave_balances(2026, 'e0000000-0000-4000-8000-000000000001');
insert into _t select 'balance: annual 30 - 5', exists (select 1 from _bal b join _lt on _lt.id = b.leave_type_id
  where _lt.code = 'annual' and entitled = 30 and taken = 5 and remaining = 25), null;
insert into _t select 'balance: pending counted', exists (select 1 from _bal b join _lt on _lt.id = b.leave_type_id
  where _lt.code = 'sick' and pending = 1), (select string_agg(_lt.code || ':' || taken || '/' || pending, ',') from _bal b join _lt on _lt.id = b.leave_type_id);
insert into _t select 'balance: unpaid not tracked', not exists (select 1 from _bal b join _lt on _lt.id = b.leave_type_id
  where _lt.code = 'unpaid'), null;
create temp table _bal2 as select * from public.leave_balances(2026, 'e0000000-0000-4000-8000-000000000002');
insert into _t select 'balance: joiner pro-rated', exists (select 1 from _bal2 b join _lt on _lt.id = b.leave_type_id
  where _lt.code = 'annual' and entitled = round(30 * 107 / 365.0, 1)), (select string_agg(entitled::text, ',') from _bal2);

-- Unpaid leave for Ravi inside October (Sun 18 - Tue 20 = 3 workdays)
create temp table _r3 as select * from public.request_leave('e0000000-0000-4000-8000-000000000002',
  (select id from _lt where code = 'unpaid'), '2026-10-18', '2026-10-20', null);
select public.leave_transition((select id from _r3), 'approved', null);

-- Attendance: Ravi works 10h on two days (2h overtime each), one bad row refused
select public.attendance_set('2026-10-05', jsonb_build_array(
  jsonb_build_object('employee_id', 'e0000000-0000-4000-8000-000000000002', 'status', 'present', 'check_in', '08:00', 'check_out', '18:00'),
  jsonb_build_object('employee_id', 'e0000000-0000-4000-8000-000000000001', 'status', 'on_leave')));
select public.attendance_set('2026-10-06', jsonb_build_array(
  jsonb_build_object('employee_id', 'e0000000-0000-4000-8000-000000000002', 'status', 'late', 'check_in', '22:00', 'check_out', '08:00')));
insert into _t select 'attendance hours (incl. overnight)', (select array_agg(hours order by work_date) = '{10.00,10.00}'::numeric[]
  from public.attendance_records where employee_id = 'e0000000-0000-4000-8000-000000000002'), null;
do $$ begin
  perform public.attendance_set('2026-10-07', '[{"employee_id":"e0000000-0000-4000-8000-000000000002","status":"present","check_in":"25:00"}]');
  insert into _t values ('bad clock time refused', false, null);
exception when others then insert into _t values ('bad clock time refused', sqlerrm = 'ATTENDANCE_INVALID', sqlerrm); end $$;
select public.attendance_set('2026-10-05', '[{"employee_id":"e0000000-0000-4000-8000-000000000001","status":null}]');
insert into _t select 'null status clears the row', not exists (select 1 from public.attendance_records
  where employee_id = 'e0000000-0000-4000-8000-000000000001'), null;

-- Payroll
create temp table _run as select * from public.payroll_runs limit 0;
grant all on _run to authenticated;
do $$ begin
  insert into public.payroll_runs (period_start, period_end, status) values ('2026-10-01', '2026-10-31', 'paid');
  insert into _t values ('status not client-settable', false, null);
exception when others then insert into _t values ('status not client-settable', sqlstate = '42501', sqlerrm); end $$;
do $$ begin
  insert into public.payroll_runs (period_start, period_end) values ('2026-01-01', '2026-06-30');
  insert into _t values ('over-long period refused', false, null);
exception when others then insert into _t values ('over-long period refused', sqlerrm = 'PAYROLL_INVALID_PERIOD', sqlerrm); end $$;
insert into public.payroll_runs (period_start, period_end, pay_date)
values ('2026-10-01', '2026-10-31', '2026-10-28');
insert into _run select * from public.payroll_runs;
insert into _t select 'run numbered with currency snapshot', (select doc_number = 'PAY-00001' and status = 'draft'
  and currency = 'SAR' from _run), (select doc_number || ' ' || status from _run);
do $$ begin
  perform public.payroll_approve((select id from _run));
  insert into _t values ('approve from draft illegal', false, null);
exception when others then insert into _t values ('approve from draft illegal', sqlerrm like 'EMPTY_DOCUMENT%' or sqlerrm like 'ILLEGAL_PAYROLL_TRANSITION%', sqlerrm); end $$;
select public.payroll_calculate((select id from _run));
create temp table _ps as select * from public.payslips;
insert into _t select 'slips for salaried employees only', (select count(*) = 2 from _ps)
  and not exists (select 1 from _ps where employee_id = 'e0000000-0000-4000-8000-000000000003'), null;
-- Sara: national, full month. social 9.75% of 7500 = 731.25; employer 11.75% = 881.25
insert into _t select 'national: full month + social insurance', (select gross = 8000 and social_insurance_employee = 731.25
  and social_insurance_employer = 881.25 and net = 8000 - 731.25 and overtime_hours = 0
  from _ps where employee_id = 'e0000000-0000-4000-8000-000000000001'),
  (select row_to_json(p)::text from _ps p where employee_id = 'e0000000-0000-4000-8000-000000000001');
-- Ravi: full October; overtime 4h * 20 * 1.5 = 120, unpaid 3 days = 3000/30*3 = 300,
-- no social insurance (expat)
insert into _t select 'expat: overtime, unpaid leave, no social', (select basic = 3000 and other_allowances = 200
  and overtime_hours = 4 and overtime_amount = 120 and unpaid_leave_days = 3 and unpaid_leave_deduction = 300
  and social_insurance_employee = 0 and gross = 3320 and net = 3020
  from _ps where employee_id = 'e0000000-0000-4000-8000-000000000002'),
  (select concat_ws(' ', basic, other_allowances, overtime_hours, overtime_amount, unpaid_leave_days, unpaid_leave_deduction, social_insurance_employee, gross, net, hourly_rate) from _ps p where employee_id = 'e0000000-0000-4000-8000-000000000002');
update public.payslips set bonus = 500, deductions = 100, deduction_note = 'Advance'
 where employee_id = 'e0000000-0000-4000-8000-000000000001';
do $$ begin
  update public.payslips set gross = 1 where employee_id = 'e0000000-0000-4000-8000-000000000001';
  insert into _t values ('computed column not client-writable', false, null);
exception when others then insert into _t values ('computed column not client-writable', sqlstate = '42501', sqlerrm); end $$;
do $$ begin
  update public.payslips set deductions = 100000 where employee_id = 'e0000000-0000-4000-8000-000000000001';
  insert into _t values ('negative net refused', false, null);
exception when others then insert into _t values ('negative net refused', sqlerrm = 'PAYSLIP_NEGATIVE_NET', sqlerrm); end $$;
select public.payroll_calculate((select id from _run));
insert into _t select 'recalc keeps bonus and deductions', (select bonus = 500 and deductions = 100 and gross = 8500
  and net = 8500 - 731.25 - 100 from public.payslips where employee_id = 'e0000000-0000-4000-8000-000000000001'), null;
insert into _t select 'run totals', (select employee_count = 2 and status = 'calculated'
  and total_net = (select sum(net) from public.payslips) and total_gross = (select sum(gross) from public.payslips)
  and total_employer_cost = total_gross + 881.25 from public.payroll_runs), (select row_to_json(r)::text from public.payroll_runs r);
select public.payroll_approve((select id from _run));
do $$ begin
  update public.payslips set bonus = 1 where employee_id = 'e0000000-0000-4000-8000-000000000001';
  insert into _t values ('slips locked after approval', false, null);
exception when others then insert into _t values ('slips locked after approval', sqlerrm = 'DOC_LOCKED', sqlerrm); end $$;
do $$ begin
  update public.payroll_runs set notes = 'late edit';
  insert into _t values ('run locked after approval', false, null);
exception when others then insert into _t values ('run locked after approval', sqlerrm = 'DOC_LOCKED', sqlerrm); end $$;
do $$ begin
  perform public.payroll_cancel((select id from _run));
  insert into _t values ('approved run cannot cancel', false, null);
exception when others then insert into _t values ('approved run cannot cancel', sqlerrm like 'ILLEGAL_PAYROLL_TRANSITION%', sqlerrm); end $$;
do $$ begin
  delete from public.payroll_runs;
  insert into _t values ('approved run cannot be deleted', false, null);
exception when others then insert into _t values ('approved run cannot be deleted', sqlerrm = 'DOC_NOT_DELETABLE', sqlerrm); end $$;
select public.payroll_mark_paid((select id from _run), null);
insert into _t select 'marked paid on pay date', (select status = 'paid' and paid_at = '2026-10-28' from public.payroll_runs), null;

-- September: Ravi joined on the 16th (15 of 30 days). Then cancel + delete
-- cleanly (cascade + totals trigger).
insert into public.payroll_runs (period_start, period_end) values ('2026-09-01', '2026-09-30');
select public.payroll_calculate((select id from public.payroll_runs where period_start = '2026-09-01'));
insert into _t select 'joiner pro-rated in the joining month', (select basic = 1500 and other_allowances = 100 and paid_days = 15
  and period_days = 30 from public.payslips where employee_id = 'e0000000-0000-4000-8000-000000000002'
  and run_id = (select id from public.payroll_runs where period_start = '2026-09-01')), null;
select public.payroll_cancel((select id from public.payroll_runs where period_start = '2026-09-01'));
delete from public.payroll_runs where period_start = '2026-09-01';
insert into _t select 'canceled run deletes with slips', (select count(*) = 1 from public.payroll_runs)
  and (select count(*) = 2 from public.payslips), null;
reset role;
insert into _t select 'leave + payroll audited', exists (select 1 from public.audit_events where table_name = 'leave_requests')
  and exists (select 1 from public.audit_events where table_name = 'payroll_runs'), null;

-- Viewer linked to Sara: own leave, own released slip, nothing else
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000a003","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"viewer"}}', true);
insert into _t select 'viewer sees own leave only', (select count(*) > 0 and bool_and(employee_id = 'e0000000-0000-4000-8000-000000000001') from public.leave_requests), null;
insert into _t select 'viewer sees own released slip only', (select count(*) = 1 and bool_and(employee_id = 'e0000000-0000-4000-8000-000000000001') from public.payslips), null;
insert into _t select 'slip carries the run snapshot', (select period_start = '2026-10-01' and period_end = '2026-10-31'
  and run_number = 'PAY-00001' and pay_date = '2026-10-28' and currency = 'SAR' from public.payslips), null;
insert into _t select 'viewer cannot list runs', (select count(*) = 0 from public.payroll_runs), null;
insert into _t select 'viewer balances are own', (select count(*) > 0 and bool_and(employee_id = 'e0000000-0000-4000-8000-000000000001')
  from public.leave_balances(2026, 'e0000000-0000-4000-8000-000000000002')), null;
create temp table _own as select * from public.request_leave(null, (select id from _lt where code = 'annual'), '2026-12-06', '2026-12-07', null);
insert into _t select 'viewer requests own leave', (select days = 2 and employee_id = 'e0000000-0000-4000-8000-000000000001' from _own), null;
do $$ begin
  perform public.request_leave('e0000000-0000-4000-8000-000000000002', (select id from _lt where code = 'annual'), '2026-12-06', '2026-12-07', null);
  insert into _t values ('viewer cannot file for others', false, null);
exception when others then insert into _t values ('viewer cannot file for others', sqlerrm = 'FORBIDDEN', sqlerrm); end $$;
do $$ begin
  perform public.leave_transition((select id from _own), 'approved', null);
  insert into _t values ('viewer cannot approve own', false, null);
exception when others then insert into _t values ('viewer cannot approve own', sqlerrm = 'FORBIDDEN', sqlerrm); end $$;
insert into _t select 'viewer withdraws own pending', (public.leave_transition((select id from _own), 'canceled', null)).status = 'canceled', null;
do $$ begin
  perform public.leave_transition((select id from _r3), 'canceled', null);
  insert into _t values ('viewer cannot touch others', false, null);
exception when others then insert into _t values ('viewer cannot touch others', sqlerrm = 'LEAVE_NOT_FOUND', sqlerrm); end $$;
do $$ begin
  perform public.attendance_set('2026-10-08', '[]');
  insert into _t values ('viewer cannot write attendance', false, null);
exception when others then insert into _t values ('viewer cannot write attendance', sqlerrm = 'FORBIDDEN', sqlerrm); end $$;
reset role;
insert into _t select 'decision notified to employee', exists (select 1 from public.notifications
  where kind = 'hr.leave_decided' and recipient_id = '5eed0000-0000-4000-8000-00000000a003'), null;

-- Other tenant sees nothing of ours
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000b001","role":"authenticated","app_metadata":{"tenant_id":"5eed0000-0000-4000-8000-0000000000b1","role":"owner"}}', true);
insert into _t select 'cross-tenant isolation', (select count(*) = 0 from public.leave_requests) and (select count(*) = 0 from public.payslips)
  and (select count(*) = 0 from public.leave_types) and (select count(*) = 0 from public.payroll_runs), null;
do $$ begin
  perform public.payroll_calculate((select id from _run));
  insert into _t values ('cross-tenant calculate refused', false, null);
exception when others then insert into _t values ('cross-tenant calculate refused', sqlerrm = 'PAYROLL_NOT_FOUND', sqlerrm); end $$;
reset role;

-- @print
select name, ok, detail from _t order by ok, name;
rollback;
