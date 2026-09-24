
-- =====================================================================
-- TESTS (demo tenant only; everything below is rolled back)
--   demo tenant 170d2d86-5c22-4bcb-9d74-420c879419b2
--   owner   129bbbae-fdfc-4d21-8a86-8949fec2403b
--   manager 950e38aa-2bd7-4c55-9dfc-9b4255316548
--   viewer  a0000000-0000-4000-8000-00000000000a (JWT only, no profile)
-- =====================================================================
reset role;
create temp table _results (name text primary key, pass boolean not null, detail text) on commit drop;
grant all on _results to public;
create temp table _ctx (k text primary key, v uuid) on commit drop;
grant all on _ctx to public;

create function pg_temp.become(p_uid uuid, p_role text,
  p_tenant uuid default '170d2d86-5c22-4bcb-9d74-420c879419b2')
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_uid, 'role', 'authenticated',
    'app_metadata', json_build_object('tenant_id', p_tenant, 'role', p_role))::text, true);
  set local role authenticated;
end $$;

create function pg_temp.ok(p_name text, p_pass boolean, p_detail text default null)
returns void language sql as $$
  insert into _results values (p_name, coalesce(p_pass, false), p_detail)
  on conflict (name) do update set pass = excluded.pass, detail = excluded.detail;
$$;

create function pg_temp.put(p_k text, p_v uuid) returns void language sql as $$
  insert into _ctx values (p_k, p_v) on conflict (k) do update set v = excluded.v;
$$;
create function pg_temp.get(p_k text) returns uuid language sql as $$
  select v from _ctx where k = p_k;
$$;

-- postgres-only helper (call after `reset role`)
create function pg_temp.set_module(p_module text, p_enabled boolean,
  p_tenant uuid default '170d2d86-5c22-4bcb-9d74-420c879419b2')
returns void language sql as $$
  insert into public.tenant_modules (tenant_id, module_id, enabled)
  values (p_tenant, p_module, p_enabled)
  on conflict (tenant_id, module_id) do update set enabled = excluded.enabled;
$$;

-- ---------------------------------------------------------------------
-- 00 structural checks
-- ---------------------------------------------------------------------
do $$
declare
  v_tables regclass[] := array[
    'public.companies', 'public.branches', 'public.departments', 'public.employees',
    'public.suppliers', 'public.supplier_contacts', 'public.warehouses', 'public.inventory_items',
    'public.stock_levels', 'public.stock_moves', 'public.notifications',
    'public.notification_preferences', 'public.notification_state', 'public.domain_events',
    'public.documents', 'public.api_keys']::regclass[];
  v_missing text;
  v_no_rls text;
begin
  select string_agg(c.conrelid::regclass::text || '.' || a.attname, ', ') into v_missing
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  where c.contype = 'f'
    and (c.conrelid = any (v_tables)
         or (c.conrelid in ('public.vehicles'::regclass, 'public.drivers'::regclass)
             and a.attname = 'branch_id'))
    and not exists (
      select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]);
  perform pg_temp.ok('00a every FK column indexed', v_missing is null, coalesce(v_missing, 'all covered'));

  select string_agg(relname, ', ') into v_no_rls
  from pg_class where oid = any (v_tables) and not relrowsecurity;
  perform pg_temp.ok('00b RLS enabled on all 16 new tables', v_no_rls is null, coalesce(v_no_rls, 'ok'));

  perform pg_temp.ok('00c grants on gating helpers',
    has_function_privilege('authenticated', 'app.module_enabled(text)', 'execute')
    and not has_function_privilege('anon', 'app.module_enabled(text)', 'execute')
    and not has_function_privilege('anon', 'app.tenant_module_enabled(uuid,text)', 'execute')
    and not has_function_privilege('authenticated',
      'app.notify(uuid,text,text,text,text,uuid,text,jsonb,text,text,text,uuid)', 'execute')
    and not has_function_privilege('authenticated', 'app.emit_event(uuid,text,text,uuid,jsonb,text)', 'execute')
    and not has_function_privilege('authenticated',
      'app.post_stock_move(uuid,uuid,uuid,text,numeric,numeric,text,uuid,text)', 'execute')
    and not has_function_privilege('anon', 'public.stock_receive(uuid,uuid,numeric,numeric,text)', 'execute')
    and has_function_privilege('authenticated', 'public.stock_receive(uuid,uuid,numeric,numeric,text)', 'execute')
    and not has_function_privilege('anon', 'public.refresh_notifications(boolean)', 'execute')
    and not has_function_privilege('anon', 'public.create_api_key(text,text[],timestamptz)', 'execute')
    and not has_function_privilege('authenticated', 'app.alert_low_stock(uuid,uuid,numeric,uuid,uuid)', 'execute')
    and not has_function_privilege('authenticated', 'app.assert_same_tenant()', 'execute')
    and not has_function_privilege('authenticated', 'app.assign_doc_number()', 'execute'),
    'module_enabled: auth yes/anon no; notify/emit/post_stock_move/alert/assert/assign: auth no; RPCs: anon no');

  -- F12: contended locks (auth.*/storage.*/realtime.* via CREATE POLICY, and the
  -- existing-table ALTERs) are taken only by the file's last two sections
  perform pg_temp.ok('00d no contended locks before sections 17/18',
    (select held from _lock_probe) = '', coalesce(nullif((select held from _lock_probe), ''), 'none'));

  perform pg_temp.ok('00e document_sequences relaxed + prefix column',
    exists (select 1 from information_schema.columns where table_schema = 'public'
            and table_name = 'document_sequences' and column_name = 'prefix'),
    (select pg_get_constraintdef(oid) from pg_constraint where conname = 'document_sequences_doc_type_check'));

  perform pg_temp.ok('00f no scanners exist yet',
    not exists (select 1 from pg_proc where pronamespace = 'app'::regnamespace and proname like 'scan\_due\_%'),
    null);

  -- F4: FOR UPDATE would conflict with the KEY SHARE lock a caller's FK insert holds (deadlock)
  perform pg_temp.ok('00g stock ledger locks items FOR NO KEY UPDATE (no FOR UPDATE)',
    (select bool_and(prosrc ~* 'for\s+no\s+key\s+update' and prosrc !~* 'for\s+update')
     from pg_proc
     where oid in ('app.post_stock_move(uuid,uuid,uuid,text,numeric,numeric,text,uuid,text)'::regprocedure,
                   'public.stock_adjust(uuid,uuid,numeric,text)'::regprocedure)), null);

  -- F6: api_keys triggers ignore last_used_at
  perform pg_temp.ok('00h api_keys triggers skip last_used_at',
    (select count(*) from pg_trigger t
     where t.tgrelid = 'public.api_keys'::regclass and not t.tgisinternal
       and t.tgattr::int2[] @> array[(select attnum from pg_attribute
                                      where attrelid = 'public.api_keys'::regclass and attname = 'name')]
       and not t.tgattr::int2[] @> array[(select attnum from pg_attribute
                                          where attrelid = 'public.api_keys'::regclass and attname = 'last_used_at')])
    = 3, null);
end $$;

