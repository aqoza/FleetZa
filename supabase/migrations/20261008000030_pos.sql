-- Point of sale (module pos): registers, cash sessions, counter sales and
-- refunds, on top of the sales product catalog and (when enabled) inventory.
--
-- 1) pos_registers: a till (name, optional warehouse it sells from, active).
-- 2) pos_sessions (numbered POSS-00001, doc type 'pos_session'): one open
--    session per register (POS_SESSION_OPEN). public.pos_open_session opens
--    it with the opening float; public.pos_close_session records the counted
--    cash and freezes expected cash (opening + cash taken - change given) and
--    the difference.
-- 3) pos_orders (numbered POS-00001, doc type 'pos_order') with
--    pos_order_lines. Only public.pos_checkout writes them: it prices the
--    cart server-side from the product catalog (same rounding as sales
--    documents), checks the tender covers the total (POS_UNDERPAID; change
--    comes from cash only, POS_CHANGE_FROM_CARD), and posts 'sale' stock moves
--    from the register's warehouse for products linked to a tracked inventory
--    item. public.pos_refund books the mirror order in an open session of the
--    same register, posts 'return' stock moves and marks the original refunded.
-- 4) Reports (invoker, RLS applies): pos_session_summary(session) for the
--    Z-report and pos_daily_sales(from, to).
--
-- Raised codes: POS_SESSION_OPEN, POS_SESSION_CLOSED, POS_REGISTER_INACTIVE,
-- POS_EMPTY_CART, POS_PRODUCT_INVALID, POS_LINE_INVALID, POS_UNDERPAID,
-- POS_CHANGE_FROM_CARD, POS_NOT_REFUNDABLE, POS_NO_OPEN_SESSION
-- (+ FORBIDDEN, MODULE_DISABLED, NO_TENANT, INSUFFICIENT_STOCK,
-- CROSS_TENANT_REFERENCE). Additive only.

set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- ============================================================
-- Tables
-- ============================================================
create table public.pos_registers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  warehouse_id uuid references public.warehouses(id) on delete set null,
  active boolean not null default true,
  notes text check (notes is null or char_length(notes) <= 500),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index pos_registers_tenant_name_uk on public.pos_registers (tenant_id, lower(name));
create index pos_registers_warehouse_idx on public.pos_registers (warehouse_id) where warehouse_id is not null;

create table public.pos_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  number integer,
  doc_number text,
  register_id uuid not null references public.pos_registers(id),
  status text not null default 'open' check (status in ('open', 'closed')),
  opened_by uuid references public.profiles(id) on delete set null,
  opened_at timestamptz not null default now(),
  opening_cash numeric(14, 3) not null default 0 check (opening_cash >= 0),
  closed_by uuid references public.profiles(id) on delete set null,
  closed_at timestamptz,
  closing_cash_counted numeric(14, 3) check (closing_cash_counted is null or closing_cash_counted >= 0),
  expected_cash numeric(14, 3),
  cash_difference numeric(14, 3),
  notes text check (notes is null or char_length(notes) <= 500),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index pos_sessions_tenant_number_uk on public.pos_sessions (tenant_id, number);
create unique index pos_sessions_tenant_doc_number_uk on public.pos_sessions (tenant_id, doc_number);
create unique index pos_sessions_one_open_uk on public.pos_sessions (register_id) where status = 'open';
create index pos_sessions_tenant_opened_idx on public.pos_sessions (tenant_id, opened_at desc);

create table public.pos_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  number integer,
  doc_number text,
  session_id uuid not null references public.pos_sessions(id),
  register_id uuid not null references public.pos_registers(id),
  customer_id uuid references public.customers(id) on delete set null,
  status text not null default 'completed' check (status in ('completed', 'refunded', 'voided')),
  currency text not null,
  currency_decimals smallint not null default 2,
  subtotal numeric(14, 3) not null default 0,
  discount_total numeric(14, 3) not null default 0,
  tax_total numeric(14, 3) not null default 0,
  total numeric(14, 3) not null default 0,
  paid_cash numeric(14, 3) not null default 0,
  paid_card numeric(14, 3) not null default 0,
  paid_other numeric(14, 3) not null default 0,
  change_due numeric(14, 3) not null default 0,
  completed_at timestamptz not null default now(),
  refund_of uuid references public.pos_orders(id),
  notes text check (notes is null or char_length(notes) <= 500),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index pos_orders_tenant_number_uk on public.pos_orders (tenant_id, number);
