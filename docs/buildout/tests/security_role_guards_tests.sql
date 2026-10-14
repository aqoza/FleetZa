-- Safe on production: only demo module flags change, all changes roll back.
-- Does not invoke certificate workflows, revoke sessions, or dispatch webhooks.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';
create temp table _security_checks (name text, ok boolean, detail text) on commit drop;
grant all on _security_checks to authenticated;

-- Every privileged module may be enabled for the role-denial checks. Each RPC
-- attempt runs in a rolled-back subtransaction; no business writes are committed.
insert into public.tenant_modules (tenant_id, module_id, enabled)
select '170d2d86-5c22-4bcb-9d74-420c879419b2', m, true
from unnest(array['assets','payroll_hr','audit_security','bi_analytics','contracts',
  'integrations','logistics_delivery','dispatch','mobile_workforce','finance',
  'pos','predictive_ai','purchasing','inventory','workflow_automation','workshop']) m
on conflict (tenant_id, module_id) do update set enabled = true;

create function pg_temp.check_denied(p_name text, p_sql text, p_expected text)
returns void language plpgsql as $$
declare v_error text;
begin
  begin
    execute p_sql;
    -- Always undo even an unexpectedly successful RPC before the next case.
    raise exception using message = 'UNEXPECTED_SUCCESS', errcode = 'P0002';
  exception when others then
    v_error := sqlerrm;
  end;
  insert into _security_checks values (p_name, v_error = p_expected, v_error);
end;
$$;

set local role authenticated;
do $$
declare
  v_role text;
  v_meta jsonb;
  v_claims jsonb;
  r record;
  v_call text;
begin
  foreach v_role in array array['owner','admin','manager','viewer','technician','unknown','',null] loop
    v_meta := jsonb_build_object('tenant_id','170d2d86-5c22-4bcb-9d74-420c879419b2');
    if v_role is not null then v_meta := v_meta || jsonb_build_object('role',v_role); end if;
    v_claims := jsonb_build_object('sub','129bbbae-fdfc-4d21-8a86-8949fec2403b',
      'role','authenticated','app_metadata',v_meta,
      'user_metadata',jsonb_build_object('role','owner'));
    perform set_config('request.jwt.claims',v_claims::text,true);
    insert into _security_checks values
      (coalesce(v_role,'missing') || ': admin gate',
       app.is_admin() is not distinct from coalesce(v_role in ('owner','admin'),false),null),
      (coalesce(v_role,'missing') || ': manager gate',
       app.is_manager() is not distinct from coalesce(v_role in ('owner','admin','manager'),false),null);

    if v_role in ('owner','admin','manager') then
      -- Positive control: finance's legacy manager guard must still permit staff.
      perform pg_temp.check_denied(v_role || ': finance reaches source validation',
        'select public.finance_post_invoice(NULL::uuid)','FINANCE_SOURCE_NOT_FOUND');
      continue;
    end if;

    -- These intentionally member-accessible APIs have separate self-service
    -- checks and are covered by their module regression suites. The legacy
    -- certificate RPC is inspected through its grants, never invoked here.
    for r in
      select p.oid, p.proname,
        (select string_agg('NULL::' || format_type(t,null), ', ' order by ord)
         from unnest(p.proargtypes) with ordinality x(t,ord)) as args
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prosecdef
        and has_function_privilege('authenticated',p.oid,'execute')
        and p.proname not in ('next_certificate_number','refresh_notifications',
          'field_checkin','field_task_transition','leave_balances','leave_transition',
          'request_leave','workshop_clock_on','workshop_clock_off','finance_pending_counts')
      order by p.proname
    loop
      v_call := format('select public.%I(%s)',r.proname,coalesce(r.args,''));
      perform pg_temp.check_denied(coalesce(v_role,'missing') || ': ' || r.proname,
                                  v_call,'FORBIDDEN');
    end loop;
  end loop;

  -- Explicit JSON null and absent metadata must also deny. The user's editable
  -- user_metadata.role must never substitute for the trusted application role.
  foreach v_claims in array array[
    '{"role":"authenticated","app_metadata":{"role":null}}'::jsonb,
    '{"role":"authenticated","user_metadata":{"role":"owner"}}'::jsonb,
    '{}'::jsonb
  ] loop
    perform set_config('request.jwt.claims',v_claims::text,true);
    insert into _security_checks values ('absent/null claims deny both gates',
      app.is_admin() is false and app.is_manager() is false,null);
  end loop;
end;
$$;
reset role;

-- All currently flagged RPCs require login and pin their search path.
insert into _security_checks
select p.proname || ': anonymous execution denied',
  not has_function_privilege('anon',p.oid,'execute'),null
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prosecdef
  and has_function_privilege('authenticated',p.oid,'execute');
insert into _security_checks
select p.proname || ': fixed search path', 'search_path=""'=any(p.proconfig),null
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prosecdef
  and has_function_privilege('authenticated',p.oid,'execute');

insert into _security_checks
select 'webhook secrets are server-only', c.relrowsecurity
  and not has_table_privilege('anon',c.oid,'select,insert,update,delete,truncate')
  and not has_table_privilege('authenticated',c.oid,'select,insert,update,delete,truncate')
  and not exists (select 1 from pg_policy where polrelid=c.oid),null
from pg_class c where c.oid='public.webhook_secrets'::regclass;

-- @print
select name, ok, detail from _security_checks order by ok nulls first, name;
do $$
begin
  if exists (select 1 from _security_checks where ok is distinct from true) then
    raise exception 'SECURITY_ROLE_REGRESSION: %',
      (select string_agg(name || ': ' || coalesce(detail,'NULL'), '; ')
       from _security_checks where ok is distinct from true);
  end if;
end;
$$;
rollback;
