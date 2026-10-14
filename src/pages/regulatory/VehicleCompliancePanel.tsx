import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { listRows } from "../../lib/db";
import { formatDate } from "../../lib/format";
import { STATE_ORDER, currentObligations, obligationState } from "../../../shared/regulatory";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useI18n, useT } from "../../i18n";
import { Badge, Bdi, Button, Card, ErrorState, LoadingState, Modal } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { ObligationForm } from "./forms";
import { ObligationDialog, useDueText } from "./ObligationDialog";
import { reqTitle, stateTone, todayIn } from "./labels";
import { OBL_SELECT, type Obligation } from "./types";

/** The vehicle's current compliance obligations, for the vehicle page. */
export function VehicleCompliancePanel({ vehicleId, vehicleName }: { vehicleId: string; vehicleName: string }) {
  const t = useT();
  const { language } = useI18n();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const dueText = useDueText();
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const today = todayIn(tenant.timezone);

  const q = useQuery({
    queryKey: ["compliance_obligations", "vehicle", vehicleId],
    queryFn: () =>
      listRows<Obligation>("compliance_obligations", (b) =>
        b.select(OBL_SELECT).eq("subject_type", "vehicle").eq("subject_id", vehicleId).order("due_date").limit(500)),
  });
  const rows = currentObligations(q.data ?? [])
    .map((o) => ({ o, s: obligationState(o, o.requirement?.lead_days ?? 30, today) }))
    .sort((a, b) => STATE_ORDER.indexOf(a.s) - STATE_ORDER.indexOf(b.s) || a.o.due_date.localeCompare(b.o.due_date));
  const opened = (q.data ?? []).find((o) => o.id === openId) ?? null;

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">{t("regulatory.panel.title")}</h2>
        {isManager && (
          <Button variant="secondary" className="px-2.5 py-1.5" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> {t("regulatory.o.add")}
          </Button>
        )}
      </div>
      {q.isLoading ? <LoadingState /> : q.error ? <ErrorState message={(q.error as Error).message} /> : rows.length === 0 ? (
        <p className="py-3 text-sm text-ink-3">
          {t("regulatory.panel.empty")}{" "}
          <Link to="/regulatory/requirements" className="text-brand-700 hover:underline">{t("regulatory.panel.setup")}</Link>
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map(({ o, s }) => (
            <li key={o.id}>
              <button type="button" onClick={() => setOpenId(o.id)} className="flex w-full items-center gap-3 py-2 text-start hover:bg-canvas">
                <div className="min-w-0 flex-1 truncate text-sm text-ink"><Bdi>{reqTitle(o.requirement, language)}</Bdi></div>
                <div className="shrink-0 text-end">
                  <Badge tone={stateTone[s]}>{t(`regulatory.state.${s}`)}</Badge>
                  <div className="text-xs text-ink-3">
                    {o.status === "pending" || o.status === "non_compliant" ? dueText(o.due_date) : formatDate(o.completed_on ?? o.due_date)}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      <ObligationDialog obligation={opened} subjectName={vehicleName} onClose={() => setOpenId(null)} />
      <Modal title={t("regulatory.o.newTitle")} open={adding} onClose={() => setAdding(false)}>
        {adding && (
          <ObligationForm subject={{ type: "vehicle", id: vehicleId }} onCancel={() => setAdding(false)}
            onDone={() => { setAdding(false); void qc.invalidateQueries({ queryKey: ["compliance_obligations"] }); toast.success(t("regulatory.o.saved")); }} />
        )}
      </Modal>
    </Card>
  );
}
