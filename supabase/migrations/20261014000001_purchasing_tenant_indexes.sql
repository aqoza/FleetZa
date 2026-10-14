-- Cover tenant foreign keys and tenant-scoped reads on the new purchasing line tables.
-- These tables are newly deployed; short timeouts protect concurrent application work.
set local lock_timeout = '3s';
set local statement_timeout = '60s';

create index purchase_order_lines_tenant_idx on public.purchase_order_lines (tenant_id);
create index vendor_bill_lines_tenant_idx on public.vendor_bill_lines (tenant_id);
