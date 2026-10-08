/**
 * Employees — pure logic shared by the directory, the employee page and the
 * expiring-documents view. No React, no db layer, so it is cheap to test.
 *
 * Document thresholds match the `app.scan_due_employees` scanner (60/30/7/0
 * days), so the badge a manager sees and the notification they get agree.
 */

/** The three identity documents GCC employers track per employee. */
export type EmployeeDocumentKind = "passport" | "residence_permit" | "work_permit";

export type DocumentBucket = "expired" | "d7" | "d30" | "d60" | "ok" | "none";

export const DOCUMENT_COLUMNS: Record<EmployeeDocumentKind, "passport_expiry" | "residence_permit_expiry" | "work_permit_expiry"> = {
  passport: "passport_expiry",
  residence_permit: "residence_permit_expiry",
  work_permit: "work_permit_expiry",
};

/** Widest warning window; the expiring view and its query use the same number. */
export const DOCUMENT_WINDOW_DAYS = 60;

export interface EmployeeDocumentFields {
  passport_expiry: string | null;
  residence_permit_expiry: string | null;
  work_permit_expiry: string | null;
}

const MS_PER_DAY = 86_400_000;

/** Whole days from `today` to a `yyyy-mm-dd` date (negative once past). */
export function daysBetween(today: string, date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / MS_PER_DAY);
}

export function documentBucket(expiry: string | null, today: string): DocumentBucket {
  if (!expiry) return "none";
  const days = daysBetween(today, expiry);
  if (days < 0) return "expired";
  if (days <= 7) return "d7";
  if (days <= 30) return "d30";
  if (days <= DOCUMENT_WINDOW_DAYS) return "d60";
  return "ok";
}

export interface EmployeeDocument {
  kind: EmployeeDocumentKind;
  expiry: string;
  days: number;
  bucket: DocumentBucket;
}

/** Every dated document, soonest first. Undated documents are left out. */
export function employeeDocuments(e: EmployeeDocumentFields, today: string): EmployeeDocument[] {
  const out: EmployeeDocument[] = [];
  for (const kind of Object.keys(DOCUMENT_COLUMNS) as EmployeeDocumentKind[]) {
    const expiry = e[DOCUMENT_COLUMNS[kind]];
    if (expiry) out.push({ kind, expiry, days: daysBetween(today, expiry), bucket: documentBucket(expiry, today) });
  }
  return out.sort((a, b) => a.days - b.days || a.kind.localeCompare(b.kind));
}

/** The document that needs attention first, or null when none is dated. */
export function nextDocument(e: EmployeeDocumentFields, today: string): EmployeeDocument | null {
  return employeeDocuments(e, today)[0] ?? null;
}

/** "First Last", trimmed; the Arabic name leads on an Arabic page when there is one. */
export function employeeName(
  e: { first_name: string; last_name: string | null; name_ar?: string | null },
  language: "en" | "ar" = "en",
): string {
  if (language === "ar" && e.name_ar) return e.name_ar;
  return [e.first_name, e.last_name].filter(Boolean).join(" ").trim();
}

/** Monthly package: basic plus every allowance; null when no part is set. */
export function monthlyPackage(e: {
  basic_salary: number | null;
  housing_allowance: number | null;
  transport_allowance: number | null;
  other_allowance: number | null;
}): number | null {
  const parts = [e.basic_salary, e.housing_allowance, e.transport_allowance, e.other_allowance];
  if (parts.every((p) => p == null)) return null;
  return parts.reduce<number>((sum, p) => sum + Number(p ?? 0), 0);
}

/** Completed years of service at `today` (0 before the first anniversary). */
export function yearsOfService(hireDate: string | null, today: string, endDate?: string | null): number | null {
  if (!hireDate) return null;
  const end = endDate && endDate < today ? endDate : today;
  const [hy, hm, hd] = hireDate.split("-").map(Number);
  const [ty, tm, td] = end.split("-").map(Number);
  let years = ty - hy;
  if (tm < hm || (tm === hm && td < hd)) years -= 1;
  return Math.max(0, years);
}

export interface OrgNode<T> {
  employee: T;
  depth: number;
}

/**
 * Flatten the reporting tree into display order (each manager followed by
 * their reports, depth-first, siblings by name). Employees whose manager is
 * missing — not loaded, terminated and filtered out, or part of a cycle —
 * become roots, so nobody silently disappears from the chart.
 */
export function orgChart<T extends { id: string; manager_id: string | null }>(
  employees: T[],
  nameOf: (e: T) => string,
): OrgNode<T>[] {
  const byId = new Map(employees.map((e) => [e.id, e]));
  const children = new Map<string, T[]>();
  const roots: T[] = [];

  // Walk up from each employee; if we come back to it, the chain is a cycle.
  const inCycle = (e: T): boolean => {
    const seen = new Set<string>([e.id]);
    let cur = e.manager_id ? byId.get(e.manager_id) : undefined;
    while (cur) {
      if (seen.has(cur.id)) return cur.id === e.id || inCycle(cur);
      seen.add(cur.id);
      cur = cur.manager_id ? byId.get(cur.manager_id) : undefined;
    }
    return false;
  };

  for (const e of employees) {
    const parent = e.manager_id ? byId.get(e.manager_id) : undefined;
    if (!parent || inCycle(e)) roots.push(e);
    else children.set(parent.id, [...(children.get(parent.id) ?? []), e]);
  }

  const byName = (a: T, b: T) => nameOf(a).localeCompare(nameOf(b));
  const out: OrgNode<T>[] = [];
  const placed = new Set<string>();
  const visit = (e: T, depth: number) => {
    if (placed.has(e.id)) return;
    placed.add(e.id);
    out.push({ employee: e, depth });
    for (const c of (children.get(e.id) ?? []).sort(byName)) visit(c, depth + 1);
  };
  for (const r of roots.sort(byName)) visit(r, 0);
  // Anything a cycle kept unreachable from a root still gets a row.
  for (const e of [...employees].sort(byName)) visit(e, 0);
  return out;
}
