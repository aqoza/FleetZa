import { useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { insertRow, listRows } from "../../lib/db";
import { displayToKm, kmToDisplay } from "../../lib/format";
import type {
  Driver, Inspection, InspectionItem, InspectionResult, InspectionTemplate, Issue, Vehicle,
} from "../../lib/types";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT, type MessageKey } from "../../i18n";
import {
  Button, Card, ErrorState, Field, Input, LoadingState, PageHeader, Select, Textarea,
} from "../../components/ui";

type ResultValue = InspectionResult["result"];

const resultOptions: Array<{ value: ResultValue; labelKey: MessageKey; selected: string }> = [
  { value: "pass", labelKey: "inspections.resultPass", selected: "border-emerald-600 bg-emerald-600 text-white" },
  { value: "fail", labelKey: "inspections.resultFail", selected: "border-red-600 bg-red-600 text-white" },
  { value: "na", labelKey: "inspections.resultNa", selected: "border-slate-500 bg-slate-500 text-white" },
];

export default function NewInspectionPage() {
  const t = useT();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [vehicleId, setVehicleId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [odometer, setOdometer] = useState("");
  const [notes, setNotes] = useState("");
  const [answers, setAnswers] = useState<Record<string, { result: ResultValue; note: string }>>({});
  const [error, setError] = useState("");

  // Idempotent-retry bookkeeping: if a submit fails partway through, a resubmit
  // must not re-insert the inspection or issues that already succeeded.
  const createdInspectionId = useRef<string | null>(null);
  const insertedIssueItemIds = useRef<Set<string>>(new Set());

  const { data: vehicles, isLoading: vehiclesLoading } = useQuery({
    queryKey: ["vehicles", { status: "active" }],
    queryFn: () => listRows<Vehicle>("vehicles", (q) => q.eq("status", "active").order("name")),
  });

  const { data: templates, isLoading: templatesLoading } = useQuery({
    queryKey: ["inspection_templates"],
    queryFn: () => listRows<InspectionTemplate>("inspection_templates", (q) => q.eq("active", true)),
  });

  const { data: drivers } = useQuery({
    queryKey: ["drivers", { status: "active" }],
    queryFn: () => listRows<Driver>("drivers", (q) => q.eq("status", "active").order("first_name")),
  });

  const effectiveTemplateId = templateId || templates?.[0]?.id || "";
  const template = templates?.find((t) => t.id === effectiveTemplateId);

  const grouped = useMemo(() => {
    const map = new Map<string, InspectionItem[]>();
    for (const item of template?.items ?? []) {
      const section = item.section ?? t("inspections.generalSection");
      const existing = map.get(section);
      if (existing) existing.push(item);
      else map.set(section, [item]);
    }
    return [...map.entries()];
  }, [template, t]);

  const failCount =
    template?.items.filter((it) => (answers[it.id]?.result ?? "pass") === "fail").length ?? 0;

  function onVehicleChange(id: string) {
    setVehicleId(id);
    createdInspectionId.current = null;
    insertedIssueItemIds.current = new Set();
    const v = vehicles?.find((x) => x.id === id);
    setOdometer(v ? Math.round(kmToDisplay(v.odometer, tenant.distance_unit)).toString() : "");
  }

  function onTemplateChange(id: string) {
    setTemplateId(id);
    createdInspectionId.current = null;
    insertedIssueItemIds.current = new Set();
    setAnswers({});
  }

  function setResult(itemId: string, result: ResultValue) {
    setAnswers((a) => ({ ...a, [itemId]: { result, note: a[itemId]?.note ?? "" } }));
  }

  function setNote(itemId: string, note: string) {
    setAnswers((a) => ({ ...a, [itemId]: { result: a[itemId]?.result ?? "pass", note } }));
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!vehicleId) throw new Error(t("inspections.selectVehicleError"));
      const results: InspectionResult[] = (template?.items ?? []).map((item) => {
        const a = answers[item.id];
        const result = a?.result ?? "pass";
        const note = a?.note.trim();
        return {
          item_id: item.id,
          label: item.label,
          result,
          ...(result === "fail" && note ? { note } : {}),
        };
      });
      const status = results.some((r) => r.result === "fail") ? "fail" : "pass";
      let inspectionId = createdInspectionId.current;
      if (!inspectionId) {
        const created = await insertRow<Inspection>("inspections", {
          vehicle_id: vehicleId,
          driver_id: driverId || null,
          template_id: template?.id ?? null,
          performed_at: new Date().toISOString(),
          odometer:
            odometer.trim() === ""
              ? null
              : displayToKm(Number(odometer) || 0, tenant.distance_unit),
          status,
          results,
          notes: notes.trim() || null,
        });
        createdInspectionId.current = created.id;
        inspectionId = created.id;
      }
      await Promise.all(
        results
          .filter((r) => r.result === "fail" && !insertedIssueItemIds.current.has(r.item_id))
          .map(async (r) => {
            await insertRow<Issue>("issues", {
              vehicle_id: vehicleId,
              title: t("inspections.failedInspectionTitle", { item: r.label }),
              description: r.note || null,
              priority: "high",
              source: "inspection",
              inspection_id: inspectionId,
            });
            insertedIssueItemIds.current.add(r.item_id);
          }),
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["inspections"] });
      void qc.invalidateQueries({ queryKey: ["issues"] });
      void qc.invalidateQueries({ queryKey: ["vehicles"] });
      void qc.invalidateQueries({ queryKey: ["vehicles", { status: "active" }] });
      void qc.invalidateQueries({ queryKey: ["service_reminders"] });
      navigate("/inspections");
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("inspections.saveFailed")),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    mutation.mutate();
  }

  const loading = vehiclesLoading || templatesLoading;

  return (
    <>
      <Link
        to="/inspections"
        className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> {t("inspections.title")}
      </Link>
      <PageHeader
        title={t("inspections.new")}
        description={t("inspections.newDescription")}
      />

      {!isManager && <ErrorState message={t("inspections.onlyManagers")} />}

      {isManager && loading && <LoadingState />}

      {isManager && !loading && (
        <form onSubmit={onSubmit} className="max-w-3xl space-y-4">
          {error && <ErrorState message={error} />}

          <Card className="p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("field.vehicle")} required>
                <Select
                  value={vehicleId}
                  onChange={(e) => onVehicleChange(e.target.value)}
                  required
                >
                  <option value="">{t("inspections.selectVehicle")}</option>
                  {vehicles?.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t("inspections.template")}>
                <Select
                  value={effectiveTemplateId}
                  onChange={(e) => onTemplateChange(e.target.value)}
                >
                  {templates?.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t("field.driver")}>
                <Select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                  <option value="">{t("inspections.noDriver")}</option>
                  {drivers?.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.first_name} {d.last_name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={`${t("field.odometer")} (${tenant.distance_unit})`}>
                <Input
                  type="number" min={0} step="1"
                  value={odometer}
                  onChange={(e) => setOdometer(e.target.value)}
                />
              </Field>
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">{t("inspections.checklist")}</h3>
            {grouped.length === 0 && (
              <p className="text-sm text-slate-500">
                {t("inspections.noTemplate")}
              </p>
            )}
            {grouped.map(([section, items]) => (
              <div key={section} className="mb-4 last:mb-0">
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {section}
                </h4>
                <ul className="divide-y divide-slate-100">
                  {items.map((item) => {
                    const a = answers[item.id] ?? { result: "pass" as ResultValue, note: "" };
                    return (
                      <li key={item.id} className="py-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm text-slate-700">{item.label}</span>
                          <div className="flex shrink-0 gap-1">
                            {resultOptions.map((o) => (
                              <button
                                key={o.value}
                                type="button"
                                onClick={() => setResult(item.id, o.value)}
                                className={
                                  "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors " +
                                  (a.result === o.value
                                    ? o.selected
                                    : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50")
                                }
                              >
                                {t(o.labelKey)}
                              </button>
                            ))}
                          </div>
                        </div>
                        {a.result === "fail" && (
                          <Input
                            className="mt-2"
                            placeholder={t("inspections.whatsWrong")}
                            value={a.note}
                            onChange={(e) => setNote(item.id, e.target.value)}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </Card>

          <Card className="p-5">
            <Field label={t("inspections.generalNotes")}>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </Card>

          <div className="flex items-center justify-end gap-3">
            {failCount > 0 && (
              <span className="me-auto text-sm text-red-600">
                {t(
                  failCount === 1
                    ? "inspections.failedItemWarning"
                    : "inspections.failedItemsWarning",
                  { count: failCount },
                )}
              </span>
            )}
            <Button type="button" variant="secondary" onClick={() => navigate("/inspections")}>
              {t("action.cancel")}
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              {t("inspections.save")}
            </Button>
          </div>
        </form>
      )}
    </>
  );
}
