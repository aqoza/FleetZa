-- Cover the remaining foreign-key lookup paths. Existing job indexes start
-- with tenant_id and serve tenant-filtered queries; FK checks need job_id first.
-- Production preflight: these seven tables contain 0-2 rows each, at most 192 kB
-- including indexes. Transactional builds are bounded by the timeouts below.
-- No rows, constraints, policies, or existing indexes change.
-- Rollback, if needed: remove only these indexes in a new forward migration.
set local lock_timeout = '3s';
set local statement_timeout = '60s';

create index invoices_job_fk_idx on public.invoices (job_id);
create index quotes_job_fk_idx on public.quotes (job_id);
create index sales_orders_job_fk_idx on public.sales_orders (job_id);
create index pos_sessions_opened_by_idx on public.pos_sessions (opened_by);
create index pos_sessions_closed_by_idx on public.pos_sessions (closed_by);
create index sl_settings_default_technician_idx on public.sl_settings (default_technician_id);
create index vehicle_last_positions_driver_idx on public.vehicle_last_positions (driver_id);
create index webhook_secrets_tenant_idx on public.webhook_secrets (tenant_id);