-- ---------------------------------------------------------------------
-- 01 module gate (inventory)
-- ---------------------------------------------------------------------
reset role;
select pg_temp.set_module('inventory', false);
insert into public.inventory_items (tenant_id, name, sku)
values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'Hidden item', 'HID-1');

do $$
declare v int; v_err text; v_me boolean;
begin
  perform pg_temp.become('129bbbae-fdfc-4d21-8a86-8949fec2403b', 'owner');
  select count(*) into v from public.inventory_items;
  select app.module_enabled('inventory') into v_me;
  begin
    insert into public.inventory_items (name) values ('Gate test');
    v_err := 'insert allowed';
  exception when others then v_err := sqlstate || ' ' || sqlerrm;
  end;
  perform pg_temp.ok('01a inventory off: owner sees 0 items', v = 0 and not v_me, 'visible=' || v || ' module_enabled=' || v_me);
  perform pg_temp.ok('01b inventory off: owner insert denied', v_err like '42501%', v_err);
  reset role;
  perform pg_temp.set_module('inventory', true);
  perform pg_temp.become('129bbbae-fdfc-4d21-8a86-8949fec2403b', 'owner');
  select count(*) into v from public.inventory_items;
  begin
    insert into public.inventory_items (name) values ('Gate test');
    v_err := 'ok';
  exception when others then v_err := sqlstate || ' ' || sqlerrm;
  end;
  perform pg_temp.ok('01c inventory on: owner sees + inserts', v = 1 and v_err = 'ok', 'visible=' || v || ' insert=' || v_err);
  reset role;
end $$;

-- ---------------------------------------------------------------------
-- 02 suppliers: roles, numbering, prefix override, contacts
-- ---------------------------------------------------------------------
reset role;
select pg_temp.set_module('suppliers', true);

do $$
declare v_err text; v_a text; v_b text; v_c text; v_d text; v_e text; v int; v_sup uuid;
begin
  perform pg_temp.become('a0000000-0000-4000-8000-00000000000a', 'viewer');
  begin
    insert into public.suppliers (name) values ('Viewer Supplier');
    v_err := 'insert allowed';
  exception when others then v_err := sqlstate || ' ' || sqlerrm;
  end;
  perform pg_temp.ok('02a viewer cannot insert suppliers', v_err like '42501%', v_err);

  perform pg_temp.become('129bbbae-fdfc-4d21-8a86-8949fec2403b', 'owner');
  insert into public.suppliers (name, supplier_type) values ('Alpha Parts', 'parts') returning doc_number, id into v_a, v_sup;
  insert into public.suppliers (name) values ('Beta Fuel') returning doc_number into v_b;
  perform pg_temp.ok('02b owner numbering SUP-00001, SUP-00002', v_a = 'SUP-00001' and v_b = 'SUP-00002', v_a || ', ' || v_b);
  perform pg_temp.put('supplier', v_sup);

  perform pg_temp.become('950e38aa-2bd7-4c55-9dfc-9b4255316548', 'manager');
  begin
    perform public.set_document_prefix('supplier', 'VEN');
    v_err := 'allowed';
  exception when others then v_err := sqlerrm;
  end;
  perform pg_temp.ok('02c manager cannot set prefix', v_err = 'FORBIDDEN', v_err);

  perform pg_temp.become('129bbbae-fdfc-4d21-8a86-8949fec2403b', 'owner');
  perform public.set_document_prefix('supplier', 'VEN');
  insert into public.suppliers (name) values ('Gamma Service') returning doc_number into v_c;
  perform pg_temp.ok('02d prefix override -> VEN-00003', v_c = 'VEN-00003', v_c);

  begin
    perform public.set_document_prefix('supplier', 'bad prefix!');
    v_err := 'allowed';
  exception when others then v_err := sqlerrm;
  end;
  begin
    perform public.set_document_prefix('invoice', 'X');
    v_e := 'allowed';
  exception when others then v_e := sqlerrm;
  end;
  perform pg_temp.ok('02e prefix validation', v_err = 'INVALID_DOC_PREFIX' and v_e = 'INVALID_DOC_TYPE', v_err || ' / ' || v_e);

  -- F2/F7: a client (authenticated) never chooses numbers: forged / poison
  -- values on insert are replaced by an allocation, and updates keep both columns
  insert into public.suppliers (name, number, doc_number) values ('Forged', 777777, 'SUP-00001')
    returning doc_number into v_d;
  insert into public.suppliers (name, number) values ('Poison', 2147483646) returning doc_number into v_e;
  update public.suppliers set number = 999, doc_number = 'SUP-00002' where id = v_sup;
  select doc_number || '#' || number into v_a from public.suppliers where id = v_sup;
  perform pg_temp.ok('02f client number/doc_number ignored on insert, frozen on update',
    v_d = 'VEN-00004' and v_e = 'VEN-00005' and v_a = 'SUP-00001#1', concat_ws(', ', v_d, v_e, v_a));

  -- trusted session (direct SQL / service_role): explicit import kept, counter
  -- advanced, bounds enforced, doc_number unique per tenant
  reset role;
  insert into public.suppliers (tenant_id, name, number)
  values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'Imported', 10) returning doc_number into v_d;
  begin
    insert into public.suppliers (tenant_id, name, number)
    values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'Too big', 2147483646);
    v_err := 'allowed';
  exception when others then v_err := sqlerrm;
  end;
  begin
    insert into public.suppliers (tenant_id, name, number)
    values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'Zero', 0);
    v_b := 'allowed';
  exception when others then v_b := sqlerrm;
  end;
  begin
    insert into public.suppliers (tenant_id, name, number, doc_number)
    values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'Dup doc', 20, 'SUP-00001');
    v_c := 'allowed';
  exception when others then v_c := sqlstate;
  end;
  perform pg_temp.become('129bbbae-fdfc-4d21-8a86-8949fec2403b', 'owner');
  insert into public.suppliers (name) values ('After import') returning doc_number into v_e;
  perform pg_temp.ok('02g trusted import kept + counter advanced; bounds; unique doc_number',
    v_d = 'VEN-00010' and v_e = 'VEN-00011' and v_err = 'INVALID_DOC_NUMBER'
    and v_b = 'INVALID_DOC_NUMBER' and v_c = '23505',
    concat_ws(', ', v_d, v_e, v_err, v_b, v_c));

  perform public.set_document_prefix('supplier', null);
  insert into public.suppliers (name) values ('Reset prefix') returning doc_number into v_e;
  perform pg_temp.ok('02g2 clearing prefix falls back to SUP', v_e = 'SUP-00012', v_e);

  insert into public.supplier_contacts (supplier_id, name, is_primary) values (v_sup, 'Primary One', true);
  begin
    insert into public.supplier_contacts (supplier_id, name, is_primary) values (v_sup, 'Primary Two', true);
    v_err := 'allowed';
  exception when others then v_err := sqlstate;
  end;
  perform pg_temp.ok('02h one primary contact per supplier', v_err = '23505', v_err);

  perform pg_temp.become('a0000000-0000-4000-8000-00000000000a', 'viewer');
  select count(*) into v from public.suppliers;
  perform pg_temp.ok('02i viewer can read suppliers', v = 8, 'visible=' || v);
  reset role;
end $$;

