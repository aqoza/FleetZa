-- Purchasing (module purchasing): purchase orders, goods receipts, vendor
-- bills and vendor payments.
--
-- 1) purchase_orders (PO) + purchase_order_lines. Status:
--    draft -> sent -> confirmed -> partially_received -> received -> closed;
--    draft|sent -> confirmed; sent -> draft; draft|sent|confirmed -> canceled;
--    partially_received -> closed (short-close). The two receiving statuses
--    are set only by purchase_receive. Lines are editable in draft only;
--    line math, roll-up, currency snapshot and the draft-only guards reuse
--    the sales document functions (app.compute_line_amounts & co.).
-- 2) purchase_receipts (GRN) + purchase_receipt_lines, written only by
--    purchase_receive(po, lines, warehouse, notes): bumps received_qty, sets
--    the PO's receiving status and, when inventory is enabled, posts a stock
--    receipt (unit cost = the line's net unit cost) for lines with a tracked
--    item.
-- 3) vendor_bills (BILL) + vendor_bill_lines + vendor_payments. Status:
--    draft -> open -> partially_paid -> paid (payments drive the settled
--    statuses); draft -> void; open -> void while nothing is paid.
--    vendor_bill_from_po(po) drafts a bill for what is received (or ordered,
--    when nothing is received yet) and not billed yet.
-- 4) Scanner app.scan_due_purchasing: bills due within 3 days / overdue and
--    POs past their expected date -> managers.
--    Events: purchase_order.sent, purchase_order.received, vendor_bill.paid.
--
-- Raised codes: ILLEGAL_PO_TRANSITION, PO_NOT_FOUND, PO_NOT_RECEIVABLE,
-- PO_WAREHOUSE_REQUIRED, RECEIPT_EMPTY, RECEIPT_EXCEEDS_ORDERED,
-- PO_NOT_BILLABLE, NOTHING_TO_BILL, ILLEGAL_BILL_TRANSITION, BILL_HAS_PAYMENTS,
-- BILL_NOT_PAYABLE, BILL_OVERPAYMENT, BILL_PO_MISMATCH (+ the existing
-- DOC_NOT_EDITABLE, DOC_LOCKED, DOC_NOT_DELETABLE, EMPTY_DOCUMENT,
-- WAREHOUSE_NOT_FOUND, FORBIDDEN, MODULE_DISABLED, CROSS_TENANT_REFERENCE).
-- Additive only.

set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- ============================================================
-- 1) Purchase orders
-- ============================================================
create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  number integer,
  doc_number text,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'confirmed', 'partially_received', 'received', 'closed', 'canceled')),
  order_date date not null default current_date,
  expected_date date,
  currency text not null,
  currency_decimals smallint not null,
  subtotal numeric(14, 4) not null default 0,
  discount_total numeric(14, 4) not null default 0,
  tax_total numeric(14, 4) not null default 0,
  total numeric(14, 4) not null default 0,
  supplier_reference text check (supplier_reference is null or char_length(supplier_reference) <= 100),
  terms text check (terms is null or char_length(terms) <= 4000),
  notes text check (notes is null or char_length(notes) <= 4000),
  sent_at timestamptz,
  confirmed_at timestamptz,
  received_at timestamptz,
  closed_at timestamptz,
  canceled_at timestamptz,
  -- Filled from the vendor portal (module vendor_portal).
  vendor_ack_at timestamptz,
  vendor_ack_note text check (vendor_ack_note is null or char_length(vendor_ack_note) <= 2000),
  vendor_expected_date date,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index purchase_orders_tenant_number_uk on public.purchase_orders (tenant_id, number);
create unique index purchase_orders_tenant_doc_number_uk on public.purchase_orders (tenant_id, doc_number);
create index purchase_orders_tenant_status_idx on public.purchase_orders (tenant_id, status, order_date desc);
create index purchase_orders_supplier_idx on public.purchase_orders (supplier_id, order_date desc);
create index purchase_orders_warehouse_idx on public.purchase_orders (warehouse_id);
create index purchase_orders_expected_idx on public.purchase_orders (tenant_id, expected_date)
  where status in ('sent', 'confirmed', 'partially_received');
alter table public.purchase_orders enable row level security;
revoke all on public.purchase_orders from anon;
-- Totals, timestamps and the portal fields are derived or system-written.
revoke insert, update on public.purchase_orders from authenticated;
grant insert (supplier_id, warehouse_id, order_date, expected_date, supplier_reference, terms, notes)
  on public.purchase_orders to authenticated;
grant update (supplier_id, warehouse_id, status, order_date, expected_date, supplier_reference, terms, notes)
  on public.purchase_orders to authenticated;

