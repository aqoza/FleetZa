import { Badge } from "../../components/ui";
import { useT, useTp } from "../../i18n";
import type { EmployeeDocument } from "../../lib/employees";
import { documentBucketMeta, documentKinds } from "./labels";

/** Today as `yyyy-mm-dd` in the browser's calendar — what "expires today" means to the reader. */
export function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "Expires in 12 days" / "Expired 3 days ago" / "Expires today". */
export function useDocumentWhen(): (doc: Pick<EmployeeDocument, "days">) => string {
  const t = useT();
  const tp = useTp();
  return ({ days }) =>
    days === 0
      ? t("employees.docExpiresToday")
      : days < 0
        ? tp("employees.docExpiredAgo", -days)
        : tp("employees.docExpiresIn", days);
}

/** Bucket badge for a document; the label says the state, not just the colour. */
export function DocumentBadge({ doc, withKind = false }: { doc: EmployeeDocument; withKind?: boolean }) {
  const t = useT();
  const when = useDocumentWhen();
  if (doc.bucket === "none") return null;
  const meta = documentBucketMeta[doc.bucket];
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" title={when(doc)}>
      {withKind && <span className="text-xs text-ink-2">{t(documentKinds[doc.kind])}</span>}
      <Badge tone={meta.tone}>{doc.bucket === "ok" ? t(meta.labelKey) : when(doc)}</Badge>
    </span>
  );
}
