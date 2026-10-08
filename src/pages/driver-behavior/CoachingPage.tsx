import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GraduationCap, Pencil, Plus, Trash2 } from "lucide-react";
import { deleteRow, listPage } from "../../lib/db";
import { useDriverPicker } from "../../lib/pickers";
import { formatDate } from "../../lib/format";
import { useAuth } from "../../context/AuthContext";
import { useT, useTp } from "../../i18n";
import { Badge, Bdi, Button, EmptyState, ErrorState, LoadingState, Modal, Pagination, Select } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { CoachingForm } from "./CoachingForm";
import { personName, statusTone, topicKey } from "./labels";
import { SESSION_SELECT, type CoachingSession, type CoachingStatus } from "./types";

const PAGE_SIZE = 25;
const STATUSES: CoachingStatus[] = ["scheduled", "completed", "canceled"];

/** Coaching sessions. With `driverId` it is that driver's history (driver detail page). */
export function CoachingList({ driverId }: { driverId?: string }) {
  const t = useT();
  const tp = useTp();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState("all");
  const [driver, setDriver] = useState("");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<CoachingSession | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<CoachingSession | null>(null);
  const [actionError, setActionError] = useState("");
  const driverPicker = useDriverPicker(driver);
  const driverFilter = driverId ?? driver;

  const listQ = useQuery({
    queryKey: ["driver_coaching_sessions", { page, status, driver: driverFilter }],
    queryFn: () =>
      listPage<CoachingSession>("driver_coaching_sessions", page, PAGE_SIZE, (q) => {
        let f = q.select(SESSION_SELECT);
        if (status !== "all") f = f.eq("status", status);
        if (driverFilter) f = f.eq("driver_id", driverFilter);
        return f.order("session_date", { ascending: false }).order("created_at", { ascending: false });
      }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteRow("driver_coaching_sessions", id),
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["driver_coaching_sessions"] });
      setDeleting(null);
      toast.success(t("toast.deleted"));
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("common.error"));
      setDeleting(null);
    },
  });

  const columns: Array<DataTableColumn<CoachingSession>> = [
    {
      id: "date",
      header: t("driverBehavior.col.date"),
      cell: (s) => <span className="whitespace-nowrap text-ink-2">{formatDate(s.session_date)}</span>,
      sortValue: (s) => s.session_date,
      exportValue: (s) => s.session_date,
    },
    ...(driverId
      ? []
      : [
          {
            id: "driver",
            header: t("driverBehavior.col.driver"),
            cell: (s) => (
              <Link to={`/driver-behavior/drivers/${s.driver_id}`} className="font-medium text-brand-700 hover:underline">
                <Bdi>{personName(s.driver)}</Bdi>
              </Link>
            ),
            sortValue: (s) => personName(s.driver),
            exportValue: (s) => personName(s.driver),
          } satisfies DataTableColumn<CoachingSession>,
        ]),
    {
      id: "coach",
      header: t("driverBehavior.col.coach"),
      minBreakpoint: "sm",
      cell: (s) => <Bdi className="text-ink-2">{s.coach ? s.coach.full_name || s.coach.email : "—"}</Bdi>,
      sortValue: (s) => s.coach?.full_name ?? null,
      exportValue: (s) => s.coach?.full_name ?? "",
    },
    {
      id: "topics",
      header: t("driverBehavior.col.topics"),
      minBreakpoint: "md",
      cell: (s) => (
        <div className="min-w-0">
          <div className="text-ink-2">{s.topics.map((x) => t(topicKey(x))).join(t("common.listSeparator")) || "—"}</div>
          {s.event_ids.length > 0 && (
            <div className="text-xs text-ink-3">{tp("driverBehavior.linkedEvents", s.event_ids.length)}</div>
          )}
        </div>
      ),
      exportValue: (s) => s.topics.join(" "),
    },
    {
      id: "status",
      header: t("driverBehavior.col.status"),
      cell: (s) => <Badge tone={statusTone[s.status]}>{t(`driverBehavior.status.${s.status}`)}</Badge>,
      sortValue: (s) => s.status,
      exportValue: (s) => s.status,
    },
    {
      id: "followUp",
      header: t("driverBehavior.col.followUp"),
      minBreakpoint: "lg",
      cell: (s) => <span className="whitespace-nowrap text-ink-2">{s.follow_up_date ? formatDate(s.follow_up_date) : "—"}</span>,
      sortValue: (s) => s.follow_up_date,
      exportValue: (s) => s.follow_up_date ?? "",
    },
    ...(isManager
      ? [
          {
            id: "actions",
            header: "",
            align: "end",
            cell: (s) => (
              <div className="flex justify-end gap-1">
                <button
                  className="rounded p-1.5 text-ink-3 hover:bg-canvas hover:text-ink"
                  onClick={() => setEditing(s)}
                  aria-label={t("driverBehavior.editSession")}
                  title={t("action.edit")}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  className="rounded p-1.5 text-ink-3 hover:bg-serious-soft hover:text-serious"
                  onClick={() => setDeleting(s)}
                  aria-label={t("driverBehavior.deleteSession")}
                  title={t("action.delete")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ),
          } satisfies DataTableColumn<CoachingSession>,
        ]
      : []),
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
          className="max-w-44"
        >
          <option value="all">{t("driverBehavior.allStatuses")}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{t(`driverBehavior.status.${s}`)}</option>
          ))}
        </Select>
        {!driverId && (
          <div className="w-full max-w-56">
            <Combobox
              {...driverPicker}
              placeholder={t("driverBehavior.allDrivers")}
              value={driver}
              onChange={(v) => {
                setDriver(v);
                setPage(0);
              }}
            />
          </div>
        )}
        {isManager && (
          <Button className="ms-auto" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> {t("driverBehavior.addSession")}
          </Button>
        )}
      </div>
      {actionError && (
        <div className="mb-3">
          <ErrorState message={actionError} />
        </div>
      )}
      {listQ.isLoading && <LoadingState />}
      {listQ.error && <ErrorState message={(listQ.error as Error).message} />}
      {listQ.data && (
        <DataTable<CoachingSession>
          tableId={driverId ? "driver-coaching" : "coaching-sessions"}
          exportName="coaching-sessions"
          rows={listQ.data.rows}
          rowKey={(s) => s.id}
          columns={columns}
          empty={
            <EmptyState
              icon={<GraduationCap className="h-10 w-10" />}
              title={t("driverBehavior.coachingEmpty")}
              description={t("driverBehavior.coachingEmptyHint")}
            />
          }
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={listQ.data.total} onPage={setPage} />}
        />
      )}

      {(adding || editing) && (
        <CoachingForm
          open
          session={editing}
          driverId={driverId}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      )}

      <Modal title={t("driverBehavior.deleteSession")} open={!!deleting} onClose={() => setDeleting(null)}>
        {deleting && (
          <>
            <p className="text-sm text-ink-2">{t("driverBehavior.confirmDeleteSession")}</p>
            <p className="mt-2 text-xs text-ink-3">
              <Bdi>{personName(deleting.driver)}</Bdi> · {formatDate(deleting.session_date)}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleting(null)}>{t("action.cancel")}</Button>
              <Button variant="danger" onClick={() => remove.mutate(deleting.id)} loading={remove.isPending}>
                {t("driverBehavior.deleteSession")}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

export default function CoachingPage() {
  return <CoachingList />;
}
