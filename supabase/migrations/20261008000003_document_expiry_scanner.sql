-- Documents: reminders for expiring files.
--
-- Adds app.scan_due_documents(p_tenant), which public.refresh_notifications()
-- (platform foundation) finds by name and runs when the notification bell
-- mounts. Every document with an expiry date notifies the tenant's managers
-- once per stage: 30 and 7 days before, and once expired (only within 30 days
-- of lapsing, so years-old files do not flood a tenant that just turned the
-- module on). The stage and the expiry date are in the dedupe key, so each
-- stage notifies exactly once per expiry, and a new expiry date starts over.
--
-- The 30-day window matches src/lib/documents.ts (EXPIRY_SOON_DAYS), so the
-- "Expiring" tab and the notifications agree.
--
-- Additive only: one new function, no table or policy changes. A no-op unless
-- the tenant has `documents` on (and `notifications`, which app.notify checks).

set local lock_timeout = '3s';
set local statement_timeout = '60s';

create or replace function app.scan_due_documents(p_tenant uuid)
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
  if p_tenant is null or not app.tenant_module_enabled(p_tenant, 'documents') then
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
    select d.id, d.name, d.expires_on, d.entity_type, d.entity_id,
           (d.expires_on - v_today) as days_left,
           case
             when d.expires_on < v_today then 'expired'
             when d.expires_on - v_today <= 7 then 'd7'
             else 'd30'
           end as stage
    from public.documents d
    where d.tenant_id = p_tenant
      and d.expires_on is not null
      and d.expires_on between v_today - 30 and v_today + 30
  loop
    v_total := v_total + coalesce(app.notify(
      p_tenant,
      'managers',
      'documents.expiring',
      case when r.stage in ('expired', 'd7') then 'critical' else 'warning' end,
      'document',
      r.id,
      '/documents/expiring',
      jsonb_build_object(
        'document', r.name,
        'expiry', r.expires_on,
        'days', r.days_left,
        'stage', r.stage,
        'entity_type', r.entity_type,
        'entity_id', r.entity_id
      ),
      -- English fallbacks; the SPA localizes by kind + params.
      case when r.stage = 'expired'
           then r.name || ' expired'
           else r.name || ' expires in ' || r.days_left || ' day'
                || case when r.days_left = 1 then '' else 's' end
      end,
      'Expiry date: ' || to_char(r.expires_on, 'YYYY-MM-DD'),
      'documents.expiring:' || r.id || ':' || r.expires_on || ':' || r.stage
    ), 0);
  end loop;

  return v_total;
end;
$$;

revoke execute on function app.scan_due_documents(uuid) from public, anon, authenticated;
