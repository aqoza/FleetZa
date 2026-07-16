-- Pin search_path on helper functions (advisor: function_search_path_mutable)
alter function app.tenant_id() set search_path = '';
alter function app.role() set search_path = '';
alter function app.is_manager() set search_path = '';
alter function app.is_admin() set search_path = '';
alter function app.set_updated_at() set search_path = '';

-- Lock down a pre-existing SECURITY DEFINER rpc if present
-- (advisor: anon/authenticated can execute public.rls_auto_enable)
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;
