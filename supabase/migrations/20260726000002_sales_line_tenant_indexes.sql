-- Follow-up to 20260726000001_sales_billing: the document tables got covering
-- indexes for tenant_id via their (tenant_id, status, date) composites, but the
-- three line tables did not — and every RLS policy on them filters on
-- tenant_id. Flagged by the live performance advisor (unindexed_foreign_keys).
create index quote_lines_tenant_idx on public.quote_lines (tenant_id);
create index sales_order_lines_tenant_idx on public.sales_order_lines (tenant_id);
create index invoice_lines_tenant_idx on public.invoice_lines (tenant_id);
