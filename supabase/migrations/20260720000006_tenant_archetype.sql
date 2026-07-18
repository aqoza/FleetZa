-- Tenant archetype: the platform serves two business types with different
-- home dashboards and onboarding defaults (docs/ARCHITECTURE_REVIEW.md).
--   fleet_operator   — manages its own fleet only
--   service_provider — installs/certifies speed limiters for customer fleets
alter table public.tenants add column archetype text not null default 'fleet_operator'
  check (archetype in ('fleet_operator', 'service_provider'));

-- Existing tenants that run the speed-limiter suite are service providers.
update public.tenants t
set archetype = 'service_provider'
where exists (
  select 1 from public.tenant_modules m
  where m.tenant_id = t.id and m.module_id = 'speed_limiters' and m.enabled
);