-- ---------------------------------------------------------------------
-- 02x employees / departments / companies / branches
-- ---------------------------------------------------------------------
reset role;
select pg_temp.set_module('employees', true);
select pg_temp.set_module('multi_company', true);

do $$
declare v_err text; v_a text; v_b text; v int; v_c1 uuid; v_c2 uuid; v_def int; v_br uuid; v_emp uuid;
begin
  perform pg_temp.become('129bbbae-fdfc-4d21-8a86-8949fec2403b', 'owner');
  insert into public.employees (first_name, last_name, basic_salary) values ('Sara', 'Ali', 1000)
    returning doc_number, id into v_a, v_emp;
  insert into public.employees (first_name, last_name, user_id) values ('Mo', null, '950e38aa-2bd7-4c55-9dfc-9b4255316548')
    returning doc_number, id into v_b, v_br;
  perform pg_temp.put('emp_sara', v_emp);
  perform pg_temp.put('emp_mo', v_br);
  -- F9: a blanked optional last_name (sent as null) is accepted
  perform pg_temp.ok('02x-a employee numbering EMP-00001/2 (last_name null ok)', v_a = 'EMP-00001' and v_b = 'EMP-00002', v_a || ', ' || v_b);
  begin
    insert into public.employees (first_name, user_id) values ('Dup', '950e38aa-2bd7-4c55-9dfc-9b4255316548');
    v_err := 'allowed';
  exception when others then v_err := sqlstate;
  end;
  perform pg_temp.ok('02x-b employees.user_id unique', v_err = '23505', v_err);

  insert into public.departments (name, code) values ('Operations', 'OPS');
  begin
    insert into public.departments (name, code) values ('Ops 2', 'ops');
    v_err := 'allowed';
  exception when others then v_err := sqlstate;
  end;
  perform pg_temp.ok('02x-c department code unique (ci)', v_err = '23505', v_err);

  insert into public.companies (legal_name, is_default) values ('Acme LLC', true) returning id into v_c1;
  perform pg_temp.put('company', v_c1);
  insert into public.companies (legal_name, is_default) values ('Acme Gulf', true) returning id into v_c2;
  select count(*) into v_def from public.companies where is_default;
  perform pg_temp.ok('02x-d one default company (auto-cleared)',
    v_def = 1 and (select is_default from public.companies where id = v_c2), 'defaults=' || v_def);

  insert into public.branches (company_id, name, code, manager_employee_id) values (v_c1, 'HQ', 'HQ', v_emp) returning id into v_br;
  perform pg_temp.put('branch', v_br);
  update public.vehicles set branch_id = v_br where id = (select id from public.vehicles order by created_at limit 1);
  get diagnostics v = row_count;
  perform pg_temp.ok('02x-e vehicles.branch_id settable', v = 1, 'rows=' || v);
  begin
    delete from public.companies where id = v_c1;
    v_err := 'allowed';
  exception when others then v_err := sqlstate;
  end;
  perform pg_temp.ok('02x-f company with branches cannot be deleted', v_err = '23503', v_err);

  -- HR data: a viewer sees no directory; a viewer linked to an employee sees only themself
  perform pg_temp.become('a0000000-0000-4000-8000-00000000000a', 'viewer');
  select count(*) into v from public.employees;
  perform pg_temp.ok('02x-g viewer sees no employees', v = 0, 'visible=' || v);
  perform pg_temp.become('950e38aa-2bd7-4c55-9dfc-9b4255316548', 'viewer');
  select count(*) into v from public.employees;
  perform pg_temp.ok('02x-h linked user sees only own employee row', v = 1, 'visible=' || v);
  perform pg_temp.become('950e38aa-2bd7-4c55-9dfc-9b4255316548', 'manager');
  select count(*) into v from public.employees;
  perform pg_temp.ok('02x-i manager sees directory', v = 2, 'visible=' || v);
  reset role;
end $$;

-- ---------------------------------------------------------------------
-- 03 stock ledger
-- ---------------------------------------------------------------------
reset role;
select pg_temp.set_module('notifications', true);
select pg_temp.set_module('integrations', true);

do $$
declare
  v_item uuid; v_w1 uuid; v_w2 uuid; v_err text; v_l1 numeric; v_l2 numeric; v_cost numeric;
  v int; v_ref uuid; v_move uuid; v_mt text; v_mq numeric; v_def int; v_name text;
