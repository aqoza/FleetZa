-- Vendor portal (module vendor_portal, requires purchasing): capability links
-- a supplier opens without an account, at /vendor/:token.
--
-- 1) supplier_portal_access: one row per link (supplier, unguessable token,
--    label, active, expires_at, last_accessed_at). Managers create, revoke
--    and delete links; the token is a secret, so only managers can read rows.
--    The token is never client-writable: a new link is a new row.
-- 2) public.vendor_portal_view(token) and public.vendor_portal_acknowledge(
--    token, po, expected_date, note) are what the worker calls with the
--    service role (worker/vendorPortal.ts). They are the only path from a
--    token to data, and they return whitelisted fields only: the supplier's
--    POs that were sent to them (never drafts or canceled orders) with lines,
--    and their bills (never drafts). An inactive, expired or unknown token,
--    or a tenant with the module off, is indistinguishable from a bad token.
-- 3) Acknowledging a PO records vendor_ack_at / vendor_ack_note /
--    vendor_expected_date and moves it sent -> confirmed; managers get a
--    notification and purchase_order.acknowledged is emitted.
--
-- Rate limiting: none, same posture as the public quote link.
-- Raised codes: VENDOR_LINK_INVALID, PO_NOT_FOUND, PO_NOT_ACKNOWLEDGEABLE,
-- INVALID_EXPECTED_DATE (+ CROSS_TENANT_REFERENCE).
-- Additive only.

set local lock_timeout = '3s';
set local statement_timeout = '60s';