create table public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  sort_order integer not null default 0,
  item_id uuid references public.inventory_items(id) on delete set null,
  description text not null check (char_length(btrim(description)) between 1 and 500),
  quantity numeric(14, 3) not null default 1 check (quantity > 0),
  unit text check (unit is null or char_length(unit) <= 30),
  -- The unit cost; named unit_price so the shared document math applies.
  unit_price numeric(14, 4) not null default 0 check (unit_price >= 0),
  discount_percent numeric(5, 2) not null default 0 check (discount_percent between 0 and 100),
  tax_rate numeric(5, 2) not null default 0 check (tax_rate between 0 and 100),
  line_gross numeric(14, 4) not null default 0,
  line_discount numeric(14, 4) not null default 0,
  line_net numeric(14, 4) not null default 0,
  line_tax numeric(14, 4) not null default 0,
  line_total numeric(14, 4) not null default 0,
  received_qty numeric(14, 3) not null default 0,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (received_qty >= 0 and received_qty <= quantity)
);
create index purchase_order_lines_po_idx on public.purchase_order_lines (purchase_order_id, sort_order);
create index purchase_order_lines_item_idx on public.purchase_order_lines (item_id);
alter table public.purchase_order_lines enable row level security;
revoke all on public.purchase_order_lines from anon;
revoke insert, update on public.purchase_order_lines from authenticated;
grant insert (purchase_order_id, sort_order, item_id, description, quantity, unit, unit_price, discount_percent, tax_rate)
  on public.purchase_order_lines to authenticated;
grant update (sort_order, item_id, description, quantity, unit, unit_price, discount_percent, tax_rate)
  on public.purchase_order_lines to authenticated;

-- Lifecycle, timestamps and locking in one place.
create or replace function app.purchase_order_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_receiving boolean := coalesce(current_setting('app.purchase_receiving', true), '') = 'on';
  v_lock text[] := array['status', 'updated_at', 'updated_by', 'closed_at', 'notes'];
begin
  if new.status is distinct from old.status then
    if not (
      (old.status = 'draft'              and new.status in ('sent', 'confirmed', 'canceled')) or
      (old.status = 'sent'               and new.status in ('draft', 'confirmed', 'canceled')) or
      (old.status = 'confirmed'          and new.status = 'canceled') or
      (old.status in ('confirmed', 'partially_received') and new.status in ('partially_received', 'received')
                                          and v_receiving) or
      (old.status = 'partially_received' and new.status = 'closed') or
      (old.status = 'received'           and new.status = 'closed')
    ) then
      raise exception 'ILLEGAL_PO_TRANSITION: % -> %', old.status, new.status;
    end if;
    case new.status
      when 'sent' then new.sent_at := coalesce(new.sent_at, now());
      when 'confirmed' then new.confirmed_at := coalesce(new.confirmed_at, now());
      when 'received' then new.received_at := now();
      when 'closed' then new.closed_at := now();
      when 'canceled' then new.canceled_at := now();
      else null;
    end case;
    if new.status = 'draft' then
      new.sent_at := null;
    end if;
  end if;

  if old.status in ('received', 'closed', 'canceled') then
    if (to_jsonb(new) - v_lock - 'received_at' - 'canceled_at')
       is distinct from (to_jsonb(old) - v_lock - 'received_at' - 'canceled_at') then
      raise exception 'DOC_LOCKED';
    end if;
  elsif old.status <> 'draft'
        and (new.supplier_id, new.currency, new.currency_decimals)
            is distinct from (old.supplier_id, old.currency, old.currency_decimals) then
    raise exception 'DOC_LOCKED';
  end if;
  return new;
end;
$$;
revoke execute on function app.purchase_order_guard() from public, anon, authenticated;

-- Lines change only while the PO is a draft, except received_qty, which
-- purchase_receive maintains on a confirmed PO.
create or replace function app.purchase_order_line_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
  v_po uuid := case when tg_op = 'DELETE' then old.purchase_order_id else new.purchase_order_id end;
  v_meta text[] := array['received_qty', 'updated_at', 'updated_by'];
begin
  select po.status into v_status from public.purchase_orders po where po.id = v_po;
  if tg_op = 'UPDATE' and new.purchase_order_id is distinct from old.purchase_order_id then
    raise exception 'DOC_NOT_EDITABLE';
  end if;
  if v_status is not null and v_status <> 'draft' then
    if not (tg_op = 'UPDATE'
            and coalesce(current_setting('app.purchase_receiving', true), '') = 'on'
            and (to_jsonb(new) - v_meta) is not distinct from (to_jsonb(old) - v_meta)) then
      raise exception 'DOC_NOT_EDITABLE';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke execute on function app.purchase_order_line_guard() from public, anon, authenticated;

create or replace function app.trg_purchase_order_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_supplier text;
begin
  if new.status is not distinct from old.status or new.status not in ('sent', 'received') then
    return null;
  end if;
  begin
    select s.name into v_supplier from public.suppliers s where s.id = new.supplier_id;
    perform app.emit_event(new.tenant_id, 'purchase_order.' || new.status, 'purchase_order', new.id,
      jsonb_build_object('id', new.id, 'doc_number', new.doc_number, 'supplier_id', new.supplier_id,
                         'supplier', v_supplier, 'order_date', new.order_date,
                         'expected_date', new.expected_date, 'total', new.total, 'currency', new.currency));
  exception when others then
    raise warning 'purchase_order events: % (%)', sqlerrm, sqlstate;
  end;
  return null;
