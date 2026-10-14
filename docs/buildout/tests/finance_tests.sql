-- Dry-run tests for 20261008000029_finance.sql (PGlite replica:
-- node docs/buildout/pglite/harness.mjs run docs/buildout/tests/finance_tests.sql).
begin;
create temp table _t (name text, ok boolean, detail text);
grant all on _t to authenticated, service_role, anon;
create temp table _ids (k text primary key, id uuid);
grant all on _ids to authenticated, service_role;

insert into public.tenant_modules (tenant_id, module_id, enabled) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'customers', true),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'sales', true),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'billing', true),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'suppliers', true)
on conflict (tenant_id, module_id) do update set enabled = true;
insert into public.customers (id, tenant_id, name) values
  ('f1a0c0de-0029-4b2c-9d3e-4f5a6b7c8d01', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Gulf Freight');
insert into public.suppliers (id, tenant_id, name) values
  ('f1a0c0de-0029-4b2c-9d3e-4f5a6b7c8e01', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Fuel Co'),
  ('f1a0c0de-0029-4b2c-9d3e-4f5a6b7c8e0b', '5eed0000-0000-4000-8000-0000000000b1', 'Foreign supplier');

-- Stand-ins for the purchasing and payroll tables (read dynamically).
create table public.vendor_bills (id uuid primary key, tenant_id uuid, doc_number text, supplier_invoice_number text,
  supplier_id uuid, bill_date date, total numeric, tax_total numeric, status text);
create table public.vendor_payments (id uuid primary key, tenant_id uuid, vendor_bill_id uuid, paid_at date, amount numeric,
  method text, reference text);
create table public.payroll_runs (id uuid primary key, tenant_id uuid, doc_number text, status text, paid_at date, pay_date date,
  period_end date, total_gross numeric, total_deductions numeric, total_net numeric, total_employer_cost numeric);

-- Module off
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
do $$ begin
  perform public.finance_setup();
  insert into _t values ('module off: setup refused', false, null);
exception when others then insert into _t values ('module off: setup refused', sqlerrm = 'MODULE_DISABLED', sqlerrm); end $$;
reset role;
insert into public.tenant_modules (tenant_id, module_id, enabled)
values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'finance', true)
on conflict (tenant_id, module_id) do update set enabled = true;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
do $$ begin
  perform public.finance_sync();
  insert into _t values ('sync before setup refused', false, null);
exception when others then insert into _t values ('sync before setup refused', sqlerrm = 'FINANCE_NOT_SET_UP', sqlerrm); end $$;
insert into _t select 'setup seeds 27 accounts', public.finance_setup() = 27, null;
insert into _t select 'setup is idempotent', public.finance_setup() = 0, null;
insert into _t select 'mapping has 13 keys',
  (select (select count(*) from jsonb_object_keys(accounts)) = 13 from public.finance_settings), null;
insert into _ids select 'a_' || code, id from public.gl_accounts where code in ('1000','1010','1100','1300','2000','2100','2200','4000','5050','6000','6300','6900');
insert into _t select 'system flags follow the mapping',
  (select count(*) = 13 from public.gl_accounts where is_system), null;

-- Accounts
do $$ begin
  delete from public.gl_accounts where code = '1000';
  insert into _t values ('system account cannot be deleted', false, null);
exception when others then insert into _t values ('system account cannot be deleted', sqlerrm = 'SYSTEM_ACCOUNT', sqlerrm); end $$;
do $$ begin
  update public.gl_accounts set account_type = 'expense' where code = '1000';
  insert into _t values ('system account type locked', false, null);
exception when others then insert into _t values ('system account type locked', sqlerrm = 'SYSTEM_ACCOUNT', sqlerrm); end $$;
update public.gl_accounts set name = 'Petty cash' where code = '1000';
insert into _t select 'system account can be renamed', (select name = 'Petty cash' from public.gl_accounts where code = '1000'), null;
with x as (insert into public.gl_accounts (code, name, account_type, parent_id)
           values ('6010', 'Diesel', 'expense', (select id from _ids where k = 'a_6000')) returning id)
insert into _ids select 'a_6010', id from x;
insert into _t select 'custom account created with tenant',
  (select tenant_id = '170d2d86-5c22-4bcb-9d74-420c879419b2' and not is_system and created_by is not null
   from public.gl_accounts where code = '6010'), null;
do $$ begin
  insert into public.gl_accounts (code, name, account_type) values ('6010', 'Dup', 'expense');
  insert into _t values ('duplicate code refused', false, null);
exception when others then insert into _t values ('duplicate code refused', sqlstate = '23505', sqlerrm); end $$;
do $$ begin
  insert into public.gl_accounts (code, name, account_type, is_system) values ('7777', 'Sneaky', 'expense', true);
  insert into _t values ('client cannot set is_system', false, null);
exception when others then insert into _t values ('client cannot set is_system', sqlstate = '42501', sqlerrm); end $$;

-- Manual journal
with x as (insert into public.journal_entries (entry_date, memo) values (current_date - 3, 'Opening cash') returning id)
insert into _ids select 'je1', id from x;
insert into _t select 'draft numbered JE',
  (select status = 'draft' and doc_number like 'JE-%' and source_type = 'manual' from public.journal_entries
   where id = (select id from _ids where k = 'je1')), null;
do $$ begin
  insert into public.journal_entries (entry_date, status) values (current_date, 'posted');
  insert into _t values ('client cannot insert posted entry', false, null);
exception when others then insert into _t values ('client cannot insert posted entry', sqlstate = '42501', sqlerrm); end $$;
insert into public.journal_lines (entry_id, account_id, sort_order, debit, credit) values
  ((select id from _ids where k = 'je1'), (select id from _ids where k = 'a_1010'), 1, 1000, 0);
do $$ begin
  perform public.finance_post_entry((select id from _ids where k = 'je1'));
  insert into _t values ('one-line entry cannot post', false, null);
exception when others then insert into _t values ('one-line entry cannot post', sqlerrm = 'JOURNAL_UNBALANCED', sqlerrm); end $$;
insert into public.journal_lines (entry_id, account_id, sort_order, debit, credit) values
  ((select id from _ids where k = 'je1'), (select id from (select id from public.gl_accounts where code = '3000') a), 2, 0, 900);
do $$ begin
  perform public.finance_post_entry((select id from _ids where k = 'je1'));
  insert into _t values ('unbalanced entry cannot post', false, null);
exception when others then insert into _t values ('unbalanced entry cannot post', sqlerrm = 'JOURNAL_UNBALANCED', sqlerrm); end $$;
do $$ begin
  insert into public.journal_lines (entry_id, account_id, debit, credit) values
    ((select id from _ids where k = 'je1'), (select id from _ids where k = 'a_1000'), 5, 5);
  insert into _t values ('two-sided line refused', false, null);
exception when others then insert into _t values ('two-sided line refused', sqlstate = '23514', sqlerrm); end $$;
update public.journal_lines set credit = 1000 where entry_id = (select id from _ids where k = 'je1') and sort_order = 2;
insert into _t select 'draft total follows lines', (select total = 1000 from public.journal_entries where id = (select id from _ids where k = 'je1')), null;
select public.finance_post_entry((select id from _ids where k = 'je1'));
insert into _t select 'balanced entry posts',
  (select status = 'posted' and posted_at is not null and posted_by = '129bbbae-fdfc-4d21-8a86-8949fec2403b'
   from public.journal_entries where id = (select id from _ids where k = 'je1')), null;
do $$ begin
  update public.journal_entries set memo = 'changed' where id = (select id from _ids where k = 'je1');
  insert into _t values ('posted entry immutable', false, null);
exception when others then insert into _t values ('posted entry immutable', sqlerrm = 'JOURNAL_LOCKED', sqlerrm); end $$;
do $$ begin
  update public.journal_lines set debit = 2000 where entry_id = (select id from _ids where k = 'je1') and sort_order = 1;
  insert into _t values ('posted lines immutable', false, null);
exception when others then insert into _t values ('posted lines immutable', sqlerrm = 'JOURNAL_LOCKED', sqlerrm); end $$;
do $$ begin
  delete from public.journal_entries where id = (select id from _ids where k = 'je1');
  insert into _t values ('posted entry cannot be deleted', false, null);
exception when others then insert into _t values ('posted entry cannot be deleted', sqlerrm = 'JOURNAL_LOCKED', sqlerrm); end $$;
do $$ begin
  update public.gl_accounts set account_type = 'asset' where code = '3000';
  insert into _t values ('system account type locked once used', false, null);
exception when others then insert into _t values ('system account type locked once used', sqlerrm = 'SYSTEM_ACCOUNT', sqlerrm); end $$;
insert into _t select 'balances: bank 1000 debit',
  (select debit = 1000 and credit = 0 from public.finance_balances(null, null) where account_id = (select id from _ids where k = 'a_1010')), null;

-- Reverse
with x as (select public.finance_reverse_entry((select id from _ids where k = 'je1'), current_date, null) as id)
insert into _ids select 'je1r', id from x;
insert into _t select 'reverse: original reversed, mirror posted',
  (select o.status = 'reversed' and o.reversed_by = r.id and r.status = 'posted' and r.reversal_of = o.id and r.total = 1000
   from public.journal_entries o, public.journal_entries r
   where o.id = (select id from _ids where k = 'je1') and r.id = (select id from _ids where k = 'je1r')), null;
insert into _t select 'reverse: bank nets to zero',
  (select debit - credit = 0 from public.finance_balances(null, null) where account_id = (select id from _ids where k = 'a_1010')), null;
do $$ begin
  perform public.finance_reverse_entry((select id from _ids where k = 'je1r'));
  insert into _t values ('reversal cannot be reversed', false, null);
exception when others then insert into _t values ('reversal cannot be reversed', sqlerrm = 'ENTRY_NOT_REVERSIBLE', sqlerrm); end $$;

-- Lock date
update public.finance_settings set lock_date = current_date - 2;
with x as (insert into public.journal_entries (entry_date, memo) values (current_date - 5, 'Back-dated') returning id)
insert into _ids select 'je2', id from x;
insert into public.journal_lines (entry_id, account_id, debit, credit) values
  ((select id from _ids where k = 'je2'), (select id from _ids where k = 'a_1000'), 50, 0),
  ((select id from _ids where k = 'je2'), (select id from _ids where k = 'a_6900'), 0, 50);
do $$ begin
  perform public.finance_post_entry((select id from _ids where k = 'je2'));
  insert into _t values ('locked period refuses posting', false, null);
exception when others then insert into _t values ('locked period refuses posting', sqlerrm = 'PERIOD_LOCKED', sqlerrm); end $$;
update public.journal_entries set entry_date = current_date where id = (select id from _ids where k = 'je2');
select public.finance_post_entry((select id from _ids where k = 'je2'));
insert into _t select 'open period posts', (select status = 'posted' from public.journal_entries where id = (select id from _ids where k = 'je2')), null;
update public.finance_settings set lock_date = null;

-- Expenses
do $$ begin
  insert into public.expenses (category_account_id, payment_account_id, description, amount)
  values ((select id from _ids where k = 'a_1010'), (select id from _ids where k = 'a_1000'), 'x', 10);
  insert into _t values ('expense needs an expense account', false, null);
exception when others then insert into _t values ('expense needs an expense account', sqlerrm = 'EXPENSE_ACCOUNT_INVALID', sqlerrm); end $$;
do $$ begin
  insert into public.expenses (category_account_id, payment_account_id, description, amount)
  values ((select id from _ids where k = 'a_6010'), (select id from _ids where k = 'a_4000'), 'x', 10);
  insert into _t values ('payment account must be asset or liability', false, null);
exception when others then insert into _t values ('payment account must be asset or liability', sqlerrm = 'PAYMENT_ACCOUNT_INVALID', sqlerrm); end $$;
do $$ begin
  insert into public.expenses (category_account_id, payment_account_id, description, amount, supplier_id)
  values ((select id from _ids where k = 'a_6010'), (select id from _ids where k = 'a_1000'), 'x', 10, 'f1a0c0de-0029-4b2c-9d3e-4f5a6b7c8e0b');
  insert into _t values ('foreign supplier refused', false, null);
exception when others then insert into _t values ('foreign supplier refused', sqlerrm like 'CROSS_TENANT_REFERENCE%', sqlerrm); end $$;
with x as (insert into public.expenses (category_account_id, payment_account_id, description, amount, tax_amount, supplier_id)
           values ((select id from _ids where k = 'a_6010'), (select id from _ids where k = 'a_1000'), 'Diesel fill', 100.004, 5,
                   'f1a0c0de-0029-4b2c-9d3e-4f5a6b7c8e01') returning id)
insert into _ids select 'exp1', id from x;
insert into _t select 'expense draft numbered and totalled',
  (select status = 'draft' and doc_number like 'EXP-%' and total = amount + tax_amount from public.expenses
   where id = (select id from _ids where k = 'exp1')),
  (select row_to_json(e)::text from public.expenses e where id = (select id from _ids where k = 'exp1'));
do $$ begin
  update public.expenses set status = 'posted' where id = (select id from _ids where k = 'exp1');
  insert into _t values ('draft cannot jump to posted', false, null);
exception when others then insert into _t values ('draft cannot jump to posted', sqlerrm = 'ILLEGAL_EXPENSE_TRANSITION', sqlerrm); end $$;
do $$ begin
  perform public.finance_post_expense((select id from _ids where k = 'exp1'));
  insert into _t values ('draft expense cannot post', false, null);
exception when others then insert into _t values ('draft expense cannot post', sqlerrm = 'ILLEGAL_EXPENSE_TRANSITION', sqlerrm); end $$;
update public.expenses set status = 'approved' where id = (select id from _ids where k = 'exp1');
insert into _t select 'approve stamps approver',
  (select approved_by = '129bbbae-fdfc-4d21-8a86-8949fec2403b' from public.expenses where id = (select id from _ids where k = 'exp1')), null;
do $$ begin
  update public.expenses set amount = 1 where id = (select id from _ids where k = 'exp1');
  insert into _t values ('approved expense locked', false, null);
exception when others then insert into _t values ('approved expense locked', sqlerrm = 'EXPENSE_LOCKED', sqlerrm); end $$;
do $$ begin
  update public.expenses set status = 'posted' where id = (select id from _ids where k = 'exp1');
  insert into _t values ('client cannot mark posted', false, null);
exception when others then insert into _t values ('client cannot mark posted', sqlerrm = 'ILLEGAL_EXPENSE_TRANSITION', sqlerrm); end $$;
insert into _t select 'pending counts show the expense', (select (public.finance_pending_counts()->>'expense')::int = 1), public.finance_pending_counts()::text;
with x as (select public.finance_post_expense((select id from _ids where k = 'exp1')) as id)
insert into _ids select 'exp1_je', id from x;
insert into _t select 'expense posts Dr expense + VAT / Cr cash',
  (select count(*) = 3 and sum(debit) = 105 and sum(credit) = 105
          and bool_or(account_id = (select id from _ids where k = 'a_1300') and debit = 5)
          and bool_or(account_id = (select id from _ids where k = 'a_1000') and credit = 105)
   from public.journal_lines where entry_id = (select id from _ids where k = 'exp1_je')), null;
insert into _t select 'expense linked and posted',
  (select status = 'posted' and journal_entry_id = (select id from _ids where k = 'exp1_je') from public.expenses
   where id = (select id from _ids where k = 'exp1')), null;
insert into _t select 'expense post is idempotent',
  public.finance_post_expense((select id from _ids where k = 'exp1')) = (select id from _ids where k = 'exp1_je'), null;
do $$ begin
  delete from public.expenses where id = (select id from _ids where k = 'exp1');
  insert into _t values ('posted expense cannot be deleted', false, null);
exception when others then insert into _t values ('posted expense cannot be deleted', sqlerrm = 'EXPENSE_LOCKED', sqlerrm); end $$;
select public.finance_reverse_entry((select id from _ids where k = 'exp1_je'));
insert into _t select 'reversing the entry returns the expense to approved',
  (select status = 'approved' and journal_entry_id is null from public.expenses where id = (select id from _ids where k = 'exp1')), null;
select public.finance_post_expense((select id from _ids where k = 'exp1'));
insert into _t select 'expense can post again after reversal',
  (select status = 'posted' from public.expenses where id = (select id from _ids where k = 'exp1')), null;
do $$ begin
  update public.gl_accounts set account_type = 'liability' where code = '6010';
  insert into _t values ('used account type locked', false, null);
exception when others then insert into _t values ('used account type locked', sqlerrm = 'ACCOUNT_IN_USE', sqlerrm); end $$;
do $$ begin
  delete from public.gl_accounts where code = '6010';
  insert into _t values ('used account cannot be deleted', false, null);
exception when others then insert into _t values ('used account cannot be deleted', sqlerrm = 'ACCOUNT_IN_USE', sqlerrm); end $$;

-- Invoices and payments
with x as (insert into public.invoices (customer_id, title, due_date) values
  ('f1a0c0de-0029-4b2c-9d3e-4f5a6b7c8d01', 'keep', current_date + 30),
  ('f1a0c0de-0029-4b2c-9d3e-4f5a6b7c8d01', 'voidme', current_date + 30) returning id, title)
insert into _ids select 'inv_' || title, id from x;
insert into public.invoice_lines (invoice_id, sort_order, description, quantity, unit_price)
select id, 1, 'Service', 1, 200 from _ids where k like 'inv_%';
update public.invoices set status = 'issued' where id in (select id from _ids where k like 'inv_%');
insert into public.payments (invoice_id, amount, method) values ((select id from _ids where k = 'inv_keep'), 50, 'cash');
with x as (select public.finance_post_invoice((select id from _ids where k = 'inv_keep')) as id)
insert into _ids select 'inv_keep_je', id from x;
insert into _t select 'invoice posts Dr AR / Cr revenue (+VAT)',
  (select sum(l.debit) = i.total and sum(l.credit) = i.total
          and bool_or(l.account_id = (select id from _ids where k = 'a_1100') and l.debit = i.total and l.customer_id = i.customer_id)
   from public.journal_lines l, public.invoices i
   where l.entry_id = (select id from _ids where k = 'inv_keep_je') and i.id = (select id from _ids where k = 'inv_keep')
   group by i.total, i.customer_id), null;
insert into _t select 'invoice post is idempotent',
  public.finance_post_invoice((select id from _ids where k = 'inv_keep')) = (select id from _ids where k = 'inv_keep_je'), null;
do $$ begin
  update public.journal_entries set status = 'draft' where id = (select id from _ids where k = 'inv_keep_je');
  insert into _t values ('client cannot unpost', false, null);
exception when others then insert into _t values ('client cannot unpost', sqlstate = '42501', sqlerrm); end $$;
select public.finance_post_invoice((select id from _ids where k = 'inv_voidme'));
update public.invoices set status = 'void', void_reason = 'mistake' where id = (select id from _ids where k = 'inv_voidme');
reset role;

-- Purchasing and payroll stand-ins
insert into public.vendor_bills values
  ('f1a0c0de-0029-4b2c-9d3e-0000000000b1', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'BILL-00001', 'S-77',
   'f1a0c0de-0029-4b2c-9d3e-4f5a6b7c8e01', current_date, 115, 15, 'open'),
  ('f1a0c0de-0029-4b2c-9d3e-0000000000b2', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'BILL-00002', null,
   'f1a0c0de-0029-4b2c-9d3e-4f5a6b7c8e01', current_date, 10, 0, 'draft');
insert into public.vendor_payments values
  ('f1a0c0de-0029-4b2c-9d3e-0000000000c1', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'f1a0c0de-0029-4b2c-9d3e-0000000000b1',
   current_date, 115, 'bank_transfer', 'TRX1');
insert into public.payroll_runs values
  ('f1a0c0de-0029-4b2c-9d3e-0000000000d1', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'PAY-00001', 'paid', current_date, null,
   current_date, 1000, 100, 900, 120),
  ('f1a0c0de-0029-4b2c-9d3e-0000000000d2', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'PAY-00002', 'approved', null, null,
   current_date, 1000, 100, 900, 120);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
create temp table _pending as select public.finance_pending_counts() as c;
insert into _t select 'pending: payment, bill, vendor payment, payroll, one reversal',
  (select (c->>'payment')::int = 1 and (c->>'vendor_bill')::int = 1 and (c->>'vendor_payment')::int = 1
          and (c->>'payroll')::int = 1 and (c->>'reverse')::int = 1 and c->>'invoice' is null and c->>'expense' is null from _pending),
  (select c::text from _pending);
create temp table _sync as select public.finance_sync() as r;
insert into _t select 'sync posts 4 and reverses 1',
  (select (r->>'posted')::int = 4 and (r->>'reversed')::int = 1 and (r->>'skipped')::int = 0 from _sync), (select r::text from _sync);
insert into _t select 'sync leaves nothing pending', public.finance_pending_counts() = '{}'::jsonb, public.finance_pending_counts()::text;
insert into _t select 'voided invoice entry reversed',
  (select status = 'reversed' from public.journal_entries where source_type = 'invoice'
     and source_id = (select id from _ids where k = 'inv_voidme') and reversal_of is null), null;
insert into _t select 'cash payment debits cash',
  (select bool_or(l.account_id = (select id from _ids where k = 'a_1000') and l.debit = 50)
   from public.journal_entries e join public.journal_lines l on l.entry_id = e.id where e.source_type = 'payment'), null;
insert into _t select 'bill: Dr purchases 100 + VAT 15 / Cr AP 115',
  (select bool_or(l.account_id = (select id from _ids where k = 'a_5050') and l.debit = 100)
          and bool_or(l.account_id = (select id from _ids where k = 'a_1300') and l.debit = 15)
          and bool_or(l.account_id = (select id from _ids where k = 'a_2000') and l.credit = 115 and l.supplier_id is not null)
   from public.journal_entries e join public.journal_lines l on l.entry_id = e.id where e.source_type = 'vendor_bill'), null;
insert into _t select 'vendor payment: Dr AP / Cr bank',
  (select bool_or(l.account_id = (select id from _ids where k = 'a_2000') and l.debit = 115)
          and bool_or(l.account_id = (select id from _ids where k = 'a_1010') and l.credit = 115)
   from public.journal_entries e join public.journal_lines l on l.entry_id = e.id where e.source_type = 'vendor_payment'), null;
insert into _t select 'payroll: Dr salaries 1120 / Cr bank 900 + liabilities 220',
  (select bool_or(l.account_id = (select id from _ids where k = 'a_6300') and l.debit = 1120)
          and bool_or(l.account_id = (select id from _ids where k = 'a_1010') and l.credit = 900)
          and bool_or(l.account_id = (select id from _ids where k = 'a_2200') and l.credit = 220)
   from public.journal_entries e join public.journal_lines l on l.entry_id = e.id where e.source_type = 'payroll'), null;
do $$ begin
  perform public.finance_post_payroll('f1a0c0de-0029-4b2c-9d3e-0000000000d2');
  insert into _t values ('unpaid payroll cannot post', false, null);
exception when others then insert into _t values ('unpaid payroll cannot post', sqlerrm = 'FINANCE_SOURCE_NOT_FOUND', sqlerrm); end $$;
insert into _t select 'trial balance balances',
  (select sum(opening + debit - credit) = 0 from public.finance_balances(null, null)), null;
insert into _t select 'monthly report has income and expense',
  (select count(distinct account_type) = 2 from public.finance_monthly(current_date - 40, current_date)), null;
insert into _t select 'ledger running balance ends at the account balance',
  (select (select balance from public.finance_ledger((select id from _ids where k = 'a_1010'), current_date - 40, current_date)
           order by entry_date desc, balance limit 1) is not null
     and (select sum(debit - credit) from public.finance_ledger((select id from _ids where k = 'a_1010'), current_date - 40, current_date))
       = (select debit - credit from public.finance_balances(null, null) where account_id = (select id from _ids where k = 'a_1010'))), null;

-- A lock date makes sync skip without half-posting
update public.finance_settings set lock_date = current_date;
insert into public.payments (invoice_id, amount, method) values ((select id from _ids where k = 'inv_keep'), 10, 'bank_transfer');
create temp table _sync2 as select public.finance_sync() as r;
insert into _t select 'locked sync skips', (select (r->>'skipped')::int = 1 and (r->>'posted')::int = 0 from _sync2), (select r::text from _sync2);
insert into _t select 'skipped source leaves no draft behind',
  (select count(*) = 0 from public.journal_entries where status = 'draft' and source_type <> 'manual'), null;
reset role;

-- Viewer
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000a003","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"viewer"}}', true);
insert into _t select 'viewer reads the journal', (select count(*) > 0 from public.journal_entries), null;
insert into _t select 'viewer sees pending counts', public.finance_pending_counts() is not null, null;
do $$ begin
  perform public.finance_sync();
  insert into _t values ('viewer cannot sync', false, null);
