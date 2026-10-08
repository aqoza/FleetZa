import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Pencil, Trash2, Upload } from "lucide-react";
import { listPage, sanitizeSearch } from "../../lib/db";
import { bdiText } from "../../lib/bidi";
import { daysBetween, EXPIRY_SOON_DAYS, expiryState, formatBytes } from "../../lib/documents";
import { formatDate } from "../../lib/format";
import { useAuth } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useT, useTp } from "../../i18n";
import {
  Badge, Bdi, Button, EmptyState, ErrorState, Input, LoadingState, Ltr, Modal, Pagination, Select,
} from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { DocumentForm } from "./DocumentForm";
import { categoryLabels, entityTypeLabel, expiryMeta, linkTypes } from "./labels";
import { deleteDocument, openDocument, useLinkedNames } from "./storage";
import { DOC_CATEGORIES, type DocumentRow, type LinkType } from "./types";

const PAGE_SIZE = 25;

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "Expires in 12 days" / "Expired 3 days ago" for a document with an expiry. */
export function useExpiryText() {
  const t = useT();
  const tp = useTp();
  return (expiresOn: string, today: string) => {
    const days = daysBetween(today, expiresOn);
    if (days === 0) return t("documents.expiresToday");
    return days > 0 ? tp("documents.expiresIn", days) : tp("documents.expiredAgo", -days);
  };
}

export function ExpiryCell({ expiresOn, today }: { expiresOn: string | null; today: string }) {
  const t = useT();
  const expiryText = useExpiryText();
  const state = expiryState(expiresOn, today);
  if (!expiresOn) return <span className="text-ink-3">{t(expiryMeta.none.labelKey)}</span>;
  return (
    <div className="whitespace-nowrap">
      <div className="text-ink-2">{formatDate(expiresOn)}</div>
      {state !== "ok" ? (
        <Badge tone={expiryMeta[state].tone}>{expiryText(expiresOn, today)}</Badge>
      ) : null}
    </div>
  );
}

