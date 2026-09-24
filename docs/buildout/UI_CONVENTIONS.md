# UI conventions for the module build-out

## Per-module ownership (builders touch ONLY their own files)

| Module id | Page dir `src/pages/…` | Hub component (default export) | Mounted at | i18n namespace (file + key prefix + export names) |
|---|---|---|---|---|
| gps_tracking | gps-tracking/ | GpsTrackingHub.tsx | /gps/* | gpsTracking → `enGpsTracking`/`arGpsTracking`, keys `gpsTracking.*` |
| driver_behavior | driver-behavior/ | DriverBehaviorHub.tsx | /driver-behavior/* | driverBehavior |
| trip_planning | trips/ | TripsHub.tsx | /trips/* | trips |
| dispatch | dispatch/ | DispatchHub.tsx | /dispatch/* | dispatch |
| workshop | workshop/ | WorkshopHub.tsx | /workshop/* | workshop |
| predictive_ai | predictive/ | PredictiveHub.tsx | /predictive/* | predictive |
| insurance_mgmt | insurance/ | InsuranceHub.tsx | /insurance/* | insurance |
| incidents | incidents/ | IncidentsHub.tsx | /incidents/* | incidents |
| regulatory | regulatory/ | RegulatoryHub.tsx | /regulatory/* | regulatory |
| tms | tms/ | TmsHub.tsx | /tms/* | tms |
| logistics_delivery | deliveries/ | DeliveriesHub.tsx | /deliveries/* | deliveries |
| assets | assets/ | AssetsHub.tsx | /assets/* | assets |
| inventory | inventory/ | InventoryHub.tsx | /inventory/* | inventory |
| purchasing | purchasing/ | PurchasingHub.tsx | /purchasing/* | purchasing |
| pos | pos/ | PosHub.tsx | /pos/* | pos |
| crm | crm/ | CrmHub.tsx | /crm/* | crm |
| finance | finance/ | FinanceHub.tsx | /finance/* | finance |
| contracts | contracts/ | ContractsHub.tsx | /contracts/* | contracts |
| payroll_hr | hr/ | HrHub.tsx | /hr/* | hr |
| mobile_workforce | field/ | FieldHub.tsx | /field/* | field |
| employees | employees/ | EmployeesHub.tsx | /employees/* | employees |
| suppliers | suppliers/ | SuppliersHub.tsx | /suppliers/* | suppliers |
| customer_portal | customer-portal/ | CustomerPortalHub.tsx (+ public `PublicPortalPage.tsx` at /portal/:token) | /customer-portal/* | customerPortal |
| vendor_portal | vendor-portal/ | VendorPortalHub.tsx (+ public `PublicVendorPage.tsx` at /vendor/:token) | /vendor-portal/* | vendorPortal |
| bi_analytics | analytics/ | AnalyticsHub.tsx | /analytics/* | analytics |
| documents | documents/ | DocumentsHub.tsx (+ `AttachmentsPanel.tsx` reusable) | /documents/* | documents |
| workflow_automation | automation/ | AutomationHub.tsx | /automation/* | automation |
| integrations | integrations/ | IntegrationsHub.tsx | /integrations/* | integrations |
| iot_devices | iot/ | IotHub.tsx | /iot/* | iot |
| notifications | notifications/ | NotificationsHub.tsx (+ `NotificationBell.tsx` for the header) | /notifications/* | notifications |
| audit_security | security/ | SecurityHub.tsx | /security/* | security |
| multi_company | companies/ | CompaniesHub.tsx | /companies/* | companies |
| logistics_delivery (public) | deliveries/ | `PublicTrackingPage.tsx` | /track/:token | deliveries |

Builders own, exclusively:
- `src/pages/<dir>/**` (hub, pages, module-local `types.ts`, `labels.ts`, `hooks.ts`, components)
- `src/i18n/messages/en/<ns>.ts` and `src/i18n/messages/ar/<ns>.ts` (already created + registered by the wiring step with a few keys; extend them)
- `src/lib/<module>.ts` + `src/lib/<module>.test.ts` or `shared/<module>.ts` + test for pure logic
- their worker file(s) `worker/<file>.ts` when the spec has endpoints (already created + mounted by wiring as an empty Hono app)

Builders must NOT edit: `src/App.tsx`, `src/modules/nav.ts`, `shared/modules.ts`, `src/i18n/index.tsx`,
`src/lib/db.ts`, `src/lib/types.ts`, `src/lib/pickers.ts`, `src/lib/labels.ts`,
`src/lib/database.types.ts`, `src/components/**`, `worker/index.ts`, other modules' dirs,
`common.ts`/`errors.ts`/`modules.ts` i18n files, any migration. If they need a change
there, they report it in their result (`shared_requests`) and the integrator applies it.

## Types
Use generated types: `import type { Tables } from "../../lib/database.types";`
`type Trip = Tables<"trips">;` (module-local `types.ts` for unions/derived shapes).
Master-data types + pickers (added by wiring to `src/lib/types.ts` / `src/lib/pickers.ts`):
`Supplier, SupplierContact, Employee, Department, Company, Branch, Warehouse, InventoryItem, StockLevel, StockMove, AppNotification, DocumentRow, ApiKey`;
`useSupplierPicker, useEmployeePicker, useWarehousePicker, useInventoryItemPicker, useBranchPicker, useCompanyPicker, useDepartmentPicker` (same signature style as `useVehiclePicker(selectedId, opts?)`).

## Hub shape
`src/components/HubNav.tsx` (added by wiring) renders the pill tab row used by SalesHub:
`<HubNav tabs={[{ to: "/gps", labelKey: "gpsTracking.tab.live", end: true }, …]} />`.
Hub = `<PageHeader title subtitle actions?/>` + `<HubNav/>` + `<Suspense><Routes>…relative routes…</Routes></Suspense>`,
sub-pages lazy-loaded. Detail pages at canonical nested URLs (`/incidents/:id`).
Every page: loading / empty / error states, `useT()` for all text, `isManager`/`isAdmin` from `useAuth()`,
tokens only (no raw `bg-white`, `text-slate-*`), logical utilities, `tabular-nums` for numbers,
`formatMoney/formatDate/formatDistance…` from `src/lib/format.ts` (tenant from `useTenant()`),
`wrapDbError` for RPC errors (`supabase.rpc(...)` → `if (error) throw wrapDbError(error)`),
`useToast().success(...)` for completed actions, React Query keys prefixed with the module id.
Charts: recharts inside `<div dir="ltr">`, colors from `src/lib/chart.ts` + `chart-1`/`chart-2`/status palette only.
Lists: `DataTable` + `listPage` + `<Pagination>`; reference pickers: `Combobox` + picker hooks.
Maps (gps/geofences/deliveries): `leaflet` (installed by wiring) with OSM tiles, attribution, `dir="ltr"` wrapper.

## Visual verification (mandatory before you report done)
Locally, drive the real app on the demo tenant (`demo@fleetmanage.test`). For fast en/ar × light/dark × desktop/mobile screenshots — or in a container that cannot reach Supabase — render pages against the mocked backend (setup: `docs/buildout/smoke/README.md`):
```
SMOKE=docs/buildout/smoke
node $SMOKE/run.mjs --routes "/gps,/gps/history" --langs en,ar --themes light,dark --viewport both \
  --fixtures $SMOKE/fixtures/<module>.json --out $SMOKE/out/<module>
```
Read `$SMOKE/README.md` first. Write realistic fixtures for your module's tables/RPCs in
`$SMOKE/fixtures/<module>.json` (or `.mjs`) so lists, detail pages and charts render with
data (the report's `backend.emptyTables` / `rpcWithoutFixture` tell you what a page asked for).
A shared Vite server runs on :5199 and hot-reloads everyone's edits — never stop it
(no `--stop-server`). Exit code must be 0 (no page errors, console errors, raw i18n keys,
horizontal overflow). Open several PNGs (Read tool) and actually look: RTL mirrored, dark
theme legible, data visible, nothing clipped. Also run `--role viewer` once to confirm
write actions are hidden.

Typecheck: `npx tsc -b` from the repo root is sub-second; other builders edit in parallel, so
filter to your files when judging (`npx tsc -b 2>&1 | grep -E "src/pages/<dir>|<ns>\.ts|worker/<file>"`),
but your own files must be error-free. Tests: `npx vitest run <your test files>`.
