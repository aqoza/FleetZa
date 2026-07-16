# Fleet Management SaaS — Market Research Summary (2026-07)

## Competitive landscape
| Product | Focus | Pricing signal |
|---|---|---|
| Fleetio | Maintenance workflows: PM schedules, work orders, parts, inspections, fuel/expense, vendors, service reminders | $4–10 / vehicle / mo |
| Samsara | Telematics-first: GPS, AI dashcams, driver safety scoring, ELD compliance, fuel monitoring | $27–35 / vehicle / mo |
| Motive | ELD compliance + HOS, AI dashcams, fuel card; weak structured maintenance (no work orders/parts) | hardware-tied |

Takeaway: the software-only, hardware-independent niche (Fleetio's) is the right scope for a
web SaaS we can actually ship: operations + maintenance + cost tracking, with telematics as a
future integration point rather than a core dependency.

## Feature set derived for v1
Vehicles/assets · drivers (license & doc expiry) · vehicle-driver assignments ·
preventive service reminders (time and odometer based) · work orders with line items & costs ·
fuel logs with efficiency · inspection checklists (DVIR-like) · issue tracking (defects → work orders) ·
renewals (registration, insurance, permits) · dashboard KPIs & cost reports ·
multi-tenant self-serve onboarding, roles, invitations · per-tenant currency/units/timezone (global tenants).

## Multi-tenant Supabase pattern (validated against current guidance)
- `tenant_id` column on every table; RLS policies compare against JWT claim.
- Tenant + role stored in `app_metadata` (user-immutable), set via service-role on signup/invite —
  `user_metadata` is user-writable and must never be used for authorization.
- Embed claims in JWT to avoid per-row membership subqueries (RLS performance), index every column used in policies.
- JWTs are stale until refresh — force `refreshSession()` after membership/role changes.
- Service-role key only in Cloudflare Worker secrets.

Sources:
- [Fleetio vs Samsara (2026)](https://www.fleetio.com/alternatives/samsara)
- [Motive vs Fleetio](https://fleetopsclub.com/compare/motive-vs-fleetio)
- [Best fleet management software 2026 (G2)](https://learn.g2.com/best-fleet-management-software)
- [Best fleet software for small business 2026](https://ortemtech.com/blog/best-fleet-management-software-small-business-2026)
- [Supabase RLS docs](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase RLS best practices (Makerkit)](https://makerkit.dev/blog/tutorials/supabase-rls-best-practices)
- [Multi-tenant RLS deep dive](https://dev.to/kanta13jp1/supabase-rls-deep-dive-multi-tenant-access-control-11ig)
- [RLS multi-tenant from day one](https://dev.to/issuecapture/row-level-security-in-supabase-multi-tenant-saas-from-day-one-4lon)
