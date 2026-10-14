# Demo-tenant production UI write audit — 2026-10-14

Scope: actual browser writes on fleetmaster.uk as the Acme Logistics demo owner.
Synthetic records use `UI-AUDIT-20261014`; no real funds or outbound messages.
This audit is in progress. The final coverage and cleanup record will be appended.

## Defects reproduced and corrected

| ID | Production failure | Correction | Verification before deployment |
|---|---|---|---|
| TRIP-UI-001 | Completing a trip in its starting minute raises INVALID_TRIP_TIMES | Preserve milliseconds in the completion default; keep planning precision unchanged | Timestamp regression tests; local UI completed the demo trip and raised its odometer from 100 to 110 |
| TMS-UI-001 | Delivering a shipment in its dispatch minute raises INVALID_POD_TIME | Preserve milliseconds in delivery default and input bounds | Timestamp regression tests; local UI delivered the demo shipment and displayed its recipient |
| POS-UI-001 | New-register submission fails column permissions | Omit the server-default active field on insert; retain it for edits | Local UI created a register against production under the demo owner; database grants unchanged |
| SHELL-UI-001 | Failed lazy module import leaves the authenticated application blank | Route error boundary with translated reload action and retained navigation | Browser network fault injection blocked Incidents; fallback rendered; clearing the fault and reloading restored Incidents |
| POS-UI-002 | Refund succeeds but its details request uses `[object Object]` as the UUID | Read `order_id` from the refund RPC object | Local corrected UI sold and refunded another $25 test sale; POS-00004 refund details opened with -$25 and a link to the original |

Validation: 533 unit tests, 1,603 SQL assertions across 35 suites, TypeScript and
production build passed. Build retains existing large-chunk advisories. No schema,
RLS, grants, or public certificate verification behavior changed.

Completed production UI chains so far include customer/supplier/vehicle/driver/
employee creation, fuel, issue-to-work-order completion with workshop time,
preventive completion, inspection, renewal, inventory receipt, PO-to-GRN-to-paid
vendor bill, quote-to-order-to-paid invoice, leave/payroll, field task, dispatch,
delivery route/POD, insurance coverage, incident resolution, regulatory
obligations, asset custody, and CRM conversion/won opportunity. Recorded payments
are synthetic bookkeeping only. Trip/TMS recovery above used the local corrected
frontend against the production demo tenant; live deployment retests are pending.

PR #61 deployed successfully as `1a0ecaf`. Production new-register creation was
retested successfully with a warehouse. The subsequent sale/refund uncovered
POS-UI-002 above; both initial sale and refund persisted correctly. The follow-up
change passed 533 unit tests, 1,603 SQL assertions, TypeScript and build again.

Additional live UI coverage: manual GPS position and geofence; driving event and
completed coaching; predictive snapshot; finance chart setup, five source
postings, and approved/posted expense; nonbinding synthetic contract activation,
period billing and termination; customer portal request, manager completion and
revocation denial; supplier portal acknowledgment and revocation denial; IoT
sensor/rule/reading/alert acknowledgment/resolution; private document upload and
signed content viewing; private BI payment KPI ($50); exact-name automation
trigger (one successful action), paused afterward; notification read state;
company and branch creation; unchanged security-policy save and audit trail;
limiter inventory and maintenance job lifecycle with an explicit synthetic-test
override (no signatures), and unchanged certificate settings save.

Integration credential creation is awaiting action-time confirmation. No API key
has been created. No outbound webhook was sent. Public certificate verification
and certificate issuance/revocation were not exercised. The document's signed
view rendered its original 69-byte text; a download event was not captured.
