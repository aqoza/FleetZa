# Production document and CSV download verification

Base: `43315ca` (PR #63). Scope: Acme Logistics demo tenant on
`https://fleetmaster.uk`, using the prior labeled synthetic document and vehicle.

## Findings and changes

- **DOC-DOWNLOAD-001:** the original document downloaded successfully and matched
  its 69-byte source, but its display title was used as the filename without the
  stored `.txt` extension. Downloads now append the stored extension, avoid
  duplicates and remove invalid filename/path characters. Private storage and
  the 60-second signed URL remain unchanged.
- **CSV-DOWNLOAD-001:** report CSVs omitted the UTF-8 BOM used by table exports,
  risking garbled Arabic names in Excel. A shared serializer now covers both
  report and DataTable exports, including quoting CR/LF, commas and quotes.
- **CSV-DOWNLOAD-002:** report exports omitted spreadsheet-formula neutralization.
  The shared serializer treats formula-like user text and leading tab/newline
  controls as text, while preserving actual negative numeric values.
- Download-event timeouts did not prove application failure. The earlier files
  were present in Downloads; a fresh cost CSV was also saved after the user
  confirmed Chrome's native Save As dialog. Browser diagnostics received all
  87 bytes while awaiting that dialog. Native dialog automation is unavailable.

## Automated checks

- `npx vitest run src/lib/documents.test.ts src/lib/csv.test.ts`: 12 tests passed.
- `npm test`: 538 tests across 45 files passed.
- `npm run build`: TypeScript and build passed; existing large-chunk warnings.
- `node docs/buildout/pglite/verify.mjs`: 1,606 assertions across 35 suites passed;
  local summary `fleetza-regression-yOO2WR/summary.json`.
- Shared DataTable usage makes the change cross-module; full regression was run.
  No migration, dependency, RLS, role, or certificate-verification change.

## Browser/file evidence

- Baseline document source and downloaded file SHA-256:
  `A75C3BAC1A7CDF8E68FD661DD6B870356258F03CEEA55055255B1768F03AB2F2`.
- Fresh baseline cost CSV parsed independently: vehicle UI-AUDIT-20261014 Vehicle,
  fuel 20.00, maintenance 10.00, total 30.00, empty cost/distance cell.
- Corrected browser download and production deployment checks are pending.

The documents module was temporarily enabled for this test. Its original absent
module row must be restored at completion; no other module flags need changing.