export default function DocumentsPage({ mode = "all" }: { mode?: "all" | "expiring" }) {
  const t = useT();
  const tp = useTp();
  const { isManager } = useAuth();
  const { isEnabled } = useModules();
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [link, setLink] = useState("all");
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<DocumentRow | null>(null);
  const [deleting, setDeleting] = useState<DocumentRow | null>(null);
  const [actionError, setActionError] = useState("");
  const today = todayIso();
  const term = sanitizeSearch(search);
  const availableLinks = (Object.keys(linkTypes) as LinkType[]).filter((k) => isEnabled(linkTypes[k].module));

  const { data, isLoading, error } = useQuery({
    queryKey: ["documents", "list", { mode, page, term, category, link, today }],
    queryFn: () =>
      listPage<DocumentRow>("documents", page, PAGE_SIZE, (q) => {
        let f = q;
        if (category !== "all") f = f.eq("category", category);
        if (link === "none") f = f.is("entity_type", null);
        else if (link !== "all") f = f.eq("entity_type", link);
        if (term) {
          // A single-word term also matches a tag exactly (tags is text[]).
          const tagClause = /^[\p{L}\p{N}_-]+$/u.test(term) ? `,tags.cs.{${term}}` : "";
          f = f.or(`name.ilike.%${term}%,description.ilike.%${term}%${tagClause}`);
        }
        if (mode === "expiring") {
          return f.not("expires_on", "is", null).lte("expires_on", addDays(today, EXPIRY_SOON_DAYS)).order("expires_on");
        }
        return f.order("created_at", { ascending: false });
      }),
  });
  const rows = data?.rows ?? [];
  const names = useLinkedNames(rows, isEnabled);

  const open = useMutation({
    mutationFn: ({ doc, download }: { doc: DocumentRow; download: boolean }) => openDocument(doc, download),
    onError: (err) => toast.error(err instanceof Error ? err.message : t("documents.downloadFailed")),
  });

  const remove = useMutation({
    mutationFn: (doc: DocumentRow) => deleteDocument(doc),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["documents"] });
      setDeleting(null);
      setActionError("");
      toast.success(t("toast.deleted"));
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("documents.deleteFailed"));
      setDeleting(null);
    },
  });

  const filtersOn = term !== "" || category !== "all" || link !== "all";

  const linkCell = (d: DocumentRow) => {
    if (!d.entity_type) return <span className="text-ink-3">—</span>;
    const typeLabel = t(entityTypeLabel(d.entity_type));
    const name = d.entity_id ? names.data?.get(`${d.entity_type}:${d.entity_id}`) : undefined;
    const cfg = d.entity_type in linkTypes ? linkTypes[d.entity_type as LinkType] : null;
    return (
      <div>
        <div className="text-xs text-ink-3">{typeLabel}</div>
        {name && cfg && d.entity_id ? (
          <Link to={cfg.href(d.entity_id)} className="text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
            <Bdi>{name}</Bdi>
          </Link>
        ) : null}
      </div>
    );
  };

  const columns: Array<DataTableColumn<DocumentRow>> = [
    {
      id: "name",
      header: t("documents.name"),
      cell: (d) => (
        <div className="flex items-start gap-2">
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
          <div className="min-w-0">
            <button
              type="button"
              className="text-start font-medium text-brand-700 hover:underline"
              onClick={() => open.mutate({ doc: d, download: false })}
            >
              <Bdi>{d.name}</Bdi>
            </button>
            <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-ink-3">
              <span>{t(categoryLabels[d.category] ?? "documents.categoryLabel.other")}</span>
              {d.tags.slice(0, 3).map((tag) => (
                <span key={tag} className="rounded bg-canvas px-1.5 py-0.5 text-ink-2"><Bdi>{tag}</Bdi></span>
              ))}
            </div>
          </div>
        </div>
      ),
      sortValue: (d) => d.name,
      exportValue: (d) => d.name,
    },
    {
      id: "category",
      header: t("documents.category"),
      defaultHidden: true,
      cell: (d) => <span className="text-ink-2">{t(categoryLabels[d.category] ?? "documents.categoryLabel.other")}</span>,
      sortValue: (d) => d.category,
      exportValue: (d) => t(categoryLabels[d.category] ?? "documents.categoryLabel.other"),
    },
    {
      id: "link",
      header: t("documents.linkedTo"),
      minBreakpoint: "md",
      cell: linkCell,
      sortValue: (d) => d.entity_type,
      exportValue: (d) => (d.entity_type ? t(entityTypeLabel(d.entity_type)) : ""),
    },
    {
      id: "expiry",
      header: t("documents.expiry"),
      cell: (d) => <ExpiryCell expiresOn={d.expires_on} today={today} />,
      sortValue: (d) => d.expires_on,
      exportValue: (d) => d.expires_on ?? "",
    },
    {
      id: "size",
      header: t("documents.size"),
      align: "end",
      minBreakpoint: "lg",
      cell: (d) => <span className="tabular-nums text-ink-2"><Ltr>{formatBytes(d.size_bytes)}</Ltr></span>,
      sortValue: (d) => d.size_bytes,
      exportValue: (d) => d.size_bytes ?? "",
    },
    {
      id: "uploaded",
      header: t("documents.uploaded"),
      minBreakpoint: "lg",
      cell: (d) => <span className="text-ink-2">{formatDate(d.created_at)}</span>,
      sortValue: (d) => d.created_at,
      exportValue: (d) => d.created_at,
    },
    {
      id: "actions",
      header: "",
      align: "end",
      cell: (d) => (
        <div className="flex justify-end gap-1">
          <button
            className="rounded p-1.5 text-ink-3 hover:bg-canvas hover:text-ink-2"
            onClick={() => open.mutate({ doc: d, download: true })}
            aria-label={t("documents.download")}
            title={t("documents.download")}
          >
            <Download className="h-4 w-4" />
          </button>
          {isManager && (
            <>
              <button
                className="rounded p-1.5 text-ink-3 hover:bg-canvas hover:text-ink-2"
                onClick={() => setEditing(d)}
                aria-label={t("documents.editTitle")}
                title={t("action.edit")}
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                className="rounded p-1.5 text-ink-3 hover:bg-serious-soft hover:text-serious"
                onClick={() => setDeleting(d)}
                aria-label={t("documents.deleteTitle")}
                title={t("action.delete")}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      {mode === "expiring" && <p className="mb-4 text-sm text-ink-3">{t("documents.expiringHint")}</p>}
      {!isManager && mode === "all" && <p className="mb-4 text-sm text-ink-3">{t("documents.ownOnly")}</p>}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          placeholder={t("documents.search")}
          className="w-full sm:max-w-80"
        />
        <Select value={category} onChange={(e) => { setCategory(e.target.value); setPage(0); }} className="w-full sm:w-auto sm:max-w-44">
          <option value="all">{t("documents.allCategories")}</option>
          {DOC_CATEGORIES.map((c) => (
            <option key={c} value={c}>{t(categoryLabels[c])}</option>
          ))}
        </Select>
        <Select value={link} onChange={(e) => { setLink(e.target.value); setPage(0); }} className="w-full sm:w-auto sm:max-w-44">
          <option value="all">{t("documents.allLinks")}</option>
          <option value="none">{t("documents.unlinked")}</option>
          {availableLinks.map((k) => (
            <option key={k} value={k}>{t(linkTypes[k].labelKey)}</option>
          ))}
        </Select>
        {data && data.total > 0 && (
          <span className="text-sm text-ink-3">{tp("documents.count", data.total)}</span>
        )}
        {isManager && (
          <div className="ms-auto">
            <Button onClick={() => setAdding(true)}>
              <Upload className="h-4 w-4" /> {t("documents.upload")}
            </Button>
          </div>
        )}
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}
      {actionError && (
        <div className="mb-4">
          <ErrorState message={actionError} />
        </div>
      )}
      {!isLoading && !error && (
        <DataTable<DocumentRow>
          tableId={mode === "expiring" ? "documents-expiring" : "documents"}
          exportName={mode === "expiring" ? "expiring-documents" : "documents"}
          rows={rows}
          rowKey={(d) => d.id}
          columns={columns}
          empty={
            mode === "expiring" && !filtersOn ? (
              <EmptyState
                icon={<FileText className="h-10 w-10" />}
                title={t("documents.expiringEmptyTitle")}
                description={t("documents.expiringEmptyDesc")}
              />
            ) : (
              <EmptyState
                icon={<FileText className="h-10 w-10" />}
                title={filtersOn ? t("documents.emptyFilteredTitle") : t("documents.emptyTitle")}
                description={filtersOn ? t("documents.emptyFilteredDesc") : t("documents.emptyDesc")}
                action={
                  isManager && !filtersOn ? (
                    <Button onClick={() => setAdding(true)}>
                      <Upload className="h-4 w-4" /> {t("documents.upload")}
                    </Button>
                  ) : undefined
                }
              />
            )
          }
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={setPage} />}
        />
      )}

      <Modal title={t("documents.uploadTitle")} open={adding} onClose={() => setAdding(false)} wide>
        {adding && <DocumentForm onDone={() => setAdding(false)} onCancel={() => setAdding(false)} />}
      </Modal>
      <Modal title={t("documents.editTitle")} open={!!editing} onClose={() => setEditing(null)} wide>
        {editing && <DocumentForm document={editing} onDone={() => setEditing(null)} onCancel={() => setEditing(null)} />}
      </Modal>
      <Modal title={t("documents.deleteTitle")} open={!!deleting} onClose={() => setDeleting(null)}>
        {deleting && (
          <>
            <p className="text-sm text-ink-2">{t("documents.deleteConfirm", { name: bdiText(deleting.name) })}</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleting(null)}>{t("action.cancel")}</Button>
              <Button variant="danger" onClick={() => remove.mutate(deleting)} loading={remove.isPending}>
                {t("documents.deleteTitle")}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
