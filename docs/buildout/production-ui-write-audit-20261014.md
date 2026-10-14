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
