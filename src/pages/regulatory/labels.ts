import { useQuery } from "@tanstack/react-query";
import { listRows } from "../../lib/db";
import type { BadgeTone } from "../../components/ui";
import type { Language } from "../../i18n";
import type { ObligationState, SubjectType } from "../../../shared/regulatory";

export const stateTone: Record<ObligationState, BadgeTone> = {
  overdue: "red",
  non_compliant: "red",
  due_soon: "yellow",
  upcoming: "blue",
  compliant: "green",
  waived: "slate",
};

/** The requirement's title in the UI language, falling back to English. */
export function reqTitle(r: { title: string; title_ar: string | null } | null | undefined, language: Language): string {
  if (!r) return "";
  return language === "ar" && r.title_ar ? r.title_ar : r.title;
}

export function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function subjectHref(type: SubjectType, id: string | null): string | null {
  if (!id) return null;
  if (type === "vehicle") return `/vehicles/${id}`;
  if (type === "employee") return `/employees/${id}`;
  return null;
}

type Named = { id: string; name: string };

/**
 * Display names for the polymorphic subjects on a page of obligations: one
 * query per subject type, only for the ids present.
 */
export function useSubjectNames(rows: ReadonlyArray<{ subject_type: SubjectType; subject_id: string | null }>) {
  const ids = (type: SubjectType) =>
    [...new Set(rows.filter((r) => r.subject_type === type && r.subject_id).map((r) => r.subject_id as string))].sort();
  const vehicleIds = ids("vehicle");
  const driverIds = ids("driver");
  const employeeIds = ids("employee");

  const vehiclesQ = useQuery({
    queryKey: ["vehicles", "names", vehicleIds],
    enabled: vehicleIds.length > 0,
    queryFn: async () =>
      (await listRows<{ id: string; name: string; license_plate: string | null }>("vehicles", (q) =>
        q.select("id, name, license_plate").in("id", vehicleIds))).map((v): Named & { meta: string | null } => ({ id: v.id, name: v.name, meta: v.license_plate })),
  });
  const driversQ = useQuery({
    queryKey: ["drivers", "names", driverIds],
    enabled: driverIds.length > 0,
    queryFn: async () =>
      (await listRows<{ id: string; first_name: string; last_name: string }>("drivers", (q) =>
        q.select("id, first_name, last_name").in("id", driverIds))).map((d) => ({ id: d.id, name: `${d.first_name} ${d.last_name}`.trim(), meta: null })),
  });
  const employeesQ = useQuery({
    queryKey: ["employees", "names", employeeIds],
    enabled: employeeIds.length > 0,
    queryFn: async () =>
      (await listRows<{ id: string; first_name: string; last_name: string | null; doc_number: string | null }>("employees", (q) =>
        q.select("id, first_name, last_name, doc_number").in("id", employeeIds)))
        .map((e) => ({ id: e.id, name: `${e.first_name} ${e.last_name ?? ""}`.trim(), meta: e.doc_number })),
  });
  const map = new Map<string, { name: string; meta: string | null }>();
  for (const r of [...(vehiclesQ.data ?? []), ...(driversQ.data ?? []), ...(employeesQ.data ?? [])]) map.set(r.id, r);
  return (id: string | null) => (id ? map.get(id) : undefined);
}
