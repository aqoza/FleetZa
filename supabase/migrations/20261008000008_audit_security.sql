-- Audit & security (module audit_security).
--
-- 1) security_settings: one row per tenant. session_idle_minutes (the SPA
--    signs a member out after that long without activity while the module
--    is on), require_strong_passwords (informational policy flag shown on
--    the password forms) and audit_retention_days (null = keep forever).
--    Members read it (the idle timer runs for everyone); admins write it
--    through save_security_settings only.
-- 2) Read RPCs for admins: audit_tables (filter options for the audit log
--    viewer), security_members (access review: role, last sign-in, email
--    confirmation, straight from auth.users, so no worker round trip),
--    security_posture (the checklist numbers).
-- 3) revoke_member_sessions: signs a member out of every device by deleting
--    their auth sessions (refresh tokens stop working at once; an access
--    token already issued lives until it expires, at most an hour). Refuses
--    yourself, and refuses the owner unless the owner asks.
-- 4) app.scan_due_security: applies audit retention in batches when
--    refresh_notifications runs the scanners.
--
-- The audit log viewer reads public.audit_events directly; its RLS (admins of
-- the tenant) predates this module and is unchanged.
--
-- Raised codes: SECURITY_INVALID_SETTING, MEMBER_NOT_FOUND,
-- CANNOT_SIGN_OUT_SELF, CANNOT_SIGN_OUT_OWNER.
-- Additive only.

set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- ============================================================
-- 1) Settings
-- ============================================================
create table public.security_settings (
  tenant_id uuid primary key default app.tenant_id() references public.tenants(id) on delete cascade,
  id uuid not null unique default gen_random_uuid(), -- app.log_audit keys rows by id
  session_idle_minutes integer check (session_idle_minutes between 5 and 1440),
  require_strong_passwords boolean not null default false,
  audit_retention_days integer check (audit_retention_days between 90 and 3650),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.security_settings enable row level security;
revoke all on public.security_settings from anon;
revoke insert, update, delete, truncate on public.security_settings from authenticated;

create trigger security_settings_updated_at before update on public.security_settings
  for each row execute function app.set_updated_at();
create trigger security_settings_audit after insert or update or delete on public.security_settings
  for each row execute function app.log_audit();

create or replace function public.save_security_settings(
  p_session_idle_minutes integer,
  p_require_strong_passwords boolean,
  p_audit_retention_days integer
)
returns public.security_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('audit_security', 'admin');
  v_row public.security_settings;
begin
  if p_session_idle_minutes is not null and p_session_idle_minutes not between 5 and 1440 then
    raise exception 'SECURITY_INVALID_SETTING: session_idle_minutes';
  end if;
  if p_audit_retention_days is not null and p_audit_retention_days not between 90 and 3650 then
    raise exception 'SECURITY_INVALID_SETTING: audit_retention_days';
  end if;
  insert into public.security_settings as s
    (tenant_id, session_idle_minutes, require_strong_passwords, audit_retention_days, updated_by)
  values (v_tenant, p_session_idle_minutes, coalesce(p_require_strong_passwords, false),
          p_audit_retention_days, auth.uid())
  on conflict (tenant_id) do update
    set session_idle_minutes = excluded.session_idle_minutes,
        require_strong_passwords = excluded.require_strong_passwords,
        audit_retention_days = excluded.audit_retention_days,
        updated_by = excluded.updated_by
  returning * into v_row;
  return v_row;
end;
$$;
revoke execute on function public.save_security_settings(integer, boolean, integer) from public, anon;
grant execute on function public.save_security_settings(integer, boolean, integer) to authenticated;

-- ============================================================
-- 2) Read RPCs (admins)
-- ============================================================
create or replace function public.audit_tables()
returns setof text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('audit_security', 'admin');
begin
  return query
  select distinct e.table_name from public.audit_events e where e.tenant_id = v_tenant order by 1;
end;
$$;

