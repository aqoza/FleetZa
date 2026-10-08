-- Notifications: mark-as-read in one call for the inbox and the bell.
--
-- The foundation lets a member update only notifications.read_at on their
-- own rows (column grant + notifications_update policy). Marking a page, or
-- everything, read from the client would otherwise be one PATCH per row.
-- public.mark_notifications_read does it in one statement.
--
-- SECURITY INVOKER: it runs under the caller's RLS and column grant, so it
-- can only ever touch the caller's own notifications in their own tenant,
-- with the `notifications` module on. Nothing is re-implemented here.
--
-- p_ids null marks every unread notification; otherwise just those ids.
-- p_read false marks them unread again. Returns the rows changed.
--
-- Additive only: one new function, no table or policy changes.

set local lock_timeout = '3s';
set local statement_timeout = '60s';

create or replace function public.mark_notifications_read(
  p_ids uuid[] default null,
  p_read boolean default true
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.notifications n
     set read_at = case when p_read then now() else null end
   where n.recipient_id = (select auth.uid())
     and (p_ids is null or n.id = any (p_ids))
     and (case when p_read then n.read_at is null else n.read_at is not null end);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.mark_notifications_read(uuid[], boolean) from public, anon;
grant execute on function public.mark_notifications_read(uuid[], boolean) to authenticated;