begin
  perform pg_temp.become('129bbbae-fdfc-4d21-8a86-8949fec2403b', 'owner');
  insert into public.inventory_items (name, sku, reorder_point, uom)
  values ('Brake pad', 'BP-1', 10, 'pcs') returning id into v_item;
  insert into public.warehouses (name, code, is_default) values ('Main', 'W1', true) returning id into v_w1;
  insert into public.warehouses (name, code, is_default) values ('Branch', 'W2', true) returning id into v_w2;
  select count(*) into v_def from public.warehouses where is_default;
  perform pg_temp.ok('03a one default warehouse', v_def = 1, 'defaults=' || v_def);
  perform pg_temp.put('item', v_item);
  perform pg_temp.put('w1', v_w1);
  perform pg_temp.put('w2', v_w2);

  perform public.stock_receive(v_item, v_w1, 10, 5);
  perform public.stock_receive(v_item, v_w1, 10, 7);
  select on_hand into v_l1 from public.stock_levels where item_id = v_item and warehouse_id = v_w1;
  select cost_price into v_cost from public.inventory_items where id = v_item;
  perform pg_temp.ok('03b receive 10@5 + 10@7 -> 20 @ 6', v_l1 = 20 and v_cost = 6, 'on_hand=' || v_l1 || ' cost=' || v_cost);

  begin
    perform public.stock_issue(v_item, v_w1, 25);
    v_err := 'allowed';
  exception when others then v_err := sqlerrm;
  end;
  select on_hand into v_l1 from public.stock_levels where item_id = v_item and warehouse_id = v_w1;
  perform pg_temp.ok('03c issue 25 -> INSUFFICIENT_STOCK, level unchanged',
    v_err like 'INSUFFICIENT_STOCK%' and v_l1 = 20, v_err || ' / on_hand=' || v_l1);

  v_ref := public.stock_transfer(v_item, v_w1, v_w2, 5);
  select on_hand into v_l1 from public.stock_levels where item_id = v_item and warehouse_id = v_w1;
  select on_hand into v_l2 from public.stock_levels where item_id = v_item and warehouse_id = v_w2;
  select count(*) into v from public.stock_moves where reference_type = 'stock_transfer' and reference_id = v_ref;
  perform pg_temp.ok('03d transfer 5 -> 15 / 5, two legs', v_l1 = 15 and v_l2 = 5 and v = 2,
    v_l1 || ' / ' || v_l2 || ' legs=' || v);

  select count(*) into v from public.notifications where kind = 'inventory.low_stock';
  perform pg_temp.ok('03e no low-stock alert above reorder point', v = 0, 'count=' || v);

  v_move := public.stock_adjust(v_item, v_w1, 3);
  select on_hand into v_l1 from public.stock_levels where item_id = v_item and warehouse_id = v_w1;
  select move_type, quantity into v_mt, v_mq from public.stock_moves where id = v_move;
  perform pg_temp.ok('03f adjust to 3 -> level 3 via adjustment move', v_l1 = 3 and v_mt = 'adjustment' and v_mq = -12,
    'on_hand=' || v_l1 || ' move=' || v_mt || ' ' || v_mq);

  select count(*) into v from public.notifications where kind = 'inventory.low_stock' and entity_id = v_item;
  perform pg_temp.ok('03g low-stock notification on crossing (owner)', v = 1, 'count=' || v);
  select count(*) into v from public.domain_events where event = 'stock.below_reorder' and entity_id = v_item;
  perform pg_temp.ok('03h stock.below_reorder event (integrations on)', v = 1, 'count=' || v);

  perform pg_temp.become('950e38aa-2bd7-4c55-9dfc-9b4255316548', 'manager');
  select count(*) into v from public.notifications where kind = 'inventory.low_stock' and entity_id = v_item;
  perform pg_temp.ok('03i low-stock notification reaches manager', v = 1, 'count=' || v);
  select count(*) into v from public.domain_events;
  perform pg_temp.ok('03j manager (non-admin) cannot read domain_events', v = 0, 'visible=' || v);

  perform pg_temp.become('129bbbae-fdfc-4d21-8a86-8949fec2403b', 'owner');
  update public.inventory_items set cost_price = 99, name = 'Brake pad (front)' where id = v_item;
  select cost_price, name into v_cost, v_name from public.inventory_items where id = v_item;
  perform pg_temp.ok('03k client cannot overwrite moving-average cost', v_cost = 6 and v_name = 'Brake pad (front)',
    'cost=' || v_cost || ' name=' || v_name);

  v_move := public.stock_adjust(v_item, v_w1, 3);
  perform pg_temp.ok('03l adjust to same value -> no move', v_move is null, coalesce(v_move::text, 'null'));

  begin
    perform public.stock_issue(v_item, v_w1, -1);
    v_err := 'allowed';
  exception when others then v_err := sqlerrm;
  end;
  begin
    perform public.stock_transfer(v_item, v_w1, v_w1, 1);
    v_mt := 'allowed';
  exception when others then v_mt := sqlerrm;
  end;
  perform pg_temp.ok('03m input validation', v_err = 'INVALID_QUANTITY' and v_mt = 'TRANSFER_SAME_WAREHOUSE', v_err || ' / ' || v_mt);

  perform public.stock_issue(v_item, v_w2, 2, 'work_order', gen_random_uuid(), 'fitted');
  select on_hand into v_l2 from public.stock_levels where item_id = v_item and warehouse_id = v_w2;
  select unit_cost into v_cost from public.stock_moves where item_id = v_item and move_type = 'issue';
  perform pg_temp.ok('03n issue records avg cost + reference', v_l2 = 3 and v_cost = 6, 'on_hand=' || v_l2 || ' unit_cost=' || v_cost);

  select count(*) into v from public.stock_moves where item_id = v_item;
  perform pg_temp.ok('03o ledger has exactly 6 moves (failed ones rolled back)', v = 6, 'moves=' || v);

  perform pg_temp.become('a0000000-0000-4000-8000-00000000000a', 'viewer');
  begin
    perform public.stock_receive(v_item, v_w1, 1, 1);
    v_err := 'allowed';
  exception when others then v_err := sqlerrm;
  end;
  select count(*) into v from public.stock_levels where item_id = v_item;
  perform pg_temp.ok('03p viewer: RPC forbidden, ledger readable', v_err = 'FORBIDDEN' and v = 2, v_err || ' levels=' || v);
  reset role;
end $$;

-- 03q-03w: review fixes (inbound into a deficit, adjust rounding, event dedupe,
-- low stock without a crossing, reorder-point raise, null normalization)
reset role;
do $$
declare
  v_w1 uuid := pg_temp.get('w1');
  v_i uuid; v_err text; v_e2 text; v_l numeric; v_move uuid; v_n int; v_ev int; v_uom text; v_cost numeric;
begin
  perform pg_temp.become('129bbbae-fdfc-4d21-8a86-8949fec2403b', 'owner');

  -- F5: untracked item goes negative, tracking switched on, a receipt must still post
  insert into public.inventory_items (name, sku, track_stock) values ('Loose bolt', 'LB-1', false) returning id into v_i;
  perform public.stock_issue(v_i, v_w1, 10);
  update public.inventory_items set track_stock = true where id = v_i;
  begin
    perform public.stock_receive(v_i, v_w1, 5, 2);
    v_err := 'ok';
  exception when others then v_err := sqlerrm;
  end;
  select on_hand into v_l from public.stock_levels where item_id = v_i and warehouse_id = v_w1;
  begin
    perform public.stock_issue(v_i, v_w1, 1);
    v_e2 := 'allowed';
  exception when others then v_e2 := sqlerrm;
  end;
  perform pg_temp.ok('03q inbound move reduces a deficit; outbound still guarded',
    v_err = 'ok' and v_l = -5 and v_e2 like 'INSUFFICIENT_STOCK%', v_err || ' on_hand=' || v_l || ' / ' || v_e2);

  -- F8: target within rounding of the balance -> no move (not INVALID_QUANTITY)
  begin
    v_move := public.stock_adjust(pg_temp.get('item'), v_w1, 3.0004);
    v_err := coalesce(v_move::text, 'null');
  exception when others then v_err := sqlerrm;
  end;
  perform pg_temp.ok('03r adjust to 3.0004 on 3.000 -> null', v_err = 'null', v_err);

  -- F10: three crossings in one day -> one event, one notification per recipient
  insert into public.inventory_items (name, sku, reorder_point) values ('Oil filter', 'OF-1', 5) returning id into v_i;
  perform public.stock_receive(v_i, v_w1, 10, 1);
  perform public.stock_issue(v_i, v_w1, 6);   -- 4: crossing 1
  perform public.stock_receive(v_i, v_w1, 5, 1);
  perform public.stock_issue(v_i, v_w1, 5);   -- 4: crossing 2
  perform public.stock_receive(v_i, v_w1, 5, 1);
  perform public.stock_issue(v_i, v_w1, 5);   -- 4: crossing 3
  reset role;
  select count(*) into v_ev from public.domain_events where event = 'stock.below_reorder' and entity_id = v_i;
  select count(*) into v_n from public.notifications where kind = 'inventory.low_stock' and entity_id = v_i;
  perform pg_temp.ok('03s repeated crossings: 1 event + 1 notification per recipient per day',
    v_ev = 1 and v_n = 2, 'events=' || v_ev || ' notifications=' || v_n);

  -- F11a: item that never was above its reorder point alerts on its first issue
  perform pg_temp.become('129bbbae-fdfc-4d21-8a86-8949fec2403b', 'owner');
  insert into public.inventory_items (name, sku, reorder_point) values ('Wiper', 'WP-1', 10) returning id into v_i;
  perform public.stock_receive(v_i, v_w1, 5, 3);
  reset role;
  select count(*) into v_n from public.notifications where kind = 'inventory.low_stock' and entity_id = v_i;
  perform pg_temp.become('129bbbae-fdfc-4d21-8a86-8949fec2403b', 'owner');
  perform public.stock_issue(v_i, v_w1, 4);
  reset role;
  select count(*) into v_ev from public.domain_events where event = 'stock.below_reorder' and entity_id = v_i;
  perform pg_temp.ok('03t low stock without a crossing: receipt silent, issue alerts',
    v_n = 0 and (select count(*) from public.notifications where kind = 'inventory.low_stock' and entity_id = v_i) = 2
    and v_ev = 1, 'after receipt=' || v_n || ' events=' || v_ev);

  -- F11b: raising the reorder point above the balance alerts at once; raising
  -- it on an already-low item or keeping it below the balance does not
  perform pg_temp.become('129bbbae-fdfc-4d21-8a86-8949fec2403b', 'owner');
  insert into public.inventory_items (name, sku) values ('Coolant', 'CL-1') returning id into v_i;
  perform public.stock_receive(v_i, v_w1, 5, 4);
  update public.inventory_items set reorder_point = 4 where id = v_i;  -- 5 > 4: silent
  reset role;
  select count(*) into v_n from public.notifications where kind = 'inventory.low_stock' and entity_id = v_i;
  perform pg_temp.become('129bbbae-fdfc-4d21-8a86-8949fec2403b', 'owner');
  update public.inventory_items set reorder_point = 8 where id = v_i;  -- 5 <= 8: alert
  update public.inventory_items set reorder_point = 9, name = 'Coolant 5L' where id = v_i;  -- already low
  reset role;
  select count(*) into v_ev from public.domain_events where event = 'stock.below_reorder' and entity_id = v_i;
  perform pg_temp.ok('03u reorder point raised above balance alerts once',
    v_n = 0 and (select count(*) from public.notifications where kind = 'inventory.low_stock' and entity_id = v_i) = 2
    and v_ev = 1, 'before=' || v_n || ' events=' || v_ev);

  -- F9: blanked uom / cost_price sent as null are normalized, not 23502
  perform pg_temp.become('129bbbae-fdfc-4d21-8a86-8949fec2403b', 'owner');
  begin
    insert into public.inventory_items (name, uom, cost_price) values ('Blank fields', null, null) returning id into v_i;
    update public.inventory_items set uom = '  ', cost_price = null, sku = null where id = v_i;
    select uom, cost_price into v_uom, v_cost from public.inventory_items where id = v_i;
    v_err := 'ok';
  exception when others then v_err := sqlstate || ' ' || sqlerrm;
  end;
  perform pg_temp.ok('03v null uom/cost_price normalized', v_err = 'ok' and v_uom = 'unit' and v_cost = 0,
    v_err || ' uom=' || coalesce(v_uom, 'null') || ' cost=' || coalesce(v_cost::text, 'null'));
  reset role;