create or replace function public.security_members()
returns table (
  id uuid,
  full_name text,
  email text,
  role text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  email_confirmed_at timestamptz,
  banned_until timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('audit_security', 'admin');
begin
  return query
  select p.id, p.full_name, p.email, p.role, p.created_at,
         u.last_sign_in_at, u.email_confirmed_at, u.banned_until
  from public.profiles p
  left join auth.users u on u.id = p.id
  where p.tenant_id = v_tenant
  order by case p.role when 'owner' then 0 when 'admin' then 1 when 'manager' then 2 else 3 end, p.full_name;
end;
$$;

-- The posture checklist. Optional modules' tables are looked up by name so
-- this works whether or not integrations has shipped its webhook tables.
create or replace function public.security_posture()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('audit_security', 'admin');
  v_result jsonb;
  v_failing integer;
begin
  select jsonb_build_object(
    'members', count(*),
    'admins', count(*) filter (where p.role in ('owner', 'admin')),
    'stale_members', count(*) filter (where u.last_sign_in_at is null or u.last_sign_in_at < now() - interval '90 days'),
    'unconfirmed_members', count(*) filter (where u.email_confirmed_at is null)
  ) into v_result
  from public.profiles p
  left join auth.users u on u.id = p.id
  where p.tenant_id = v_tenant;

  v_result := v_result || jsonb_build_object(
    'api_keys_active', (select count(*) from public.api_keys k
                         where k.tenant_id = v_tenant and k.active and k.revoked_at is null
                           and (k.expires_at is null or k.expires_at > now())),
    'api_keys_no_expiry', (select count(*) from public.api_keys k
                            where k.tenant_id = v_tenant and k.active and k.revoked_at is null
                              and k.expires_at is null),
    'api_keys_unused', (select count(*) from public.api_keys k
                         where k.tenant_id = v_tenant and k.active and k.revoked_at is null
                           and (k.expires_at is null or k.expires_at > now())
                           and coalesce(k.last_used_at, k.created_at) < now() - interval '90 days'),
    'audit_events_30d', (select count(*) from public.audit_events e
                          where e.tenant_id = v_tenant and e.at > now() - interval '30 days'),
    'session_idle_minutes', (select s.session_idle_minutes from public.security_settings s where s.tenant_id = v_tenant),
    'audit_retention_days', (select s.audit_retention_days from public.security_settings s where s.tenant_id = v_tenant)
  );

  if to_regclass('public.webhook_subscriptions') is not null then
    execute 'select count(*) from public.webhook_subscriptions where tenant_id = $1 and active and failure_count > 0'
      into v_failing using v_tenant;
  end if;
  return v_result || jsonb_build_object('webhooks_failing', v_failing);
end;
$$;

revoke execute on function public.audit_tables() from public, anon;
revoke execute on function public.security_members() from public, anon;
revoke execute on function public.security_posture() from public, anon;
grant execute on function public.audit_tables() to authenticated;
grant execute on function public.security_members() to authenticated;
grant execute on function public.security_posture() to authenticated;

-- ============================================================
-- 3) Session revocation
-- ============================================================
create or replace function public.revoke_member_sessions(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('audit_security', 'admin');
  v_role text;
  v_count integer := 0;
begin
  if p_user = auth.uid() then
    raise exception 'CANNOT_SIGN_OUT_SELF';
  end if;
  select p.role into v_role from public.profiles p where p.id = p_user and p.tenant_id = v_tenant;
  if not found then
    raise exception 'MEMBER_NOT_FOUND';
  end if;
  if v_role = 'owner' then
    raise exception 'CANNOT_SIGN_OUT_OWNER';
  end if;
  if to_regclass('auth.sessions') is not null then
    -- Refresh tokens hang off sessions (on delete cascade in GoTrue's schema).
    execute 'with d as (delete from auth.sessions where user_id = $1 returning 1) select count(*) from d'
      into v_count using p_user;
  end if;
  insert into public.audit_events (tenant_id, table_name, row_id, action, actor, diff)
  values (v_tenant, 'auth_sessions', p_user, 'delete', auth.uid(),
          jsonb_build_object('sessions_revoked', v_count));
  return v_count;
end;
$$;
revoke execute on function public.revoke_member_sessions(uuid) from public, anon;
grant execute on function public.revoke_member_sessions(uuid) to authenticated;

-- ============================================================
-- 4) Audit retention (run by refresh_notifications' scanner loop)
-- ============================================================
create or replace function app.scan_due_security(p_tenant uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer;
begin
  if not app.tenant_module_enabled(p_tenant, 'audit_security') then
    return 0;
  end if;
  select audit_retention_days into v_days from public.security_settings where tenant_id = p_tenant;
  if v_days is null then
    return 0;
  end if;
  -- Bounded batch: a large backlog drains over several refreshes.
  delete from public.audit_events
  where id in (
    select e.id from public.audit_events e
    where e.tenant_id = p_tenant and e.at < now() - make_interval(days => v_days)
    order by e.at
    limit 5000
  );
  return 0; -- sends no notifications
end;
$$;
revoke execute on function app.scan_due_security(uuid) from public, anon, authenticated;

-- ============================================================
-- 5) RLS policies, LAST.
-- ============================================================
set local lock_timeout = '1s';

create policy security_settings_select on public.security_settings for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.module_enabled('audit_security')));
