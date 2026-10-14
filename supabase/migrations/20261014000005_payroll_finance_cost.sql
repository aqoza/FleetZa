-- FINANCE-UI-001: align posting with HR-calculated total_employer_cost.
-- Forward-only function replacement; no row rewrite, new grants or table locks.
-- Rollback: replace this function in a new migration with the prior body from 20261008000029.
-- Previously posted entries remain immutable; correct them through reversal and reposting.
create or replace function app.finance_post_payroll_core(p_tenant uuid, p_run_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if to_regclass('public.payroll_runs') is null then
    raise exception 'FINANCE_SOURCE_NOT_FOUND';
  end if;
  execute 'select id, doc_number, status, paid_at, pay_date, period_end, total_gross, total_deductions, total_net,
                  total_employer_cost
           from public.payroll_runs where id = $1 and tenant_id = $2'
    into r using p_run_id, p_tenant;
  if r.id is null or r.status <> 'paid' then
    raise exception 'FINANCE_SOURCE_NOT_FOUND';
  end if;
  -- HR total_employer_cost already includes gross pay plus contributions. Never add gross again.
  -- Net pay leaves the
  -- bank; deductions and contributions are owed until remitted.
  return app.finance_post(p_tenant, coalesce(r.paid_at::date, r.pay_date::date, r.period_end::date), 'Payroll ' || coalesce(r.doc_number, ''),
    'payroll', r.id,
    jsonb_build_array(
      jsonb_build_object('account_id', app.finance_account(p_tenant, 'salaries'), 'debit', r.total_employer_cost),
      jsonb_build_object('account_id', app.finance_account(p_tenant, 'bank'), 'credit', r.total_net),
      jsonb_build_object('account_id', app.finance_account(p_tenant, 'payroll_liabilities'),
                         'credit', r.total_employer_cost - r.total_net)));
end;
$$;
revoke execute on function app.finance_post_payroll_core(uuid, uuid) from public, anon, authenticated;