end $$;

-- ---------------------------------------------------------------------
-- 04 direct writes to the ledger are denied
-- ---------------------------------------------------------------------
do $$
declare v_e1 text; v_e2 text; v_e3 text; v_e4 text;
begin
  perform pg_temp.become('129bbbae-fdfc-4d21-8a86-8949fec2403b', 'owner');
  begin
    insert into public.stock_moves (tenant_id, item_id, warehouse_id, move_type, quantity)
    values ('170d2d86-5c22-4bcb-9d74-420c879419b2', pg_temp.get('item'), pg_temp.get('w1'), 'receipt', 1000);
    v_e1 := 'allowed';
  exception when others then v_e1 := sqlstate;
  end;
  begin
    insert into public.stock_levels (tenant_id, item_id, warehouse_id, on_hand)
    values ('170d2d86-5c22-4bcb-9d74-420c879419b2', pg_temp.get('item'), gen_random_uuid(), 1000);
    v_e2 := 'allowed';
  exception when others then v_e2 := sqlstate;
  end;
  begin
    update public.stock_levels set on_hand = 1000 where item_id = pg_temp.get('item');
    v_e3 := 'allowed';
  exception when others then v_e3 := sqlstate;
  end;
  begin
    delete from public.stock_moves where item_id = pg_temp.get('item');
    v_e4 := 'allowed';
  exception when others then v_e4 := sqlstate;
  end;
  perform pg_temp.ok('04 direct insert/update/delete on stock_moves/levels denied',
    v_e1 = '42501' and v_e2 = '42501' and v_e3 = '42501' and v_e4 = '42501',
    concat_ws(' ', v_e1, v_e2, v_e3, v_e4));
  reset role;
end $$;

-- ---------------------------------------------------------------------
-- 05 notify fan-out, dedupe, mute, recipient RLS, column grant
-- ---------------------------------------------------------------------
reset role;
do $$
declare v int; v_set text; v_err text; v_id uuid; v_title text;
begin
  v := app.notify('170d2d86-5c22-4bcb-9d74-420c879419b2', 'managers', 'test.kind', 'info',
                  null, null, '/x', '{"a":1}', 'Hello', null, 'k1');
  select string_agg(recipient_id::text, ',' order by recipient_id) into v_set
  from public.notifications where dedupe_key = 'k1';
  perform pg_temp.ok('05a managers audience -> owner + manager only',
    v = 2 and v_set = '129bbbae-fdfc-4d21-8a86-8949fec2403b,950e38aa-2bd7-4c55-9dfc-9b4255316548', v || ': ' || v_set);

  v := app.notify('170d2d86-5c22-4bcb-9d74-420c879419b2', 'managers', 'test.kind', 'info',
                  null, null, '/x', '{"a":1}', 'Hello', null, 'k1');
  perform pg_temp.ok('05b dedupe_key prevents duplicates', v = 0
    and (select count(*) from public.notifications where dedupe_key = 'k1') = 2, 'inserted=' || v);

  v := app.notify('170d2d86-5c22-4bcb-9d74-420c879419b2', 'admins', 'test.kind', 'info',
                  null, null, null, null, null, null, 'k2');
  perform pg_temp.ok('05c admins audience -> owner only', v = 1
    and (select recipient_id from public.notifications where dedupe_key = 'k2') = '129bbbae-fdfc-4d21-8a86-8949fec2403b',
    'inserted=' || v);

  -- manager mutes the kind through RLS (own row)
  perform pg_temp.become('950e38aa-2bd7-4c55-9dfc-9b4255316548', 'manager');
  insert into public.notification_preferences (kind, muted) values ('test.kind', true);
  reset role;
  v := app.notify('170d2d86-5c22-4bcb-9d74-420c879419b2', 'managers', 'test.kind', 'warning',
                  null, null, null, null, 'Muted?', null, 'k3');
  perform pg_temp.ok('05d muted kind skipped', v = 1
    and (select recipient_id from public.notifications where dedupe_key = 'k3') = '129bbbae-fdfc-4d21-8a86-8949fec2403b',
    'inserted=' || v);

  v := app.notify('170d2d86-5c22-4bcb-9d74-420c879419b2', 'managers', 'other.kind', 'info',
                  null, null, null, null, 'Direct', null, null, '950e38aa-2bd7-4c55-9dfc-9b4255316548');
  perform pg_temp.ok('05e explicit recipient', v = 1, 'inserted=' || v);
  v := app.notify('170d2d86-5c22-4bcb-9d74-420c879419b2', 'managers', 'other.kind', 'info',
                  null, null, null, null, 'Nobody', null, null, gen_random_uuid());
  perform pg_temp.ok('05f recipient outside tenant ignored', v = 0, 'inserted=' || v);
  begin
    perform app.notify('170d2d86-5c22-4bcb-9d74-420c879419b2', 'everyone', 'x.y', 'info',
                       null, null, null, null, null, null, null);
    v_err := 'allowed';
  exception when others then v_err := sqlerrm;
  end;
  perform pg_temp.ok('05g invalid audience rejected', v_err like 'INVALID_AUDIENCE%', v_err);

  -- a user sees only their own rows
  perform pg_temp.become('950e38aa-2bd7-4c55-9dfc-9b4255316548', 'manager');
  select count(*) into v from public.notifications where kind in ('test.kind', 'other.kind');
  perform pg_temp.ok('05h manager sees only own notifications',
    v = 2 and (select count(*) from public.notifications
               where recipient_id <> '950e38aa-2bd7-4c55-9dfc-9b4255316548') = 0,
    'visible=' || v);

  -- owner marks read (allowed), edits title (denied), touches others' rows (0 rows)
  perform pg_temp.become('129bbbae-fdfc-4d21-8a86-8949fec2403b', 'owner');
  select id into v_id from public.notifications where dedupe_key = 'k1';
  update public.notifications set read_at = now() where id = v_id;
  get diagnostics v = row_count;
  begin
    update public.notifications set title = 'hacked' where id = v_id;
    v_err := 'allowed';
  exception when others then v_err := sqlstate;
  end;
  perform pg_temp.ok('05i recipient can set read_at but not title', v = 1 and v_err = '42501', 'read rows=' || v || ' title=' || v_err);

  update public.notifications set read_at = now() where recipient_id = '950e38aa-2bd7-4c55-9dfc-9b4255316548';
  get diagnostics v = row_count;
  begin
    insert into public.notifications (tenant_id, recipient_id, kind, title)
    values ('170d2d86-5c22-4bcb-9d74-420c879419b2', '129bbbae-fdfc-4d21-8a86-8949fec2403b', 'spoof', 'spoof');
    v_err := 'allowed';
  exception when others then v_err := sqlstate;
  end;
  perform pg_temp.ok('05j cannot touch others'' rows or insert', v = 0 and v_err = '42501', 'rows=' || v || ' insert=' || v_err);

  delete from public.notifications where id = v_id;
  get diagnostics v = row_count;
  perform pg_temp.ok('05k recipient can delete own', v = 1, 'deleted=' || v);
  reset role;

  select title into v_title from public.notifications where dedupe_key = 'k1' and recipient_id = '950e38aa-2bd7-4c55-9dfc-9b4255316548';
  perform pg_temp.ok('05l title untouched', v_title = 'Hello', v_title);
