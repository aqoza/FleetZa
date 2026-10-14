# Demo-tenant production UI write audit — 2026-10-14

Scope: representative browser write flows on fleetmaster.uk as the Acme Logistics demo owner. All 46 registered modules are accounted for below. Synthetic records use UI-AUDIT-20261014 / UI1014; payments are bookkeeping only. No real money, external messages, signatures, or physical hardware operations were performed. This is not exhaustive coverage of every action, role, browser, or device.

## Defects reproduced, fixed, and retested

| ID | Production failure | Correction and deployed verification |
|---|---|---|
| TRIP-UI-001 | Same-minute completion raises INVALID_TRIP_TIMES | Preserve milliseconds in completion default. Production TRP-00002 started and completed in the same minute. |
| TMS-UI-001 | Same-minute delivery raises INVALID_POD_TIME | Preserve milliseconds in delivery default and bounds. Production SHP-00002 dispatched, picked up, and delivered in the same minute. |
| POS-UI-001 | Register creation sends a column without insert permission | Omit server-default active on insert. Production register created with warehouse; grants unchanged. |
| SHELL-UI-001 | Failed lazy import leaves the whole application blank | Localized route error boundary retains navigation and reload action. Local fault injection and a production deployment-time load failure displayed recovery; reload restored the page. |
| POS-UI-002 | Successful refund opens details using [object Object] as UUID | Read order_id from RPC result. Production POS-00005 refunded as POS-00006; correct -$25 modal and original-sale link displayed. |
| FINANCE-UI-001 | Payroll adds gross to employer-cost total that already includes gross | Post total_employer_cost once. Production $100 payroll posts $100 debit, $96.67 bank credit and $3.33 liability. |