create table public.supplier_portal_access (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  token uuid not null default gen_random_uuid(),
  label text check (label is null or char_length(label) <= 100),
  active boolean not null default true,
  expires_at timestamptz,
  last_accessed_at timestamptz,
  access_count integer not null default 0,
  revoked_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index supplier_portal_access_token_uk on public.supplier_portal_access (token);
create index supplier_portal_access_tenant_idx on public.supplier_portal_access (tenant_id, created_at desc);
create index supplier_portal_access_supplier_idx on public.supplier_portal_access (supplier_id);
alter table public.supplier_portal_access enable row level security;
revoke all on public.supplier_portal_access from anon;
revoke insert, update on public.supplier_portal_access from authenticated;
grant insert (supplier_id, label, expires_at) on public.supplier_portal_access to authenticated;
grant update (label, active, expires_at) on public.supplier_portal_access to authenticated;

-- revoked_at follows active; a link's supplier never changes.
create or replace function app.supplier_portal_access_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.supplier_id is distinct from old.supplier_id or new.token is distinct from old.token then
      raise exception 'FORBIDDEN';
    end if;
    if new.active and not old.active then
      new.revoked_at := null;
    elsif not new.active and old.active then
      new.revoked_at := now();
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function app.supplier_portal_access_guard() from public, anon, authenticated;

create trigger supplier_portal_access_guard before update on public.supplier_portal_access
  for each row execute function app.supplier_portal_access_guard();
create trigger supplier_portal_access_stamp_actor before insert or update on public.supplier_portal_access
  for each row execute function app.stamp_actor();
create trigger supplier_portal_access_audit after insert or update or delete on public.supplier_portal_access
  for each row execute function app.log_audit();
create trigger supplier_portal_access_same_tenant before insert or update of supplier_id on public.supplier_portal_access
  for each row execute function app.assert_same_tenant('supplier_id', 'suppliers');

-- ============================================================
-- Token resolution (service role only)
-- ============================================================
create or replace function app.vendor_portal_link(p_token uuid)
returns public.supplier_portal_access
language sql
stable
security definer
set search_path = ''
as $$
  select a.*
  from public.supplier_portal_access a
  where a.token = p_token
    and a.active
    and (a.expires_at is null or a.expires_at > now())
    and app.tenant_module_enabled(a.tenant_id, 'vendor_portal')
    and app.tenant_module_enabled(a.tenant_id, 'purchasing')
$$;
revoke execute on function app.vendor_portal_link(uuid) from public, anon, authenticated;

create or replace function public.vendor_portal_view(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.supplier_portal_access;
  v_result jsonb;
begin
  select * into v_link from app.vendor_portal_link(p_token);
  if v_link.id is null then
    return null;
  end if;

  -- One write per view is enough for "last opened"; skip it within a minute.
  update public.supplier_portal_access
     set last_accessed_at = now(), access_count = access_count + 1
   where id = v_link.id
     and (last_accessed_at is null or last_accessed_at < now() - interval '1 minute');

  select jsonb_build_object(
    'company', (select jsonb_build_object('name', t.name, 'address', t.address, 'phone', t.phone)
                from public.tenants t where t.id = v_link.tenant_id),
    'supplier', (select jsonb_build_object('name', s.name, 'name_ar', s.name_ar)
                 from public.suppliers s where s.id = v_link.supplier_id),
    'orders', coalesce((
      select jsonb_agg(o order by o->>'order_date' desc, o->>'doc_number' desc)
      from (
        select jsonb_build_object(
          'id', po.id, 'doc_number', po.doc_number, 'status', po.status,
          'order_date', po.order_date, 'expected_date', po.expected_date,
          'currency', po.currency, 'subtotal', po.subtotal, 'discount_total', po.discount_total,
          'tax_total', po.tax_total, 'total', po.total, 'terms', po.terms,
          'supplier_reference', po.supplier_reference,
          'deliver_to', w.name,
          'vendor_ack_at', po.vendor_ack_at, 'vendor_ack_note', po.vendor_ack_note,
          'vendor_expected_date', po.vendor_expected_date,
          'lines', coalesce((
            select jsonb_agg(jsonb_build_object(
                     'id', l.id, 'description', l.description, 'quantity', l.quantity, 'unit', l.unit,
                     'unit_price', l.unit_price, 'discount_percent', l.discount_percent,
                     'tax_rate', l.tax_rate, 'line_total', l.line_total, 'received_qty', l.received_qty)
                   order by l.sort_order, l.created_at)
            from public.purchase_order_lines l where l.purchase_order_id = po.id), '[]'::jsonb)
        ) as o
        from public.purchase_orders po
        left join public.warehouses w on w.id = po.warehouse_id
        where po.tenant_id = v_link.tenant_id
          and po.supplier_id = v_link.supplier_id
          and po.status in ('sent', 'confirmed', 'partially_received', 'received', 'closed')
        order by po.order_date desc, po.number desc
        limit 100
      ) x), '[]'::jsonb),
    'bills', coalesce((
      select jsonb_agg(b order by b->>'bill_date' desc, b->>'doc_number' desc)
      from (
        select jsonb_build_object(
          'id', vb.id, 'doc_number', vb.doc_number, 'status', vb.status,
          'supplier_invoice_number', vb.supplier_invoice_number,
          'bill_date', vb.bill_date, 'due_date', vb.due_date, 'currency', vb.currency,
          'total', vb.total, 'amount_paid', vb.amount_paid,
          'balance', case when vb.status = 'void' then 0 else greatest(vb.total - vb.amount_paid, 0) end,
          'order_number', po.doc_number
        ) as b
        from public.vendor_bills vb
        left join public.purchase_orders po on po.id = vb.purchase_order_id
        where vb.tenant_id = v_link.tenant_id
          and vb.supplier_id = v_link.supplier_id
          and vb.status <> 'draft'
        order by vb.bill_date desc, vb.number desc
        limit 100
      ) y), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke execute on function public.vendor_portal_view(uuid) from public, anon, authenticated;
grant execute on function public.vendor_portal_view(uuid) to service_role;

create or replace function public.vendor_portal_acknowledge(
  p_token uuid,
  p_po uuid,
  p_expected_date date default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.supplier_portal_access;
  v_po public.purchase_orders;
  v_supplier text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into v_link from app.vendor_portal_link(p_token);
  if v_link.id is null then
    raise exception 'VENDOR_LINK_INVALID';
  end if;

  select * into v_po from public.purchase_orders po
  where po.id = p_po and po.tenant_id = v_link.tenant_id and po.supplier_id = v_link.supplier_id
  for update;
  if v_po.id is null or v_po.status in ('draft', 'canceled') then
    raise exception 'PO_NOT_FOUND';
  end if;
  if v_po.status <> 'sent' then
    raise exception 'PO_NOT_ACKNOWLEDGEABLE';
  end if;
  if p_expected_date is not null and p_expected_date < v_po.order_date then
    raise exception 'INVALID_EXPECTED_DATE';
  end if;
  if v_note is not null and char_length(v_note) > 2000 then
    v_note := left(v_note, 2000);
  end if;

  update public.purchase_orders
     set status = 'confirmed',
         vendor_ack_at = now(),
         vendor_ack_note = v_note,
         vendor_expected_date = p_expected_date
   where id = v_po.id and status = 'sent'
  returning * into v_po;

  begin
    select s.name into v_supplier from public.suppliers s where s.id = v_po.supplier_id;
    perform app.notify(
      v_po.tenant_id, 'managers', 'vendor_portal.po_acknowledged', 'info', 'purchase_order', v_po.id,
      '/purchasing/orders/' || v_po.id,
      jsonb_build_object('number', v_po.doc_number, 'supplier', v_supplier,
                         'expected_date', v_po.vendor_expected_date, 'note', v_note),
      'Order acknowledged: ' || coalesce(v_po.doc_number, ''), v_supplier,
      'vendor_portal.po_acknowledged:' || v_po.id, null);
    perform app.emit_event(v_po.tenant_id, 'purchase_order.acknowledged', 'purchase_order', v_po.id,
      jsonb_build_object('id', v_po.id, 'doc_number', v_po.doc_number, 'supplier_id', v_po.supplier_id,
                         'supplier', v_supplier, 'vendor_expected_date', v_po.vendor_expected_date,
                         'vendor_ack_note', v_note),
      'purchase_order.acknowledged:' || v_po.id);
  exception when others then
    raise warning 'vendor_portal_acknowledge side effects: % (%)', sqlerrm, sqlstate;
  end;

  return jsonb_build_object('id', v_po.id, 'status', v_po.status, 'vendor_ack_at', v_po.vendor_ack_at,
                            'vendor_expected_date', v_po.vendor_expected_date);
end;
$$;
revoke execute on function public.vendor_portal_acknowledge(uuid, uuid, date, text) from public, anon, authenticated;
grant execute on function public.vendor_portal_acknowledge(uuid, uuid, date, text) to service_role;

-- ============================================================
-- RLS policies, LAST. The token is a secret: managers only.
-- ============================================================
set local lock_timeout = '1s';

create policy supplier_portal_access_select on public.supplier_portal_access for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
         and (select app.module_enabled('vendor_portal')));
create policy supplier_portal_access_insert on public.supplier_portal_access for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
              and (select app.module_enabled('vendor_portal')));
create policy supplier_portal_access_update on public.supplier_portal_access for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
         and (select app.module_enabled('vendor_portal')))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
              and (select app.module_enabled('vendor_portal')));
create policy supplier_portal_access_delete on public.supplier_portal_access for delete to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
         and (select app.module_enabled('vendor_portal')));