end $$;

-- ---------------------------------------------------------------------
-- 06 api keys
-- ---------------------------------------------------------------------
reset role;
do $$
declare v_key text; v_err text; v_row public.api_keys%rowtype; v int; v_e2 text; v_e3 text;
begin
  perform pg_temp.become('950e38aa-2bd7-4c55-9dfc-9b4255316548', 'manager');
  begin
    perform public.create_api_key('Mgr key', array['vehicles:read'], null);
    v_err := 'allowed';
  exception when others then v_err := sqlerrm;
  end;
  perform pg_temp.ok('06a manager cannot create api key', v_err = 'FORBIDDEN', v_err);

  perform pg_temp.become('129bbbae-fdfc-4d21-8a86-8949fec2403b', 'owner');
  v_key := public.create_api_key('Telematics box', array['telematics:write', 'vehicles:read'], null);
  perform pg_temp.ok('06b create_api_key returns fm_ + 48 hex', v_key ~ '^fm_[0-9a-f]{48}$', left(v_key, 12) || '...');
  reset role;
  select * into v_row from public.api_keys where tenant_id = '170d2d86-5c22-4bcb-9d74-420c879419b2';
  perform pg_temp.ok('06c only sha256 + prefix stored',
    v_row.key_hash = encode(extensions.digest(v_key, 'sha256'), 'hex')
    and v_row.key_prefix = left(v_key, 12)
    and position(v_key in to_jsonb(v_row)::text) = 0
    and not exists (select 1 from public.audit_events where table_name = 'api_keys'
                    and position(v_key in diff::text) > 0)
    and v_row.created_by = '129bbbae-fdfc-4d21-8a86-8949fec2403b',
    'prefix=' || v_row.key_prefix || ' scopes=' || v_row.scopes::text);

  perform pg_temp.become('129bbbae-fdfc-4d21-8a86-8949fec2403b', 'owner');
  begin
    perform public.create_api_key('Bad scope', array['admin:all'], null);
    v_err := 'allowed';
  exception when others then v_err := sqlerrm;
  end;
  begin
    perform public.create_api_key('Expired', array['iot:write'], now() - interval '1 day');
    v_e2 := 'allowed';
  exception when others then v_e2 := sqlerrm;
  end;
  begin
    update public.api_keys set key_hash = repeat('0', 64) where id = v_row.id;
    v_e3 := 'allowed';
  exception when others then v_e3 := sqlstate;
  end;
  perform pg_temp.ok('06d validation + key_hash immutable',
    v_err = 'INVALID_API_SCOPE' and v_e2 = 'INVALID_API_KEY_EXPIRY' and v_e3 = '42501',
    concat_ws(' / ', v_err, v_e2, v_e3));

  update public.api_keys set name = 'Renamed' where id = v_row.id;
  get diagnostics v = row_count;
  perform public.revoke_api_key(v_row.id);
  perform pg_temp.ok('06e admin rename + revoke',
    v = 1 and (select not active and revoked_at is not null and name = 'Renamed' from public.api_keys where id = v_row.id),
    'renamed rows=' || v);
  begin
    perform public.revoke_api_key(gen_random_uuid());
    v_err := 'allowed';
  exception when others then v_err := sqlerrm;
  end;
  perform pg_temp.ok('06f revoke unknown id', v_err = 'API_KEY_NOT_FOUND', v_err);

  perform pg_temp.become('950e38aa-2bd7-4c55-9dfc-9b4255316548', 'manager');
  select count(*) into v from public.api_keys;
  perform pg_temp.ok('06g manager cannot read api_keys', v = 0, 'visible=' || v);

  reset role;
  perform pg_temp.set_module('integrations', false);
  perform pg_temp.become('129bbbae-fdfc-4d21-8a86-8949fec2403b', 'owner');
  begin
    perform public.create_api_key('Off', array['iot:write'], null);
    v_err := 'allowed';
  exception when others then v_err := sqlerrm;
  end;
  perform pg_temp.ok('06h integrations off -> MODULE_DISABLED', v_err = 'MODULE_DISABLED', v_err);
  reset role;
  perform pg_temp.set_module('integrations', true);
end $$;