end;
$$;
revoke execute on function app.trg_purchase_order_events() from public, anon, authenticated;

-- The client may not write totals (column grants), so the line roll-up runs
-- as definer; otherwise it is app.recompute_doc_totals.
create or replace function app.recompute_purchasing_totals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new uuid;
  v_old uuid;
begin
  if tg_op <> 'DELETE' then
    v_new := (to_jsonb(new) ->> tg_argv[2])::uuid;
  end if;
  if tg_op <> 'INSERT' then
    v_old := (to_jsonb(old) ->> tg_argv[2])::uuid;
  end if;
  perform app.apply_doc_totals(tg_argv[0], tg_argv[1], tg_argv[2], v_new);
  if v_old is distinct from v_new then
    perform app.apply_doc_totals(tg_argv[0], tg_argv[1], tg_argv[2], v_old);
  end if;
  return null;
end;
$$;
revoke execute on function app.recompute_purchasing_totals() from public, anon, authenticated;

create trigger a_purchase_orders_currency before insert on public.purchase_orders
  for each row execute function app.stamp_doc_currency();
create trigger b_purchase_orders_number
  before insert or update of number, doc_number on public.purchase_orders
  for each row execute function app.assign_doc_number('purchase_order', 'PO');
create trigger purchase_orders_updated_at before update on public.purchase_orders
  for each row execute function app.set_updated_at();
create trigger purchase_orders_stamp_actor before insert or update on public.purchase_orders
  for each row execute function app.stamp_actor();
create trigger purchase_orders_audit after insert or update or delete on public.purchase_orders
  for each row execute function app.log_audit();
create trigger purchase_orders_same_tenant
  before insert or update of supplier_id, warehouse_id on public.purchase_orders
  for each row execute function app.assert_same_tenant('supplier_id', 'suppliers', 'warehouse_id', 'warehouses');
create trigger purchase_orders_guard before update on public.purchase_orders
  for each row execute function app.purchase_order_guard();
create trigger purchase_orders_not_empty before update of status on public.purchase_orders
  for each row execute function app.guard_doc_not_empty('purchase_order_lines', 'purchase_order_id');
create trigger purchase_orders_deletable before delete on public.purchase_orders
  for each row execute function app.guard_doc_deletable('draft,canceled');
create trigger purchase_orders_events after update of status on public.purchase_orders
  for each row execute function app.trg_purchase_order_events();

create trigger purchase_order_lines_guard before insert or update or delete on public.purchase_order_lines
  for each row execute function app.purchase_order_line_guard();
create trigger purchase_order_lines_amounts before insert or update on public.purchase_order_lines
  for each row execute function app.compute_line_amounts('purchase_orders', 'purchase_order_id');
create trigger purchase_order_lines_totals after insert or update or delete on public.purchase_order_lines
  for each row execute function app.recompute_purchasing_totals('purchase_orders', 'purchase_order_lines', 'purchase_order_id');
create trigger purchase_order_lines_updated_at before update on public.purchase_order_lines
  for each row execute function app.set_updated_at();
create trigger purchase_order_lines_stamp_actor before insert or update on public.purchase_order_lines
  for each row execute function app.stamp_actor();
create trigger purchase_order_lines_same_tenant
  before insert or update of purchase_order_id, item_id on public.purchase_order_lines
  for each row execute function app.assert_same_tenant(
    'purchase_order_id', 'purchase_orders', 'item_id', 'inventory_items');

-- ============================================================
-- 2) Goods receipts
-- ============================================================
create table public.purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  number integer,
  doc_number text,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  received_at timestamptz not null default now(),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_by uuid,
  created_at timestamptz not null default now()
);
create unique index purchase_receipts_tenant_number_uk on public.purchase_receipts (tenant_id, number);
create unique index purchase_receipts_tenant_doc_number_uk on public.purchase_receipts (tenant_id, doc_number);
create index purchase_receipts_po_idx on public.purchase_receipts (purchase_order_id, received_at desc);
create index purchase_receipts_tenant_idx on public.purchase_receipts (tenant_id, received_at desc);
create index purchase_receipts_supplier_idx on public.purchase_receipts (supplier_id);
create index purchase_receipts_warehouse_idx on public.purchase_receipts (warehouse_id);
alter table public.purchase_receipts enable row level security;
revoke all on public.purchase_receipts from anon;
revoke insert, update, delete, truncate on public.purchase_receipts from authenticated;

create table public.purchase_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  receipt_id uuid not null references public.purchase_receipts(id) on delete cascade,
  purchase_order_line_id uuid not null references public.purchase_order_lines(id) on delete restrict,
  item_id uuid references public.inventory_items(id) on delete set null,
  description text not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_cost numeric(14, 4) not null default 0,
  stock_move_id uuid references public.stock_moves(id) on delete set null
);
create index purchase_receipt_lines_receipt_idx on public.purchase_receipt_lines (receipt_id);
create index purchase_receipt_lines_po_line_idx on public.purchase_receipt_lines (purchase_order_line_id);
create index purchase_receipt_lines_item_idx on public.purchase_receipt_lines (item_id);
create index purchase_receipt_lines_move_idx on public.purchase_receipt_lines (stock_move_id);
create index purchase_receipt_lines_tenant_idx on public.purchase_receipt_lines (tenant_id);
alter table public.purchase_receipt_lines enable row level security;
revoke all on public.purchase_receipt_lines from anon;
revoke insert, update, delete, truncate on public.purchase_receipt_lines from authenticated;