create unique index pos_orders_tenant_doc_number_uk on public.pos_orders (tenant_id, doc_number);
create index pos_orders_tenant_completed_idx on public.pos_orders (tenant_id, completed_at desc);
create index pos_orders_session_idx on public.pos_orders (session_id);
create index pos_orders_register_idx on public.pos_orders (register_id);
create index pos_orders_customer_idx on public.pos_orders (customer_id) where customer_id is not null;
-- One refund per order.
create unique index pos_orders_refund_of_uk on public.pos_orders (refund_of) where refund_of is not null;

create table public.pos_order_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null references public.pos_orders(id) on delete cascade,
  sort_order integer not null default 0,
  product_id uuid not null references public.products(id),
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  description text not null,
  quantity numeric(14, 3) not null check (quantity <> 0),
  unit_price numeric(14, 4) not null check (unit_price >= 0),
  discount_percent numeric(5, 2) not null default 0 check (discount_percent between 0 and 100),
  tax_rate numeric(5, 2) not null default 0 check (tax_rate between 0 and 100),
  line_gross numeric(14, 3) not null default 0,
  line_discount numeric(14, 3) not null default 0,
  line_net numeric(14, 3) not null default 0,
  line_tax numeric(14, 3) not null default 0,
  line_total numeric(14, 3) not null default 0,
  created_at timestamptz not null default now()
);
create index pos_order_lines_order_idx on public.pos_order_lines (order_id, sort_order);
create index pos_order_lines_product_idx on public.pos_order_lines (product_id);
create index pos_order_lines_item_idx on public.pos_order_lines (inventory_item_id) where inventory_item_id is not null;
create index pos_order_lines_tenant_idx on public.pos_order_lines (tenant_id);

alter table public.pos_registers enable row level security;
alter table public.pos_sessions enable row level security;
alter table public.pos_orders enable row level security;
alter table public.pos_order_lines enable row level security;
revoke all on public.pos_registers, public.pos_sessions, public.pos_orders, public.pos_order_lines from anon;
revoke insert, update on public.pos_registers from authenticated;
grant insert (name, warehouse_id, notes) on public.pos_registers to authenticated;
grant update (name, warehouse_id, active, notes) on public.pos_registers to authenticated;
-- Sessions, orders and lines are written only by the RPCs below.
revoke insert, update, delete on public.pos_sessions, public.pos_orders, public.pos_order_lines from authenticated;

-- ============================================================
-- Triggers
-- ============================================================
create or replace function app.pos_register_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    return old;
  end if;
  new.name := btrim(new.name);
  if tg_op = 'UPDATE' and old.active and not new.active
     and exists (select 1 from public.pos_sessions s where s.register_id = new.id and s.status = 'open') then
    raise exception 'POS_SESSION_OPEN';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function app.pos_register_guard() from public, anon, authenticated;

create trigger pos_registers_guard before insert or update on public.pos_registers
  for each row execute function app.pos_register_guard();
create trigger pos_registers_stamp_actor before insert or update on public.pos_registers
  for each row execute function app.stamp_actor();
create trigger pos_registers_same_tenant before insert or update of warehouse_id on public.pos_registers
  for each row execute function app.assert_same_tenant('warehouse_id', 'warehouses');
create trigger pos_registers_audit after insert or update or delete on public.pos_registers
  for each row execute function app.log_audit();

create trigger pos_sessions_number
  before insert or update of number, doc_number on public.pos_sessions
  for each row execute function app.assign_doc_number('pos_session', 'POSS');