Frontend fixes shipped in PRs [61](https://github.com/aqoza/FleetZa/pull/61) and [62](https://github.com/aqoza/FleetZa/pull/62), with successful Cloudflare deployments. Payroll migration 20261014000005_payroll_finance_cost.sql was applied through Supabase and mirrored in this change.

Payroll impact inspection found one affected demo posting and none in other tenants. Original JE-00003 ($200) was reversed through the production UI by JE-00007, then reposted as JE-00008 ($100), retaining its audit history. A rollback-only production probe first verified corrected totals and idempotency. No historical journal rows were rewritten.

## Module coverage

Each row describes the observed production UI result unless qualified. Initial trip/TMS recovery used a local corrected frontend against the demo database; subsequent production retests passed.

| Module | Observed flow and result |
|---|---|
| fleet | Created vehicle; completed trip advanced odometer 100 to 110. |
| drivers | Created driver and selected it in operational flows. |
| fuel | Logged 10 L, $20, odometer 100; reports reconciled. |
| gps_tracking | Manual position at synthetic 0,0 and 500 m geofence with alerts off. |
| driver_behavior | Harsh-braking event and completed coaching. |
| trip_planning | Create, dispatch, start, complete; both trips completed. |
| dispatch | Create, assign, set off, on site, complete; completed/on-time metrics updated. |
| maintenance | Converted issue, added $10 labor, started and completed work order #5. |
| preventive | Monthly reminder marked done; next due advanced to November 14. |
| inspections | Saved standard inspection with all 14 checks passing. |
| issues | Created issue and converted to completed work order. |
| workshop | Logged one synthetic technician hour against work order. |
| predictive_ai | Saved snapshot; UI confirmed three vehicle predictions. |
| renewals | Created registration renewal and marked completed. |
| speed_limiters | Device and maintenance job #2; start, explicit synthetic completion override, QC, close. No actual fitting or signatures. |
| sl_certificates | Read statuses and saved unchanged settings; issuance/revocation excluded. |
| insurance_mgmt | Synthetic policy and vehicle coverage; claims not exercised. |
| incidents | Near-miss reported, investigated, resolved, closed. |
| regulatory | Unverified test requirement and five generated obligations. |
| tms | Create, book, dispatch, pickup, delivery with recipient; both shipments delivered. |
| logistics_delivery | Delivery and route created, assigned, started, POD recorded, route completed. |
| assets | Created, assigned employee custody, returned to warehouse. |
| inventory | Warehouse/item, receipt of 10 units at $5 plus 2 via purchasing; final stock 12. |
| purchasing | PO-00001 confirmed/received as GRN-00001; BILL-00001 approved and synthetic $10 payment recorded, balance zero. |
| sales | Service, QT-00001 sent/accepted, SO-00001 converted/confirmed/fulfilled. No email sent. |
| pos | Register/session, three $25 sales and full refunds; session closed with net sales, cash and variance zero. |
| crm | Lead qualified/converted to customer/contact/opportunity, marked won. |
| finance | Chart setup; five source postings; $2 expense approved/posted; payroll reversal/repost. All eight journals balance. |
| billing | INV-00001 issued, synthetic $50 payment recorded, balance zero. |
| contracts | Explicitly nonbinding contract activated, period billed to draft INV-00002, then terminated. |
| employees | Created employee used by payroll, workshop and field task. |
| payroll_hr | Setup, one-day unpaid leave approved, PAY-00001 calculated/approved/paid; gross $100, deduction $3.33, net $96.67. |
| mobile_workforce | TSK-00001 created, accepted, started, completed. |
| customers | Synthetic customer and CRM-converted customer. |
| suppliers | Synthetic supplier used by purchasing and portal. |
| customer_portal | Scoped synthetic-only link, invoice read, public request, manager Done; revoked link denied access. |
| vendor_portal | Scoped supplier link, PO/bill read, PO-00002 acknowledgment visible to manager; revoked link denied access. |
| reports | Fuel $20 + maintenance $10 = $30 and volume 10 L matched writes. CSV completion unverified. |
| bi_analytics | Private dashboard/payment KPI $50 matched paid invoice. |
| documents | Uploaded 69-byte synthetic text; signed private view rendered original. Download completion unverified. |
| workflow_automation | Exact-name rule dry-run, activated, UI customer trigger, one successful action; paused afterward. |
| integrations | Approved vehicles:read key created in UI; GET vehicles 200, POST empty positions 403 insufficient_scope; UI revoked, subsequent GET 401 invalid_api_key. |
| iot_devices | Sensor/rule, 10°C reading above 8°C threshold, alert acknowledged/resolved. |
| notifications | Five synthetic notifications marked read; unread count zero. |
| audit_security | Unchanged security policy saved; actor/change audit trail inspected. No role grants exercised. |
| multi_company | Synthetic company and linked branch. |

## Regression and security evidence

- 533 unit tests across 44 files passed; TypeScript and production build passed.
- Full PGlite rebuild and 35 SQL suites passed: 1,606 assertions.
- Payroll regressions failed against the old formula (two expected failed assertions), then passed after migration. New integration assertions consume real HR-calculated totals including employer contributions and check debit, bank credit and idempotency. Finance fixtures now match HR employer-cost semantics.
- SQL summary: fleetza-regression-TAJRMa/summary.json in local temp.
- Database types regenerated after migration and unchanged.
- Security advisors unchanged: existing 59 authenticated SECURITY DEFINER warnings and one intentional deny-all webhook-secret RLS information item. Private function execution remains revoked from public/anon/authenticated; tenant filtering and empty search_path retained. No RLS/grant relaxation or certificate verification changes.
- Existing large-bundle build advisories remain.

## Reconciliation and cleanup

Database confirmed both trips completed, both shipments delivered, route/task completed, limiter job closed, stock 12, eight balanced journals and POS closed at zero net/variance. PO-00002 canceled after acknowledgment. Contract terminated. Customer/vendor links and API key revoked; temporary plaintext key file removed. Automation paused; IoT rule/device and reminder inactive; requirement inactive and all five synthetic obligations waived. Cleanup used normal authenticated owner policies/triggers; no integrity checks disabled.

Original demo module rows restored: customers, fleet, fuel, inspections, issues, maintenance, preventive, renewals, reports, sl_certificates and speed_limiters enabled; drivers disabled; temporary module rows removed. Labeled synthetic master data and completed financial/operational records remain for auditability, including draft contract invoice and payroll setup.

## Explicit coverage limits

Representative owner flows, not every role/action or mobile/RTL layout. Certificate issuance/revocation and protected public verification endpoint excluded. No outbound webhook, real payment, insurer claim, hardware ingestion or external email. Role/tenant boundaries covered by SQL suites, not complete multi-role browser matrix. Document viewing passed; document/CSV download events were not captured and browser policy blocked download-history inspection. Download completion remains unverified.