create trigger purchase_receipts_number
  before insert or update of number, doc_number on public.purchase_receipts
  for each row execute function app.assign_doc_number('purchase_receipt', 'GRN');
create trigger purchase_receipts_audit after insert or update or delete on public.purchase_receipts
  for each row execute function app.log_audit();

-- p_lines: [{line_id, quantity}]. Quantities for the same line add up.
create or replace function public.purchase_receive(
  p_po uuid,
  p_lines jsonb,
  p_warehouse uuid default null,
  p_notes text default null
)
returns public.purchase_receipts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('purchasing', 'manager');
  v_po public.purchase_orders;
  v_receipt public.purchase_receipts;
  v_inventory boolean;
  v_warehouse uuid;
  v_move uuid;
  r record;
begin
  select * into v_po from public.purchase_orders po
  where po.id = p_po and po.tenant_id = v_tenant for update;
  if not found then
    raise exception 'PO_NOT_FOUND';
  end if;
  if v_po.status not in ('confirmed', 'partially_received') then
    raise exception 'PO_NOT_RECEIVABLE';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'RECEIPT_EMPTY';
  end if;

  create temp table if not exists pg_temp._po_receive (line_id uuid primary key, qty numeric) on commit drop;
  truncate pg_temp._po_receive;
  insert into pg_temp._po_receive (line_id, qty)
  select (x ->> 'line_id')::uuid, sum((x ->> 'quantity')::numeric)
  from jsonb_array_elements(p_lines) x
  where nullif(x ->> 'quantity', '') is not null and (x ->> 'quantity')::numeric <> 0
  group by 1;
  if not exists (select 1 from pg_temp._po_receive) then
    raise exception 'RECEIPT_EMPTY';
  end if;
  if exists (select 1 from pg_temp._po_receive x where x.qty < 0) then
    raise exception 'INVALID_QUANTITY';
  end if;
  if exists (
    select 1 from pg_temp._po_receive x
    left join public.purchase_order_lines l on l.id = x.line_id and l.purchase_order_id = p_po
    where l.id is null or x.qty > l.quantity - l.received_qty
  ) then
    raise exception 'RECEIPT_EXCEEDS_ORDERED';
  end if;

  v_inventory := app.tenant_module_enabled(v_tenant, 'inventory');
  v_warehouse := coalesce(p_warehouse, v_po.warehouse_id);
  if v_warehouse is not null
     and not exists (select 1 from public.warehouses w where w.id = v_warehouse and w.tenant_id = v_tenant) then
    raise exception 'WAREHOUSE_NOT_FOUND';
  end if;
  if v_inventory and v_warehouse is null and exists (
    select 1 from pg_temp._po_receive x
    join public.purchase_order_lines l on l.id = x.line_id
    join public.inventory_items i on i.id = l.item_id
    where i.track_stock
  ) then
    raise exception 'PO_WAREHOUSE_REQUIRED';
  end if;

  insert into public.purchase_receipts (tenant_id, purchase_order_id, supplier_id, warehouse_id, notes, created_by)
  values (v_tenant, p_po, v_po.supplier_id, v_warehouse, nullif(btrim(coalesce(p_notes, '')), ''), auth.uid())
  returning * into v_receipt;

  perform set_config('app.purchase_receiving', 'on', true);
  for r in
    select l.id, l.item_id, l.description, x.qty,
           round(l.line_net / l.quantity, 4) as unit_cost,
           coalesce(i.track_stock, false) as tracked
    from pg_temp._po_receive x
    join public.purchase_order_lines l on l.id = x.line_id
    left join public.inventory_items i on i.id = l.item_id
    order by l.sort_order, l.id
  loop
    v_move := null;
    if v_inventory and r.tracked then
      v_move := app.post_stock_move(v_tenant, r.item_id, v_warehouse, 'receipt', r.qty, r.unit_cost,
                                    'purchase_receipt', v_receipt.id, v_receipt.doc_number);
    end if;
    insert into public.purchase_receipt_lines (tenant_id, receipt_id, purchase_order_line_id, item_id,
                                               description, quantity, unit_cost, stock_move_id)
    values (v_tenant, v_receipt.id, r.id, r.item_id, r.description, r.qty, r.unit_cost, v_move);
    update public.purchase_order_lines set received_qty = received_qty + r.qty where id = r.id;
  end loop;

  update public.purchase_orders po
     set status = case
                    when not exists (select 1 from public.purchase_order_lines l
                                     where l.purchase_order_id = p_po and l.received_qty < l.quantity)
                    then 'received' else 'partially_received' end
   where po.id = p_po;
  perform set_config('app.purchase_receiving', 'off', true);
  return v_receipt;
