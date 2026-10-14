-- Fail closed when an authenticated JWT has no application role.
-- PL/pgSQL IF NOT NULL does not enter its denial branch. Returning false
-- makes legacy RPC guards reject incomplete claims, just as RLS already does.
-- Valid owner/admin/manager behavior and function privileges are unchanged.
-- Rollback: use a new forward migration; do not restore nullable checks.
set local lock_timeout = '3s';
set local statement_timeout = '60s';

create or replace function app.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(app.role() in ('owner', 'admin'), false)
$$;

create or replace function app.is_manager()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(app.role() in ('owner', 'admin', 'manager'), false)
$$;
