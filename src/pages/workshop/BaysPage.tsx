import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Warehouse } from "lucide-react";
import { deleteRow, listPage, sanitizeSearch } from "../../lib/db";
import { BAY_TYPES } from "../../../shared/workshop";
import { useAuth } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Badge, Bdi, Button, EmptyState, ErrorState, Input, LoadingState, Ltr, Modal, Pagination } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { BayForm } from "./forms";
import { bayTone } from "./labels";
import { BAY_SELECT, type Bay } from "./types";

const PAGE_SIZE = 25;

export default function BaysPage() {
  const t = useT();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Bay | "new" | null>(null);
  const [deleting, setDeleting] = useState<Bay | null>(null);
  const term = sanitizeSearch(search);

  const listQ = useQuery({
    queryKey: ["workshop_bays", "list", { page, term }],
    queryFn: () =>
      listPage<Bay>("workshop_bays", page, PAGE_SIZE, (q) => {
        let f = q.select(BAY_SELECT);
        if (term) f = f.or(`name.ilike.%${term}%,code.ilike.%${term}%`);
        return f.order("active", { ascending: false }).order("name");
      }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteRow("workshop_bays", id),
    onSuccess: () => {
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ["workshop_bays"] });
      toast.success(t("workshop.bays.deleted"));
    },
    onError: (err) => {
      setDeleting(null);
      toast.error(err instanceof Error ? err.message : t("common.error"));
    },
  });

  const columns: Array<DataTableColumn<Bay>> = [
    {
      id: "name",
      header: t("workshop.bays.col.name"),
      cell: (b) => (
        <div className="min-w-0">
          <Bdi className="font-medium text-ink">{b.name}</Bdi>
          {b.code && <Ltr className="ms-2 text-xs text-ink-3">{b.code}</Ltr>}
        </div>
      ),
      sortValue: (b) => b.name,
      exportValue: (b) => b.name,
    },
    {
      id: "type",
      header: t("workshop.bays.col.type"),
      cell: (b) => <span className="text-ink-2">{t(`workshop.bayType.${b.bay_type}`)}</span>,
      sortValue: (b) => BAY_TYPES.indexOf(b.bay_type),
      exportValue: (b) => b.bay_type,
    },
    {
      id: "status",
      header: t("workshop.bays.col.status"),
      cell: (b) => (
        <div className="flex flex-wrap gap-1">
          <Badge tone={bayTone[b.status]}>{t(`workshop.bayStatus.${b.status}`)}</Badge>
          {!b.active && <Badge tone="slate">{t("workshop.bays.inactive")}</Badge>}
        </div>
      ),
      exportValue: (b) => (b.active ? b.status : "inactive"),
    },
  ];
  if (isManager) {
    columns.push({
      id: "actions",
      header: "",
      align: "end",
      cell: (b) => (
        <Button variant="ghost" aria-label={t("action.delete")} onClick={(e) => { e.stopPropagation(); setDeleting(b); }}>
          <Trash2 className="h-4 w-4" />
        </Button>
      ),
    });
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder={t("workshop.bays.search")} className="w-full sm:max-w-72" />
        <p className="text-xs text-ink-3">{t("workshop.bays.occupiedHint")}</p>
        {isManager && (
          <Button className="ms-auto" onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" /> {t("workshop.bays.new")}
          </Button>
        )}
      </div>
      {listQ.isLoading && <LoadingState />}
      {listQ.error && <ErrorState message={(listQ.error as Error).message} />}
      {listQ.data && (
        <DataTable<Bay>
          tableId="workshop_bays"
          exportName="workshop-bays"
          rows={listQ.data.rows}
          rowKey={(b) => b.id}
          columns={columns}
          onRowClick={isManager ? (b) => setEditing(b) : undefined}
          empty={<EmptyState icon={<Warehouse className="h-10 w-10" />} title={t("workshop.bays.empty")} description={t("workshop.bays.emptyHint")} />}
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={listQ.data.total} onPage={setPage} />}
        />
      )}
      <Modal title={editing === "new" ? t("workshop.bays.newTitle") : t("workshop.bays.editTitle")} open={editing != null} onClose={() => setEditing(null)}>
        {editing != null && (
          <BayForm bay={editing === "new" ? undefined : editing} onCancel={() => setEditing(null)}
            onDone={() => { setEditing(null); void qc.invalidateQueries({ queryKey: ["workshop_bays"] }); toast.success(t("workshop.bays.saved")); }} />
        )}
      </Modal>
      <Modal title={t("action.delete")} open={deleting != null} onClose={() => setDeleting(null)}>
        <p className="text-sm text-ink-2">{t("workshop.bays.deleteConfirm", { name: deleting?.name ?? "" })}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setDeleting(null)}>{t("action.cancel")}</Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => deleting && remove.mutate(deleting.id)}>{t("action.delete")}</Button>
        </div>
      </Modal>
    </div>
  );
}