end;
$$;
revoke execute on function public.purchase_receive(uuid, jsonb, uuid, text) from public, anon;
grant execute on function public.purchase_receive(uuid, jsonb, uuid, text) to authenticated;

-- ============================================================
-- 3) Vendor bills and payments
-- ============================================================
create table public.vendor_bills (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  number integer,
  doc_number text,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  supplier_invoice_number text check (supplier_invoice_number is null or char_length(supplier_invoice_number) <= 100),
  status text not null default 'draft'
    check (status in ('draft', 'open', 'partially_paid', 'paid', 'void')),
  bill_date date not null default current_date,
  due_date date,
  currency text not null,
  currency_decimals smallint not null,
  subtotal numeric(14, 4) not null default 0,
  discount_total numeric(14, 4) not null default 0,
  tax_total numeric(14, 4) not null default 0,
  total numeric(14, 4) not null default 0,
  amount_paid numeric(14, 4) not null default 0,
  notes text check (notes is null or char_length(notes) <= 4000),
  opened_at timestamptz,
  voided_at timestamptz,
  void_reason text check (void_reason is null or char_length(void_reason) <= 500),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_date is null or due_date >= bill_date)
);
create unique index vendor_bills_tenant_number_uk on public.vendor_bills (tenant_id, number);
create unique index vendor_bills_tenant_doc_number_uk on public.vendor_bills (tenant_id, doc_number);
create index vendor_bills_tenant_status_idx on public.vendor_bills (tenant_id, status, bill_date desc);
create index vendor_bills_tenant_due_idx on public.vendor_bills (tenant_id, due_date)
  where status in ('open', 'partially_paid');
create index vendor_bills_supplier_idx on public.vendor_bills (supplier_id, bill_date desc);
create index vendor_bills_po_idx on public.vendor_bills (purchase_order_id);
alter table public.vendor_bills enable row level security;
revoke all on public.vendor_bills from anon;
revoke insert, update on public.vendor_bills from authenticated;
grant insert (supplier_id, purchase_order_id, supplier_invoice_number, bill_date, due_date, notes)
  on public.vendor_bills to authenticated;
grant update (supplier_id, purchase_order_id, supplier_invoice_number, status, bill_date, due_date, notes, void_reason)
  on public.vendor_bills to authenticated;

create table public.vendor_bill_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  vendor_bill_id uuid not null references public.vendor_bills(id) on delete cascade,
  sort_order integer not null default 0,
  item_id uuid references public.inventory_items(id) on delete set null,
  purchase_order_line_id uuid references public.purchase_order_lines(id) on delete set null,
  description text not null check (char_length(btrim(description)) between 1 and 500),
  quantity numeric(14, 3) not null default 1 check (quantity > 0),
  unit text check (unit is null or char_length(unit) <= 30),
  unit_price numeric(14, 4) not null default 0 check (unit_price >= 0),
  discount_percent numeric(5, 2) not null default 0 check (discount_percent between 0 and 100),
  tax_rate numeric(5, 2) not null default 0 check (tax_rate between 0 and 100),
  line_gross numeric(14, 4) not null default 0,
  line_discount numeric(14, 4) not null default 0,
  line_net numeric(14, 4) not null default 0,
  line_tax numeric(14, 4) not null default 0,
  line_total numeric(14, 4) not null default 0,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index vendor_bill_lines_bill_idx on public.vendor_bill_lines (vendor_bill_id, sort_order);
create index vendor_bill_lines_item_idx on public.vendor_bill_lines (item_id);
create index vendor_bill_lines_po_line_idx on public.vendor_bill_lines (purchase_order_line_id);
alter table public.vendor_bill_lines enable row level security;
revoke all on public.vendor_bill_lines from anon;
revoke insert, update on public.vendor_bill_lines from authenticated;
grant insert (vendor_bill_id, sort_order, item_id, purchase_order_line_id, description, quantity, unit, unit_price,
              discount_percent, tax_rate) on public.vendor_bill_lines to authenticated;
grant update (sort_order, item_id, description, quantity, unit, unit_price, discount_percent, tax_rate)
  on public.vendor_bill_lines to authenticated;

create table public.vendor_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  vendor_bill_id uuid not null references public.vendor_bills(id) on delete cascade,
  paid_at date not null default current_date,
  amount numeric(14, 4) not null check (amount > 0),
  method text not null default 'bank_transfer'
    check (method in ('cash', 'bank_transfer', 'card', 'cheque', 'online', 'other')),
  reference text check (reference is null or char_length(reference) <= 200),
  notes text check (notes is null or char_length(notes) <= 1000),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index vendor_payments_bill_idx on public.vendor_payments (vendor_bill_id, paid_at);
create index vendor_payments_tenant_paid_idx on public.vendor_payments (tenant_id, paid_at desc);
alter table public.vendor_payments enable row level security;
revoke all on public.vendor_payments from anon;