-- 06i F6: the worker's per-request last_used_at stamp (service_role) writes no
-- audit row and does not touch updated_at / updated_by
reset role;
do $$
declare v_id uuid; v_before int; v_after int; v_upd timestamptz; v_by uuid; v_used timestamptz;
begin
  select id into v_id from public.api_keys where tenant_id = '170d2d86-5c22-4bcb-9d74-420c879419b2' limit 1;
  update public.api_keys set updated_at = '2000-01-01' where id = v_id;  -- sentinel (not a tracked column)
  select count(*) into v_before from public.audit_events where table_name = 'api_keys' and row_id = v_id;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  update public.api_keys set last_used_at = clock_timestamp() where id = v_id;
  update public.api_keys set last_used_at = clock_timestamp() where id = v_id;
  update public.api_keys set last_used_at = clock_timestamp() where id = v_id;
  reset role;
  select count(*) into v_after from public.audit_events where table_name = 'api_keys' and row_id = v_id;
  select updated_at, updated_by, last_used_at into v_upd, v_by, v_used from public.api_keys where id = v_id;
  perform pg_temp.ok('06i last_used_at stamps: no audit, updated_at/by untouched',
    v_after = v_before and v_before >= 2 and v_upd = '2000-01-01' and v_by = '129bbbae-fdfc-4d21-8a86-8949fec2403b'
    and v_used is not null,
    'audit ' || v_before || '->' || v_after || ' updated_at=' || v_upd || ' by=' || coalesce(v_by::text, 'null'));
end $$;

-- ---------------------------------------------------------------------
-- 07 refresh_notifications: discovery, throttle, isolation
-- ---------------------------------------------------------------------
reset role;
do $$
declare v int; v_at timestamptz;
begin
  perform pg_temp.become('129bbbae-fdfc-4d21-8a86-8949fec2403b', 'owner');
  v := public.refresh_notifications();
  reset role;
  select last_scan_at into v_at from public.notification_state where tenant_id = '170d2d86-5c22-4bcb-9d74-420c879419b2';
  perform pg_temp.ok('07a no scanners -> 0, state recorded', v = 0 and v_at = now(), 'result=' || v || ' at=' || coalesce(v_at::text, 'null'));
end $$;

reset role;
create function app.scan_due_zz_dryrun(p_tenant uuid) returns integer
language plpgsql security definer set search_path = '' as $$
begin
  return app.notify(p_tenant, 'managers', 'zz.scan', 'info', null, null, null, null,
                    'Scan', null, 'zz.scan:' || current_date::text);
end $$;
create function app.scan_due_zz_broken(p_tenant uuid) returns integer
language plpgsql as $$ begin raise exception 'boom'; end $$;
create function app.scan_due_zz_wrong_sig(p_tenant uuid, p_x int) returns integer
language sql as $$ select 100 $$;

do $$
declare v1 int; v2 int; v3 int; v4 int; v5 int;
begin
  perform pg_temp.become('129bbbae-fdfc-4d21-8a86-8949fec2403b', 'owner');
  v1 := public.refresh_notifications();              -- throttled
  perform pg_temp.become('950e38aa-2bd7-4c55-9dfc-9b4255316548', 'manager');
  v2 := public.refresh_notifications(true);          -- non-admin force ignored
  perform pg_temp.become('129bbbae-fdfc-4d21-8a86-8949fec2403b', 'owner');
  v3 := public.refresh_notifications(true);          -- admin force: scanner runs (2 recipients)
  reset role;
  update public.notification_state set last_scan_at = now() - interval '1 hour'
   where tenant_id = '170d2d86-5c22-4bcb-9d74-420c879419b2';
  perform pg_temp.become('a0000000-0000-4000-8000-00000000000a', 'viewer');
  v4 := public.refresh_notifications();              -- stale -> runs; dedupe -> 0 new
  reset role;
  perform pg_temp.set_module('notifications', false);
  perform pg_temp.become('129bbbae-fdfc-4d21-8a86-8949fec2403b', 'owner');
  v5 := public.refresh_notifications(true);          -- module off
  reset role;
  perform pg_temp.set_module('notifications', true);
  perform pg_temp.ok('07b throttle: second call skipped', v1 = 0, 'result=' || v1);
  perform pg_temp.ok('07c non-admin force ignored', v2 = 0, 'result=' || v2);
  perform pg_temp.ok('07d admin force runs scanners; broken + wrong-signature isolated', v3 = 2, 'result=' || v3);
  perform pg_temp.ok('07e stale state rescans; scanner dedupe holds', v4 = 0
    and (select count(*) from public.notifications where kind = 'zz.scan') = 2, 'result=' || v4);
  perform pg_temp.ok('07f notifications module off -> 0', v5 = 0, 'result=' || v5);
end $$;

-- 07g F15: a scanner killed by the statement timeout stops the run but the call
-- returns, the throttle claim is kept, and later scanners are skipped
reset role;
create function app.scan_due_a_slow(p_tenant uuid) returns integer
language plpgsql as $$ begin perform pg_sleep(1); return 5; end $$;
create function app.scan_due_b_marker(p_tenant uuid) returns integer
language plpgsql as $$ begin insert into _ctx values ('b_marker_ran', p_tenant); return 1; end $$;
update public.notification_state set last_scan_at = now() - interval '1 hour', last_scan_count = -1
 where tenant_id = '170d2d86-5c22-4bcb-9d74-420c879419b2';
set local statement_timeout = '300ms';
do $$
declare v int; v_err text;
begin
  perform pg_temp.become('129bbbae-fdfc-4d21-8a86-8949fec2403b', 'owner');
  begin
    v := public.refresh_notifications();
    v_err := 'ok';
  exception when query_canceled then v_err := 'cancelled';
  end;
  reset role;
  perform pg_temp.ok('07g scanner timeout: call returns, claim kept, rest skipped',
    v_err = 'ok' and v = 0
    and (select last_scan_at = now() and last_scan_count = 0 from public.notification_state
         where tenant_id = '170d2d86-5c22-4bcb-9d74-420c879419b2')
    and pg_temp.get('b_marker_ran') is null,
    v_err || ' result=' || coalesce(v::text, 'null') || ' marker=' || coalesce(pg_temp.get('b_marker_ran')::text, 'none'));
end $$;
set local statement_timeout = '60s';
drop function app.scan_due_a_slow(uuid);
drop function app.scan_due_b_marker(uuid);

-- ---------------------------------------------------------------------
-- 08 cross-tenant guards (throwaway tenant, rolled back)
-- ---------------------------------------------------------------------
reset role;
insert into public.tenants (id, name) values ('d0000000-0000-4000-8000-0000000000d0', 'dryrun');
select pg_temp.set_module('inventory', true, 'd0000000-0000-4000-8000-0000000000d0');
insert into public.inventory_items (id, tenant_id, name)
values ('d0000000-0000-4000-8000-0000000000d1', 'd0000000-0000-4000-8000-0000000000d0', 'Other item');
insert into public.warehouses (id, tenant_id, name)
values ('d0000000-0000-4000-8000-0000000000d2', 'd0000000-0000-4000-8000-0000000000d0', 'Other WH');

