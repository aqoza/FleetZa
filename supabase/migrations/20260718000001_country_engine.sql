-- Country engine: tenant tax registration id + per-work-order tax rate.
-- Existing RLS policies and grants on both tables already cover these columns.
alter table public.tenants add column tax_registration_number text;
alter table public.work_orders add column tax_rate numeric(5,2) not null default 0;