-- Due date from the supplier's payment terms; the bill's PO must be the same supplier's.
create or replace function app.vendor_bill_defaults()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_terms integer;
begin
  if new.purchase_order_id is not null and not exists (
    select 1 from public.purchase_orders po
    where po.id = new.purchase_order_id and po.supplier_id = new.supplier_id
  ) then
    raise exception 'BILL_PO_MISMATCH';
  end if;
  if tg_op = 'INSERT' and new.due_date is null then
    select s.payment_terms_days into v_terms from public.suppliers s where s.id = new.supplier_id;
    new.due_date := new.bill_date + coalesce(v_terms, 30);
  end if;
  return new;
end;
$$;
revoke execute on function app.vendor_bill_defaults() from public, anon, authenticated;

-- draft -> open | void; open -> void while unpaid. The settled statuses
-- (open / partially_paid / paid) are moved only by the payment roll-up.
create or replace function app.vendor_bill_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_settled constant text[] := array['open', 'partially_paid', 'paid'];
  v_lock text[] := array['status', 'amount_paid', 'notes', 'updated_at', 'updated_by', 'opened_at',
                         'voided_at', 'void_reason'];
begin
  if new.status is distinct from old.status then
    if old.status = 'draft' and new.status in ('open', 'void') then
      null;
    elsif old.status = any (v_settled) and new.status = any (v_settled) and pg_trigger_depth() > 1 then
      null;
    elsif old.status in ('open', 'partially_paid') and new.status = 'void' then
      if old.amount_paid > 0 then
        raise exception 'BILL_HAS_PAYMENTS';
      end if;
    else
      raise exception 'ILLEGAL_BILL_TRANSITION: % -> %', old.status, new.status;
    end if;
    if new.status = 'open' and old.status = 'draft' then
      new.opened_at := now();
    elsif new.status = 'void' then
      new.voided_at := now();
    end if;
  end if;
  if old.status <> 'draft'
     and (to_jsonb(new) - v_lock) is distinct from (to_jsonb(old) - v_lock) then
    raise exception 'DOC_LOCKED';
  end if;
  return new;
end;
$$;
revoke execute on function app.vendor_bill_guard() from public, anon, authenticated;

create or replace function app.guard_vendor_payment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_bill public.vendor_bills;
  v_other numeric;
begin
  if tg_op = 'UPDATE' and new.vendor_bill_id is distinct from old.vendor_bill_id then
    raise exception 'BILL_NOT_PAYABLE';
  end if;
  select * into v_bill from public.vendor_bills b where b.id = new.vendor_bill_id for update;
  if not found or v_bill.status not in ('open', 'partially_paid', 'paid') then
    raise exception 'BILL_NOT_PAYABLE';
  end if;
  select coalesce(sum(p.amount), 0) into v_other
  from public.vendor_payments p
  where p.vendor_bill_id = new.vendor_bill_id and (tg_op = 'INSERT' or p.id <> new.id);
  if round(v_other + new.amount, v_bill.currency_decimals) > round(v_bill.total, v_bill.currency_decimals) then
    raise exception 'BILL_OVERPAYMENT';
  end if;
  return new;
end;
$$;
revoke execute on function app.guard_vendor_payment() from public, anon, authenticated;

create or replace function app.settle_vendor_bill()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := case when tg_op = 'DELETE' then old.vendor_bill_id else new.vendor_bill_id end;
  v_bill public.vendor_bills;
  v_paid numeric;
  v_status text;
begin
  select * into v_bill from public.vendor_bills b where b.id = v_id;
  if not found then
    return null; -- bill is being cascade-deleted
  end if;
  select round(coalesce(sum(p.amount), 0), v_bill.currency_decimals) into v_paid
  from public.vendor_payments p where p.vendor_bill_id = v_id;
  v_status := v_bill.status;
  if v_bill.status in ('open', 'partially_paid', 'paid') then
    v_status := case
                  when v_paid <= 0 then 'open'
                  when v_paid >= round(v_bill.total, v_bill.currency_decimals) then 'paid'
                  else 'partially_paid'
                end;
  end if;
  update public.vendor_bills b
     set amount_paid = v_paid, status = v_status
   where b.id = v_id and (b.amount_paid, b.status) is distinct from (v_paid, v_status);
  return null;
end;
$$;
revoke execute on function app.settle_vendor_bill() from public, anon, authenticated;

create or replace function app.trg_vendor_bill_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_supplier text;
begin
  if new.status is not distinct from old.status or new.status <> 'paid' then
    return null;
  end if;
  begin
    select s.name into v_supplier from public.suppliers s where s.id = new.supplier_id;
    perform app.emit_event(new.tenant_id, 'vendor_bill.paid', 'vendor_bill', new.id,
      jsonb_build_object('id', new.id, 'doc_number', new.doc_number, 'supplier_id', new.supplier_id,
                         'supplier', v_supplier, 'supplier_invoice_number', new.supplier_invoice_number,
                         'total', new.total, 'currency', new.currency, 'purchase_order_id', new.purchase_order_id),
      'vendor_bill.paid:' || new.id);
  exception when others then
    raise warning 'vendor_bill events: % (%)', sqlerrm, sqlstate;
  end;
  return null;
