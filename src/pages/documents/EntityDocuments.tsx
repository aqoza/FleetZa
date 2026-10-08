import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FileText, Upload } from "lucide-react";
import { listPage } from "../../lib/db";
import { formatBytes } from "../../lib/documents";
import { useAuth } from "../../context/AuthContext";
import { useT, useTp } from "../../i18n";
import { Bdi, Button, Card, ErrorState, LoadingState, Ltr, Modal } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DocumentForm } from "./DocumentForm";
import { ExpiryCell, todayIso } from "./DocumentsPage";
import { openDocument } from "./storage";
import type { DocumentRow, LinkType } from "./types";

const LIMIT = 10;

/**
 * Documents attached to one record, for that record's own page. Mount it
 * only when the `documents` module is on (the rows are module-gated anyway).
 */
export function EntityDocuments({ type, id, className }: { type: LinkType; id: string; className?: string }) {
  const t = useT();
  const tp = useTp();
  const toast = useToast();
  const { isManager } = useAuth();
  const [adding, setAdding] = useState(false);
  const today = todayIso();

  const { data, isLoading, error } = useQuery({
    queryKey: ["documents", "entity", type, id],
    queryFn: () =>
      listPage<DocumentRow>("documents", 0, LIMIT, (q) =>
        q.eq("entity_type", type).eq("entity_id", id).order("created_at", { ascending: false }),
      ),
  });
  const open = useMutation({
    mutationFn: (doc: DocumentRow) => openDocument(doc),
    onError: (err) => toast.error(err instanceof Error ? err.message : t("documents.downloadFailed")),
  });
  const rows = data?.rows ?? [];

  return (
    <Card className={className ?? "mt-4 p-5"}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">
          {t("documents.panelTitle")}
          {data && data.total > 0 && <span className="ms-2 font-normal text-ink-3">{tp("documents.count", data.total)}</span>}
        </h3>
        {isManager && (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            <Upload className="h-4 w-4" /> {t("documents.upload")}
          </Button>
        )}
      </div>
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={(error as Error).message} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-3">{t("documents.panelEmpty")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((d) => (
            <li key={d.id} className="flex items-start justify-between gap-3 py-2 text-sm">
              <button
                type="button"
                className="flex min-w-0 items-start gap-2 text-start"
                onClick={() => open.mutate(d)}
              >
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-brand-700 hover:underline"><Bdi>{d.name}</Bdi></span>
                  <span className="text-xs text-ink-3"><Ltr>{formatBytes(d.size_bytes)}</Ltr></span>
                </span>
              </button>
              <div className="shrink-0 text-end text-xs">
                <ExpiryCell expiresOn={d.expires_on} today={today} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {data && data.total > LIMIT && (
        <Link to="/documents" className="mt-2 inline-block text-sm font-medium text-brand-700 hover:underline">
          {t("documents.seeAll")}
        </Link>
      )}
      <Modal title={t("documents.uploadTitle")} open={adding} onClose={() => setAdding(false)} wide>
        {adding && (
          <DocumentForm fixedLink={{ type, id }} onDone={() => setAdding(false)} onCancel={() => setAdding(false)} />
        )}
      </Modal>
    </Card>
  );
}
