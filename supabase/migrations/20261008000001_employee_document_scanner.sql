-- Employees: reminders for expiring identity documents.
--
-- Adds app.scan_due_employees(p_tenant), which public.refresh_notifications()
-- (platform foundation) finds by name and runs when the notification bell
-- mounts. For every employee who is not terminated it checks the passport,
-- residence permit and work permit expiry and notifies the tenant's managers
-- once per stage: 60, 30 and 7 days before, and once expired. The stage is in
-- the dedupe key, so each stage notifies exactly once per expiry date, and
-- renewing a document (a new expiry date) starts its stages over.
--
-- The thresholds match src/lib/employees.ts (documentBucket), so the badge a
-- manager sees and the notification they get agree.
--
-- Additive only: one new function, no table or policy changes. It is a no-op
-- unless the tenant has both `employees` and `notifications` enabled
-- (app.notify already checks the latter).

set local lock_timeout = '3s';
set local statement_timeout = '60s';

create or replace function app.scan_due_employees(p_tenant uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date;
  v_total integer := 0;
  r record;
begin
  if p_tenant is null or not app.tenant_module_enabled(p_tenant, 'employees') then
    return 0;
  end if;

  -- "Today" in the tenant's own calendar, not the server's.
  select (now() at time zone coalesce(t.timezone, 'UTC'))::date
    into v_today
  from public.tenants t
  where t.id = p_tenant;
  if v_today is null then
    return 0;
  end if;

  for r in
    with docs as (
      select e.id as employee_id,
             btrim(concat_ws(' ', e.first_name, e.last_name)) as employee_name,
             d.doc, d.expiry
      from public.employees e
      cross join lateral (values
        ('passport', e.passport_expiry),
        ('residence_permit', e.residence_permit_expiry),
        ('work_permit', e.work_permit_expiry)
      ) as d (doc, expiry)
      where e.tenant_id = p_tenant
        and e.status <> 'terminated'
        and d.expiry is not null
        and d.expiry <= v_today + 60
    )
    select docs.*,
           (docs.expiry - v_today) as days_left,
           case
             when docs.expiry < v_today then 'expired'
             when docs.expiry - v_today <= 7 then 'd7'
             when docs.expiry - v_today <= 30 then 'd30'
             else 'd60'
           end as stage
    from docs
  loop
    v_total := v_total + coalesce(app.notify(
      p_tenant,
      'managers',
      'employees.document_expiring',
      case when r.stage in ('expired', 'd7') then 'critical'
           when r.stage = 'd30' then 'warning'
           else 'info' end,
      'employee',
      r.employee_id,
      '/employees/' || r.employee_id,
      jsonb_build_object(
        'employee', r.employee_name,
        'document', r.doc,
        'expiry', r.expiry,
        'days', r.days_left,
        'stage', r.stage
      ),
      -- English fallbacks; the SPA localizes by kind + params.
      case when r.stage = 'expired'
           then r.employee_name || ': ' || replace(r.doc, '_', ' ') || ' expired'
           else r.employee_name || ': ' || replace(r.doc, '_', ' ') || ' expires in '
                || r.days_left || ' day' || case when r.days_left = 1 then '' else 's' end
      end,
      'Expiry date: ' || to_char(r.expiry, 'YYYY-MM-DD'),
      'employees.document_expiring:' || r.employee_id || ':' || r.doc || ':' || r.expiry || ':' || r.stage
    ), 0);
  end loop;

  return v_total;
end;
$$;

revoke execute on function app.scan_due_employees(uuid) from public, anon, authenticated;