end;
$$;
revoke execute on function app.trg_vendor_bill_events() from public, anon, authenticated;

create trigger a_vendor_bills_currency before insert on public.vendor_bills
  for each row execute function app.stamp_doc_currency();
create trigger b_vendor_bills_number
  before insert or update of number, doc_number on public.vendor_bills
  for each row execute function app.assign_doc_number('vendor_bill', 'BILL');
create trigger c_vendor_bills_defaults before insert or update of supplier_id, purchase_order_id on public.vendor_bills
  for each row execute function app.vendor_bill_defaults();
create trigger vendor_bills_updated_at before update on public.vendor_bills
  for each row execute function app.set_updated_at();
create trigger vendor_bills_stamp_actor before insert or update on public.vendor_bills
  for each row execute function app.stamp_actor();
create trigger vendor_bills_audit after insert or update or delete on public.vendor_bills
  for each row execute function app.log_audit();
create trigger vendor_bills_same_tenant
  before insert or update of supplier_id, purchase_order_id on public.vendor_bills
  for each row execute function app.assert_same_tenant('supplier_id', 'suppliers', 'purchase_order_id', 'purchase_orders');
create trigger vendor_bills_guard before update on public.vendor_bills
  for each row execute function app.vendor_bill_guard();
create trigger vendor_bills_not_empty before update of status on public.vendor_bills
  for each row execute function app.guard_doc_not_empty('vendor_bill_lines', 'vendor_bill_id');
create trigger vendor_bills_deletable before delete on public.vendor_bills
  for each row execute function app.guard_doc_deletable('draft');
create trigger vendor_bills_events after update of status on public.vendor_bills
  for each row execute function app.trg_vendor_bill_events();

create trigger vendor_bill_lines_guard before insert or update or delete on public.vendor_bill_lines
  for each row execute function app.guard_line_editable('vendor_bills', 'vendor_bill_id', 'draft');
create trigger vendor_bill_lines_amounts before insert or update on public.vendor_bill_lines
  for each row execute function app.compute_line_amounts('vendor_bills', 'vendor_bill_id');
create trigger vendor_bill_lines_totals after insert or update or delete on public.vendor_bill_lines
  for each row execute function app.recompute_purchasing_totals('vendor_bills', 'vendor_bill_lines', 'vendor_bill_id');
create trigger vendor_bill_lines_updated_at before update on public.vendor_bill_lines
  for each row execute function app.set_updated_at();
create trigger vendor_bill_lines_stamp_actor before insert or update on public.vendor_bill_lines
  for each row execute function app.stamp_actor();
create trigger vendor_bill_lines_same_tenant
  before insert or update of vendor_bill_id, item_id, purchase_order_line_id on public.vendor_bill_lines
  for each row execute function app.assert_same_tenant(
    'vendor_bill_id', 'vendor_bills', 'item_id', 'inventory_items', 'purchase_order_line_id', 'purchase_order_lines');

create trigger vendor_payments_guard before insert or update on public.vendor_payments
  for each row execute function app.guard_vendor_payment();
create trigger vendor_payments_settle after insert or update or delete on public.vendor_payments
  for each row execute function app.settle_vendor_bill();
create trigger vendor_payments_updated_at before update on public.vendor_payments
  for each row execute function app.set_updated_at();
create trigger vendor_payments_stamp_actor before insert or update on public.vendor_payments
  for each row execute function app.stamp_actor();
create trigger vendor_payments_audit after insert or update or delete on public.vendor_payments
  for each row execute function app.log_audit();
create trigger vendor_payments_same_tenant before insert or update of vendor_bill_id on public.vendor_payments
  for each row execute function app.assert_same_tenant('vendor_bill_id', 'vendor_bills');

-- Draft a bill for what the PO has received (or ordered, when nothing has
-- been received yet) and no other live bill covers yet.
create or replace function public.vendor_bill_from_po(p_po uuid)
returns public.vendor_bills
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('purchasing', 'manager');
  v_po public.purchase_orders;
  v_bill public.vendor_bills;
  v_any_received boolean;
  v_count integer;
