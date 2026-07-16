import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck } from "lucide-react";
import { listRows } from "../../lib/db";
import { formatDateTime } from "../../lib/format";
import type { Inspection, InspectionResult } from "../../lib/types";
import { useAuth, useTenant } from "../../context/AuthContext";
import {
  Badge, EmptyState, ErrorState, LoadingState, Modal, PageHeader, Table, type BadgeTone,
} from "../../components/ui";

type InspectionRow = Inspection & { vehicles: { name: string } | null };

const resultBadge: Record<InspectionResult["result"], { label: string; tone: BadgeTone }> = {
  pass: { label: "Pass", tone: "green" },
  fail: { label: "Fail", tone: "red" },
  na: { label: "N/A", tone: "slate" },
};

function NewInspectionLink() {
  return (
    <Link
      to="/inspections/new"
      className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
    >
      <ClipboardCheck className="h-4 w-4" /> New inspection
    </Link>
  );
}

export default function InspectionsPage() {
  const tenant = useTenant();
  const { isManager } = useAuth();
  const [viewing, setViewing] = useState<InspectionRow | null>(null);

  const { data: inspections, isLoading, error } = useQuery({
    queryKey: ["inspections"],
    queryFn: () =>
      listRows<InspectionRow>("inspections", (q) =>
        q.select("*, vehicles(name)").order("performed_at", { ascending: false }),
      ),
  });

  return (
    <>
      <PageHeader
        title="Inspections"
        description={`${inspections?.length ?? 0} inspections recorded`}
        actions={isManager && <NewInspectionLink />}
      />

      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}

      {!isLoading && !error && !inspections?.length && (
        <EmptyState
          icon={<ClipboardCheck className="h-10 w-10" />}
          title="No inspections yet"
          description="Run your first inspection to record vehicle condition and catch problems early."
          action={isManager ? <NewInspectionLink /> : undefined}
        />
      )}

      {!isLoading && !error && !!inspections?.length && (
        <Table headers={["Date", "Vehicle", "Result", "Failed items", "Notes"]}>
          {inspections.map((i) => {
            const failed = i.results.filter((r) => r.result === "fail").length;
            return (
              <tr
                key={i.id}
                className="cursor-pointer hover:bg-slate-50"
                onClick={() => setViewing(i)}
              >
                <td className="px-4 py-3 text-slate-600">
                  {formatDateTime(i.performed_at, tenant.timezone)}
                </td>
                <td className="px-4 py-3 font-medium">
                  <button
                    type="button"
                    onClick={() => setViewing(i)}
                    aria-label={`View inspection details for ${i.vehicles?.name ?? "unknown vehicle"}, ${formatDateTime(i.performed_at, tenant.timezone)}`}
                    className="font-medium text-brand-700 hover:underline"
                  >
                    {i.vehicles?.name ?? "—"}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <Badge tone={i.status === "pass" ? "green" : "red"}>
                    {i.status === "pass" ? "Pass" : "Fail"}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  {failed > 0 ? (
                    <span className="font-medium text-red-600">{failed}</span>
                  ) : (
                    <span className="text-slate-500">0</span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-500">
                  <div className="max-w-xs truncate">{i.notes ?? "—"}</div>
                </td>
              </tr>
            );
          })}
        </Table>
      )}

      <Modal title="Inspection details" open={!!viewing} onClose={() => setViewing(null)} wide>
        {viewing && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium text-slate-800">
                  {viewing.vehicles?.name ?? "—"}
                </div>
                <div className="text-xs text-slate-500">
                  {formatDateTime(viewing.performed_at, tenant.timezone)}
                </div>
              </div>
              <Badge tone={viewing.status === "pass" ? "green" : "red"}>
                {viewing.status === "pass" ? "Pass" : "Fail"}
              </Badge>
            </div>

            <ul className="divide-y divide-slate-100">
              {viewing.results.map((r) => (
                <li key={r.item_id} className="flex items-start justify-between gap-3 py-2">
                  <div>
                    <div className="text-sm text-slate-700">{r.label}</div>
                    {r.note && <div className="mt-0.5 text-xs text-slate-500">{r.note}</div>}
                  </div>
                  <Badge tone={resultBadge[r.result].tone}>{resultBadge[r.result].label}</Badge>
                </li>
              ))}
            </ul>

            {viewing.notes && (
              <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{viewing.notes}</p>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