exception when others then insert into _t values ('viewer cannot sync', sqlerrm = 'FORBIDDEN', sqlerrm); end $$;
do $$ begin
  insert into public.journal_entries (memo) values ('viewer');
  insert into _t values ('viewer cannot write entries', false, null);
exception when others then insert into _t values ('viewer cannot write entries', sqlstate = '42501', sqlerrm); end $$;
update public.finance_settings set lock_date = null;
insert into _t select 'viewer update of settings is a no-op', (select lock_date is not null from public.finance_settings), null;
reset role;

-- Other tenant sees nothing and cannot touch our entries
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000b001","role":"authenticated","app_metadata":{"tenant_id":"5eed0000-0000-4000-8000-0000000000b1","role":"owner"}}', true);
reset role;
insert into public.tenant_modules (tenant_id, module_id, enabled)
values ('5eed0000-0000-4000-8000-0000000000b1', 'finance', true)
on conflict (tenant_id, module_id) do update set enabled = true;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000b001","role":"authenticated","app_metadata":{"tenant_id":"5eed0000-0000-4000-8000-0000000000b1","role":"owner"}}', true);
insert into _t select 'other tenant sees no accounts or entries',
  (select count(*) = 0 from public.gl_accounts) and (select count(*) = 0 from public.journal_entries), null;
do $$ begin
  perform public.finance_reverse_entry((select id from _ids where k = 'je2'));
  insert into _t values ('other tenant cannot reverse ours', false, null);
exception when others then insert into _t values ('other tenant cannot reverse ours', sqlerrm = 'ENTRY_NOT_REVERSIBLE', sqlerrm); end $$;
select public.finance_setup();
do $$ begin
  insert into public.journal_lines (entry_id, account_id, debit) values
    ((select id from _ids where k = 'je2'), (select id from public.gl_accounts where code = '1000'), 1);
  insert into _t values ('cannot add lines to a foreign entry', false, null);
exception when others then insert into _t values ('cannot add lines to a foreign entry', true, sqlerrm); end $$;
reset role;

select name, ok, detail from _t order by ok, name;
rollback;