begin
  select * into v_po from public.purchase_orders po where po.id = p_po and po.tenant_id = v_tenant;
  if not found then
    raise exception 'PO_NOT_FOUND';
  end if;
  if v_po.status not in ('confirmed', 'partially_received', 'received', 'closed') then
    raise exception 'PO_NOT_BILLABLE';
  end if;
  select exists (select 1 from public.purchase_order_lines l where l.purchase_order_id = p_po and l.received_qty > 0)
    into v_any_received;

  insert into public.vendor_bills (tenant_id, supplier_id, purchase_order_id, currency, currency_decimals, notes)
  values (v_tenant, v_po.supplier_id, p_po, v_po.currency, v_po.currency_decimals, null)
  returning * into v_bill;

  insert into public.vendor_bill_lines (tenant_id, vendor_bill_id, sort_order, item_id, purchase_order_line_id,
                                        description, quantity, unit, unit_price, discount_percent, tax_rate)
  select v_tenant, v_bill.id, l.sort_order, l.item_id, l.id, l.description, q.qty, l.unit, l.unit_price,
         l.discount_percent, l.tax_rate
  from public.purchase_order_lines l
  cross join lateral (
    select (case when v_any_received then l.received_qty else l.quantity end)
           - coalesce((select sum(bl.quantity) from public.vendor_bill_lines bl
                       join public.vendor_bills b on b.id = bl.vendor_bill_id
                       where bl.purchase_order_line_id = l.id and b.status <> 'void' and b.id <> v_bill.id), 0) as qty
  ) q
  where l.purchase_order_id = p_po and q.qty > 0
  order by l.sort_order, l.id;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'NOTHING_TO_BILL';
  end if;
  select * into v_bill from public.vendor_bills b where b.id = v_bill.id;
  return v_bill;
end;
$$;
revoke execute on function public.vendor_bill_from_po(uuid) from public, anon;
grant execute on function public.vendor_bill_from_po(uuid) to authenticated;

-- ============================================================
-- 4) Scanner (run by refresh_notifications)
-- ============================================================
create or replace function app.scan_due_purchasing(p_tenant uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer := 0;
  v_today date := current_date;
  r record;
begin
  if p_tenant is null or not app.tenant_module_enabled(p_tenant, 'purchasing') then
    return 0;
  end if;
  for r in
    select b.id, b.doc_number, b.supplier_invoice_number, b.due_date, b.total - b.amount_paid as balance,
           b.currency, s.name as supplier
    from public.vendor_bills b
    join public.suppliers s on s.id = b.supplier_id
    where b.tenant_id = p_tenant and b.status in ('open', 'partially_paid')
      and b.due_date is not null and b.due_date <= v_today + 3
    order by b.due_date
    limit 500
  loop
    v_total := v_total + coalesce(app.notify(
      p_tenant, 'managers', 'purchasing.bill_due',
      case when r.due_date < v_today then 'warning' else 'info' end,
      'vendor_bill', r.id, '/purchasing/bills/' || r.id,
      jsonb_build_object('number', r.doc_number, 'supplier', r.supplier, 'due_date', r.due_date,
                         'days', r.due_date - v_today, 'balance', r.balance, 'currency', r.currency,
                         'stage', case when r.due_date < v_today then 'overdue' else 'due' end),
      case when r.due_date < v_today then 'Bill overdue: ' else 'Bill due: ' end || coalesce(r.doc_number, ''),
      r.supplier,
      'purchasing.bill_due:' || r.id || ':' || case when r.due_date < v_today then 'overdue' else 'due' end), 0);
  end loop;
  for r in
    select po.id, po.doc_number, po.expected_date, s.name as supplier
    from public.purchase_orders po
    join public.suppliers s on s.id = po.supplier_id
    where po.tenant_id = p_tenant and po.status in ('sent', 'confirmed', 'partially_received')
      and po.expected_date is not null and po.expected_date < v_today
    order by po.expected_date
    limit 500
  loop
    v_total := v_total + coalesce(app.notify(
      p_tenant, 'managers', 'purchasing.po_late', 'warning', 'purchase_order', r.id,
      '/purchasing/orders/' || r.id,
      jsonb_build_object('number', r.doc_number, 'supplier', r.supplier, 'expected_date', r.expected_date,
                         'days', v_today - r.expected_date),
      'Late delivery: ' || coalesce(r.doc_number, ''), r.supplier,
      'purchasing.po_late:' || r.id || ':' || r.expected_date), 0);
  end loop;
  return v_total;
end;
$$;
revoke execute on function app.scan_due_purchasing(uuid) from public, anon, authenticated;

-- ============================================================
-- 5) RLS policies, LAST. Members read, managers write; receipts are
--    written only by purchase_receive.
-- ============================================================
set local lock_timeout = '1s';

do $$
declare
  t text;
begin
  foreach t in array array[
    'purchase_orders', 'purchase_order_lines', 'purchase_receipts', 'purchase_receipt_lines',
    'vendor_bills', 'vendor_bill_lines', 'vendor_payments'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (tenant_id = (select app.tenant_id()) and (select app.module_enabled(''purchasing'')))',
      t || '_select', t);
    if t not in ('purchase_receipts', 'purchase_receipt_lines') then
      execute format(
        'create policy %I on public.%I for insert to authenticated
           with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
                       and (select app.module_enabled(''purchasing'')))',
        t || '_insert', t);
      execute format(
        'create policy %I on public.%I for update to authenticated
           using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
                  and (select app.module_enabled(''purchasing'')))
           with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
                       and (select app.module_enabled(''purchasing'')))',
        t || '_update', t);
      execute format(
        'create policy %I on public.%I for delete to authenticated
           using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
                  and (select app.module_enabled(''purchasing'')))',
        t || '_delete', t);
    end if;
  end loop;
end;
$$;