do $$
declare v_e1 text; v_e2 text; v_e3 text; v_e4 text; v_e5 text; v int; v_l1 numeric; v_n int; v_ev bigint;
begin
  perform pg_temp.become('129bbbae-fdfc-4d21-8a86-8949fec2403b', 'owner');
  begin
    perform public.stock_receive('d0000000-0000-4000-8000-0000000000d1', pg_temp.get('w1'), 1, 1);
    v_e1 := 'allowed';
  exception when others then v_e1 := sqlerrm;
  end;
  begin
    perform public.stock_receive(pg_temp.get('item'), 'd0000000-0000-4000-8000-0000000000d2', 1, 1);
    v_e2 := 'allowed';
  exception when others then v_e2 := sqlerrm;
  end;
  begin
    perform public.stock_transfer(pg_temp.get('item'), pg_temp.get('w1'), 'd0000000-0000-4000-8000-0000000000d2', 1);
    v_e3 := 'allowed';
  exception when others then v_e3 := sqlerrm;
  end;
  begin
    perform public.stock_adjust('d0000000-0000-4000-8000-0000000000d1', 'd0000000-0000-4000-8000-0000000000d2', 5);
    v_e4 := 'allowed';
  exception when others then v_e4 := sqlerrm;
  end;
  begin
    insert into public.inventory_items (tenant_id, name) values ('d0000000-0000-4000-8000-0000000000d0', 'Planted');
    v_e5 := 'allowed';
  exception when others then v_e5 := sqlstate;
  end;
  select count(*) into v from public.inventory_items where tenant_id = 'd0000000-0000-4000-8000-0000000000d0';
  select on_hand into v_l1 from public.stock_levels where item_id = pg_temp.get('item') and warehouse_id = pg_temp.get('w1');
  perform pg_temp.ok('08a foreign item/warehouse rejected by stock RPCs',
    v_e1 = 'INVENTORY_ITEM_NOT_FOUND' and v_e2 = 'WAREHOUSE_NOT_FOUND' and v_e3 = 'WAREHOUSE_NOT_FOUND'
    and v_e4 = 'INVENTORY_ITEM_NOT_FOUND' and v_l1 = 3,
    concat_ws(' / ', v_e1, v_e2, v_e3, v_e4) || ' w1=' || v_l1);
  perform pg_temp.ok('08b other tenant invisible + insert with foreign tenant_id denied', v = 0 and v_e5 = '42501',
    'visible=' || v || ' insert=' || v_e5);
  reset role;

  v_n := app.notify('d0000000-0000-4000-8000-0000000000d0', 'all', 'x.y', 'info',
                    null, null, null, null, null, null, null);
  v_ev := app.emit_event('d0000000-0000-4000-8000-0000000000d0', 'x.happened', null, null, null);
  perform pg_temp.ok('08c notify/emit no-op when modules off', v_n = 0 and v_ev is null,
    'notify=' || v_n || ' event=' || coalesce(v_ev::text, 'null'));
end $$;

-- 08d-08g F3: FKs to another tenant's rows are rejected (no pinning / squatting)
reset role;
insert into public.companies (id, tenant_id, legal_name)
values ('d0000000-0000-4000-8000-0000000000c1', 'd0000000-0000-4000-8000-0000000000d0', 'Other Co');
insert into public.suppliers (id, tenant_id, name)
values ('d0000000-0000-4000-8000-0000000000e1', 'd0000000-0000-4000-8000-0000000000d0', 'Other Supplier');

do $$
declare v_e1 text; v_e2 text; v_e3 text; v_e4 text; v_e5 text; v_e6 text; v int;
begin
  perform pg_temp.become('950e38aa-2bd7-4c55-9dfc-9b4255316548', 'manager');
  begin
    insert into public.branches (name, company_id) values ('Pin', 'd0000000-0000-4000-8000-0000000000c1');
    v_e1 := 'allowed';
  exception when others then v_e1 := sqlerrm;
  end;
  begin
    update public.branches set company_id = 'd0000000-0000-4000-8000-0000000000c1' where id = pg_temp.get('branch');
    v_e2 := 'allowed';
  exception when others then v_e2 := sqlerrm;
  end;
  begin
    insert into public.supplier_contacts (supplier_id, name, is_primary)
    values ('d0000000-0000-4000-8000-0000000000e1', 'Squatter', true);
    v_e3 := 'allowed';
  exception when others then v_e3 := sqlerrm;
  end;
  begin
    insert into public.employees (first_name, user_id) values ('Ghost', gen_random_uuid());
    v_e4 := 'allowed';
  exception when others then v_e4 := sqlerrm;
  end;
  begin
    insert into public.inventory_items (name, preferred_supplier_id)
    values ('Foreign pref', 'd0000000-0000-4000-8000-0000000000e1');
    v_e5 := 'allowed';
  exception when others then v_e5 := sqlerrm;
  end;
  -- same-tenant links still work (unchanged value on update is not re-checked)
  begin
    update public.branches set name = 'HQ main', company_id = pg_temp.get('company') where id = pg_temp.get('branch');
    insert into public.employees (first_name, manager_id, branch_id)
    values ('Linked', pg_temp.get('emp_sara'), pg_temp.get('branch'));
    v_e6 := 'ok';
  exception when others then v_e6 := sqlerrm;
  end;
  reset role;
  perform pg_temp.ok('08d cross-tenant FK rejected (branch pin, contact squat, foreign user, item supplier)',
    v_e1 = 'CROSS_TENANT_REFERENCE: company_id' and v_e2 = 'CROSS_TENANT_REFERENCE: company_id'
    and v_e3 = 'CROSS_TENANT_REFERENCE: supplier_id' and v_e4 = 'CROSS_TENANT_REFERENCE: user_id'
    and v_e5 = 'CROSS_TENANT_REFERENCE: preferred_supplier_id',
    concat_ws(' / ', v_e1, v_e2, v_e3, v_e4, v_e5));
  perform pg_temp.ok('08e same-tenant references still accepted', v_e6 = 'ok', v_e6);

  -- the other tenant keeps full control of its own rows
  insert into public.supplier_contacts (tenant_id, supplier_id, name, is_primary)
  values ('d0000000-0000-4000-8000-0000000000d0', 'd0000000-0000-4000-8000-0000000000e1', 'Their primary', true);
  delete from public.companies where id = 'd0000000-0000-4000-8000-0000000000c1';
  get diagnostics v = row_count;
  perform pg_temp.ok('08f other tenant: own primary contact + company delete unaffected', v = 1, 'deleted=' || v);
end $$;

-- ---------------------------------------------------------------------
-- 10 emit_event dedupe + visibility
-- ---------------------------------------------------------------------
reset role;
do $$
declare v1 bigint; v2 bigint; v int;
begin
  v1 := app.emit_event('170d2d86-5c22-4bcb-9d74-420c879419b2', 'test.happened', 'thing', gen_random_uuid(), '{"x":1}', 'd1');
  v2 := app.emit_event('170d2d86-5c22-4bcb-9d74-420c879419b2', 'test.happened', 'thing', gen_random_uuid(), '{"x":1}', 'd1');
  perform pg_temp.ok('10a emit_event dedupe', v1 is not null and v2 is null
    and (select count(*) from public.domain_events where dedupe_key = 'd1') = 1,
    'first=' || coalesce(v1::text, 'null') || ' second=' || coalesce(v2::text, 'null'));
  perform pg_temp.become('a0000000-0000-4000-8000-00000000000a', 'viewer');
  select count(*) into v from public.domain_events;
  perform pg_temp.ok('10b viewer cannot read domain_events', v = 0, 'visible=' || v);
  reset role;
end $$;