create trigger pos_sessions_stamp_actor before insert or update on public.pos_sessions
  for each row execute function app.stamp_actor();
create trigger pos_sessions_audit after insert or update or delete on public.pos_sessions
  for each row execute function app.log_audit();

create trigger pos_orders_number
  before insert or update of number, doc_number on public.pos_orders
  for each row execute function app.assign_doc_number('pos_order', 'POS');
create trigger pos_orders_stamp_actor before insert or update on public.pos_orders
  for each row execute function app.stamp_actor();
create trigger pos_orders_audit after insert or update or delete on public.pos_orders
  for each row execute function app.log_audit();

-- ============================================================
-- Sessions
-- ============================================================
create or replace function public.pos_open_session(p_register_id uuid, p_opening_cash numeric default 0, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('pos', 'manager');
  v_reg public.pos_registers;
  v_id uuid;
begin
  select * into v_reg from public.pos_registers r where r.id = p_register_id and r.tenant_id = v_tenant for update;
  if v_reg.id is null or not v_reg.active then
    raise exception 'POS_REGISTER_INACTIVE';
  end if;
  if exists (select 1 from public.pos_sessions s where s.register_id = v_reg.id and s.status = 'open') then
    raise exception 'POS_SESSION_OPEN';
  end if;
  if coalesce(p_opening_cash, 0) < 0 then
    raise exception 'POS_LINE_INVALID';
  end if;
  insert into public.pos_sessions (tenant_id, register_id, opened_by, opening_cash, notes)
  values (v_tenant, v_reg.id, auth.uid(), round(coalesce(p_opening_cash, 0), 3), nullif(btrim(coalesce(p_notes, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.pos_open_session(uuid, numeric, text) from public, anon;
grant execute on function public.pos_open_session(uuid, numeric, text) to authenticated;

-- Cash the drawer should hold: the float, plus cash taken, minus change given
-- (refunds carry negative cash).
create or replace function app.pos_expected_cash(p_session_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select s.opening_cash + coalesce((select sum(o.paid_cash - o.change_due) from public.pos_orders o
                                    where o.session_id = s.id and o.status <> 'voided'), 0)
  from public.pos_sessions s where s.id = p_session_id
$$;
revoke execute on function app.pos_expected_cash(uuid) from public, anon, authenticated;

create or replace function public.pos_close_session(p_session_id uuid, p_counted_cash numeric, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('pos', 'manager');
  v_sess public.pos_sessions;
  v_expected numeric;
begin
  select * into v_sess from public.pos_sessions s where s.id = p_session_id and s.tenant_id = v_tenant for update;
  if v_sess.id is null or v_sess.status <> 'open' then
    raise exception 'POS_SESSION_CLOSED';
  end if;
  if p_counted_cash is null or p_counted_cash < 0 then
    raise exception 'POS_LINE_INVALID';
  end if;
  v_expected := app.pos_expected_cash(v_sess.id);
  update public.pos_sessions
     set status = 'closed', closed_at = now(), closed_by = auth.uid(),
         closing_cash_counted = round(p_counted_cash, 3), expected_cash = v_expected,
         cash_difference = round(p_counted_cash, 3) - v_expected,
         notes = coalesce(nullif(btrim(coalesce(p_notes, '')), ''), notes), updated_at = now()
   where id = v_sess.id;
  return v_sess.id;
end;
$$;
revoke execute on function public.pos_close_session(uuid, numeric, text) from public, anon;
grant execute on function public.pos_close_session(uuid, numeric, text) to authenticated;

-- ============================================================
-- Checkout and refund
-- ============================================================
-- p_lines: [{product_id, quantity, discount_percent?, unit_price?}] (unit
-- price defaults to the catalog price); p_payments: {cash, card, other}.
create or replace function public.pos_checkout(p_session_id uuid, p_lines jsonb, p_payments jsonb,
                                               p_customer_id uuid default null, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('pos', 'manager');
  v_sess public.pos_sessions;
  v_reg public.pos_registers;
  v_cur text;
  v_dec integer;
  v_order uuid;
  v_doc text;
  v_prod public.products;
  v_item uuid;
  l jsonb;
  i integer := 0;
  v_qty numeric;
  v_price numeric;
  v_disc_pct numeric;
  v_gross numeric;
  v_disc numeric;
  v_net numeric;
  v_tax numeric;
  v_subtotal numeric := 0;
  v_disc_total numeric := 0;
  v_tax_total numeric := 0;
  v_total numeric;
  v_cash numeric;
  v_card numeric;
  v_other numeric;
  v_change numeric;
  v_stock boolean;
begin
  select * into v_sess from public.pos_sessions s where s.id = p_session_id and s.tenant_id = v_tenant;
  if v_sess.id is null or v_sess.status <> 'open' then
    raise exception 'POS_SESSION_CLOSED';
  end if;
  select * into v_reg from public.pos_registers r where r.id = v_sess.register_id;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'POS_EMPTY_CART';
  end if;
  if jsonb_array_length(p_lines) > 200 then
    raise exception 'POS_LINE_INVALID';
  end if;
  if p_customer_id is not null and not exists (select 1 from public.customers c where c.id = p_customer_id and c.tenant_id = v_tenant) then
    raise exception 'CROSS_TENANT_REFERENCE: customer_id';
  end if;
  select t.currency, coalesce(t.currency_decimals, 2) into v_cur, v_dec from public.tenants t where t.id = v_tenant;
  v_stock := v_reg.warehouse_id is not null and app.tenant_module_enabled(v_tenant, 'inventory');

  insert into public.pos_orders (tenant_id, session_id, register_id, customer_id, currency, currency_decimals, notes)
  values (v_tenant, v_sess.id, v_reg.id, p_customer_id, v_cur, v_dec, nullif(btrim(coalesce(p_notes, '')), ''))
  returning id, doc_number into v_order, v_doc;

  for l in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    begin
      v_qty := round((l->>'quantity')::numeric, 3);
      v_disc_pct := coalesce((l->>'discount_percent')::numeric, 0);
      v_price := (l->>'unit_price')::numeric;
    exception when others then
      raise exception 'POS_LINE_INVALID';
    end;
    if v_qty is null or v_qty <= 0 or v_disc_pct < 0 or v_disc_pct > 100 or (v_price is not null and v_price < 0) then
      raise exception 'POS_LINE_INVALID';
    end if;
    select * into v_prod from public.products p
    where p.id = nullif(l->>'product_id', '')::uuid and p.tenant_id = v_tenant and p.active;
    if v_prod.id is null then
      raise exception 'POS_PRODUCT_INVALID';
    end if;
    v_price := round(coalesce(v_price, v_prod.unit_price), 4);
    -- Same arithmetic as app.compute_line_amounts on sales documents.
    v_gross := round(v_qty * v_price, v_dec);
    v_disc := round(v_gross * v_disc_pct / 100, v_dec);
    v_net := v_gross - v_disc;
    v_tax := round(v_net * coalesce(v_prod.tax_rate, 0) / 100, v_dec);
    v_item := null;
    if v_stock then
      select it.id into v_item from public.inventory_items it
      where it.tenant_id = v_tenant and it.product_id = v_prod.id and it.active and it.track_stock
      order by it.created_at limit 1;
    end if;
    insert into public.pos_order_lines (tenant_id, order_id, sort_order, product_id, inventory_item_id, description, quantity,
                                        unit_price, discount_percent, tax_rate, line_gross, line_discount, line_net, line_tax, line_total)
    values (v_tenant, v_order, i, v_prod.id, v_item, v_prod.name, v_qty, v_price, v_disc_pct, coalesce(v_prod.tax_rate, 0),
            v_gross, v_disc, v_net, v_tax, v_net + v_tax);
    if v_item is not null then
      perform app.post_stock_move(v_tenant, v_item, v_reg.warehouse_id, 'sale', -v_qty, null, 'pos_order', v_order, v_doc);
    end if;
    v_subtotal := v_subtotal + v_gross;
    v_disc_total := v_disc_total + v_disc;
    v_tax_total := v_tax_total + v_tax;
  end loop;
  v_total := v_subtotal - v_disc_total + v_tax_total;

  begin
    v_cash := round(coalesce((p_payments->>'cash')::numeric, 0), v_dec);
    v_card := round(coalesce((p_payments->>'card')::numeric, 0), v_dec);
    v_other := round(coalesce((p_payments->>'other')::numeric, 0), v_dec);
  exception when others then
    raise exception 'POS_LINE_INVALID';
  end;
  if v_cash < 0 or v_card < 0 or v_other < 0 then
    raise exception 'POS_LINE_INVALID';
  end if;
  if v_cash + v_card + v_other < v_total then
    raise exception 'POS_UNDERPAID';
  end if;
  v_change := v_cash + v_card + v_other - v_total;
  -- Change comes out of the drawer, so it can't exceed the cash tendered.
  if v_change > v_cash then
    raise exception 'POS_CHANGE_FROM_CARD';
  end if;

  update public.pos_orders
     set subtotal = v_subtotal, discount_total = v_disc_total, tax_total = v_tax_total, total = v_total,
         paid_cash = v_cash, paid_card = v_card, paid_other = v_other, change_due = v_change
   where id = v_order;
  return jsonb_build_object('order_id', v_order, 'doc_number', v_doc, 'total', v_total, 'change_due', v_change);
end;
$$;
revoke execute on function public.pos_checkout(uuid, jsonb, jsonb, uuid, text) from public, anon;
grant execute on function public.pos_checkout(uuid, jsonb, jsonb, uuid, text) to authenticated;

-- Refunds the whole order from an open session on the same register; the
-- tender is returned the way it was taken.
create or replace function public.pos_refund(p_order_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('pos', 'manager');
  v_ord public.pos_orders;
  v_sess uuid;
  v_wh uuid;
  v_new uuid;
  v_doc text;
  r record;
begin
  select * into v_ord from public.pos_orders o where o.id = p_order_id and o.tenant_id = v_tenant for update;
  if v_ord.id is null or v_ord.status <> 'completed' or v_ord.refund_of is not null then
    raise exception 'POS_NOT_REFUNDABLE';
  end if;
  select s.id into v_sess from public.pos_sessions s where s.register_id = v_ord.register_id and s.status = 'open';
  if v_sess is null then
    raise exception 'POS_NO_OPEN_SESSION';
  end if;
  select r2.warehouse_id into v_wh from public.pos_registers r2 where r2.id = v_ord.register_id;

  insert into public.pos_orders (tenant_id, session_id, register_id, customer_id, currency, currency_decimals, subtotal,
                                 discount_total, tax_total, total, paid_cash, paid_card, paid_other, change_due, refund_of, notes)
  values (v_tenant, v_sess, v_ord.register_id, v_ord.customer_id, v_ord.currency, v_ord.currency_decimals, -v_ord.subtotal,
          -v_ord.discount_total, -v_ord.tax_total, -v_ord.total,
          -(v_ord.paid_cash - v_ord.change_due), -v_ord.paid_card, -v_ord.paid_other, 0, v_ord.id,
          left(nullif(btrim(coalesce(p_reason, '')), ''), 500))
  returning id, doc_number into v_new, v_doc;

  for r in select * from public.pos_order_lines l where l.order_id = v_ord.id order by l.sort_order loop
    insert into public.pos_order_lines (tenant_id, order_id, sort_order, product_id, inventory_item_id, description, quantity,
                                        unit_price, discount_percent, tax_rate, line_gross, line_discount, line_net, line_tax, line_total)
    values (v_tenant, v_new, r.sort_order, r.product_id, r.inventory_item_id, r.description, -r.quantity, r.unit_price,
            r.discount_percent, r.tax_rate, -r.line_gross, -r.line_discount, -r.line_net, -r.line_tax, -r.line_total);
    -- Stock goes back to the warehouse it was sold from (the sale move's).
    if r.inventory_item_id is not null then
      select m.warehouse_id into v_wh from public.stock_moves m
      where m.reference_type = 'pos_order' and m.reference_id = v_ord.id and m.item_id = r.inventory_item_id
      order by m.moved_at limit 1;
      if v_wh is not null then
        perform app.post_stock_move(v_tenant, r.inventory_item_id, v_wh, 'return', r.quantity, null, 'pos_order', v_new, v_doc);
      end if;
    end if;
  end loop;

  update public.pos_orders set status = 'refunded', updated_at = now() where id = v_ord.id;
  return jsonb_build_object('order_id', v_new, 'doc_number', v_doc, 'total', -v_ord.total);
end;
$$;
revoke execute on function public.pos_refund(uuid, text) from public, anon;
grant execute on function public.pos_refund(uuid, text) to authenticated;

-- ============================================================
-- Reports (invoker: RLS decides what is read)
-- ============================================================
create or replace function public.pos_session_summary(p_session_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'sales_count', count(*) filter (where o.refund_of is null),
    'refund_count', count(*) filter (where o.refund_of is not null),
    'gross_sales', coalesce(sum(o.total) filter (where o.refund_of is null), 0),
    'refunds', coalesce(-sum(o.total) filter (where o.refund_of is not null), 0),
    'net_sales', coalesce(sum(o.total), 0),
    'tax', coalesce(sum(o.tax_total), 0),
    'discounts', coalesce(sum(o.discount_total), 0),
    'cash', coalesce(sum(o.paid_cash - o.change_due), 0),
    'card', coalesce(sum(o.paid_card), 0),
    'other', coalesce(sum(o.paid_other), 0),
    'expected_cash', (select s.opening_cash from public.pos_sessions s where s.id = p_session_id)
                     + coalesce(sum(o.paid_cash - o.change_due), 0)
  )
  from public.pos_orders o
  where o.session_id = p_session_id and o.status <> 'voided'
$$;
revoke execute on function public.pos_session_summary(uuid) from public, anon;
grant execute on function public.pos_session_summary(uuid) to authenticated;

-- Net sales per day in the tenant's time zone (refunds count on their day).
create or replace function public.pos_daily_sales(p_from date, p_to date)
returns table (day date, orders bigint, total numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select (o.completed_at at time zone coalesce(t.timezone, 'UTC'))::date as day,
         count(*) filter (where o.refund_of is null) as orders,
         sum(o.total) as total
  from public.pos_orders o
  join public.tenants t on t.id = o.tenant_id
  where o.status <> 'voided'
    and (o.completed_at at time zone coalesce(t.timezone, 'UTC'))::date between p_from and p_to
  group by 1
  order by 1
$$;
revoke execute on function public.pos_daily_sales(date, date) from public, anon;
grant execute on function public.pos_daily_sales(date, date) to authenticated;

-- ============================================================
-- RLS: members read; managers write registers. Sessions, orders and lines
-- have no write policies: only the definer RPCs write them.
-- ============================================================
set local lock_timeout = '1s';
do $$
declare
  t text;
begin
  foreach t in array array['pos_registers', 'pos_sessions', 'pos_orders', 'pos_order_lines'] loop
    execute format('create policy %1$s_select on public.%1$I for select to authenticated
      using (tenant_id = (select app.tenant_id()) and (select app.module_enabled(''pos'')))', t);
  end loop;
end;
$$;
create policy pos_registers_insert on public.pos_registers for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager()) and (select app.module_enabled('pos')));
create policy pos_registers_update on public.pos_registers for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager()) and (select app.module_enabled('pos')))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager()) and (select app.module_enabled('pos')));
create policy pos_registers_delete on public.pos_registers for delete to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager()) and (select app.module_enabled('pos')));
