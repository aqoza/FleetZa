import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Pencil } from "lucide-react";
import { getRow, listPage } from "../../lib/db";
import type { TableName } from "../../lib/db";
import { useAuth } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useI18n, useT, useTp } from "../../i18n";
import { Badge, Bdi, Button, Card, ErrorState, LoadingState, Ltr, Modal, PageHeader } from "../../components/ui";
import { BranchForm } from "./BranchForm";
import { branchLabel } from "./BranchesPage";
import { useCompanies } from "./hooks";
import type { Branch } from "./types";

const PREVIEW = 10;

interface Member {
  id: string;
  label: string;
  meta?: string | null;
}

/** First few records of one kind assigned to the branch, with a count of the rest. */
function MemberList({
  title,
  table,
  branchId,
  select,
  order,
  toMember,
  href,
}: {
  title: string;
  table: TableName;
  branchId: string;
  select: string;
  order: string;
  toMember: (row: Record<string, unknown>) => Member;
  href: (id: string) => string;
}) {
  const t = useT();
  const tp = useTp();
  const { data, isLoading, error } = useQuery({
    queryKey: ["branches", "members", table, branchId],
    queryFn: () =>
      listPage<Record<string, unknown>>(table, 0, PREVIEW, (q) => q.select(select).eq("branch_id", branchId).order(order)),
  });
  const rows = (data?.rows ?? []).map(toMember);
  const rest = (data?.total ?? 0) - rows.length;

  return (
    <Card className="p-5">
      <h3 className="mb-2 text-sm font-semibold text-ink">
        {title}
        {data && data.total > 0 && <span className="ms-2 font-normal text-ink-3"><Ltr>{data.total}</Ltr></span>}
      </h3>
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={(error as Error).message} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-3">{t("companies.nothingHere")}</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
              <Link to={href(m.id)} className="truncate text-brand-700 hover:underline"><Bdi>{m.label}</Bdi></Link>
              {m.meta && <span className="shrink-0 text-xs text-ink-3"><Ltr>{m.meta}</Ltr></span>}
            </li>
          ))}
          {rest > 0 && <li className="text-xs text-ink-3">{tp("companies.andMore", rest)}</li>}
        </ul>
      )}
    </Card>
  );
}

export default function BranchDetailPage() {
  const { branchId = "" } = useParams();
  const t = useT();
  const { language } = useI18n();
  const { isManager } = useAuth();
  const { isEnabled } = useModules();
  const [editing, setEditing] = useState(false);
  const companiesQ = useCompanies();

  const branchQ = useQuery({
    queryKey: ["branches", "one", branchId],
    queryFn: () => getRow<Branch>("branches", branchId),
  });

  if (branchQ.isLoading) return <LoadingState />;
  if (branchQ.error) return <ErrorState message={(branchQ.error as Error).message} />;
  const branch = branchQ.data;
  if (!branch) return <ErrorState message={t("companies.branchNotFound")} />;

  const company = (companiesQ.data ?? []).find((c) => c.id === branch.company_id);
  const row = (label: string, value: ReactNode) => (
    <div className="flex justify-between gap-3 py-1.5 text-sm">
      <span className="text-ink-3">{label}</span>
      <span className="text-end text-ink">{value || "—"}</span>
    </div>
  );
  const person = (r: Record<string, unknown>) => `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim();

  return (
    <>
      <Link to="/companies/branches" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink-2">
        <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> {t("companies.tab.branches")}
      </Link>
      <PageHeader
        title={branchLabel(branch, language)}
        description={[branch.code, branch.city].filter(Boolean).join(" · ") || undefined}
        actions={
          isManager ? (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" /> {t("action.edit")}
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <h3 className="mb-2 text-sm font-semibold text-ink">{t("companies.details")}</h3>
          {row(t("companies.company"), company ? <Bdi>{company.legal_name}</Bdi> : null)}
          {row(t("field.phone"), branch.phone ? <Ltr>{branch.phone}</Ltr> : null)}
          {row(t("companies.city"), branch.city ? <Bdi>{branch.city}</Bdi> : null)}
          {row(t("companies.country"), branch.country ? <Bdi>{branch.country}</Bdi> : null)}
          {row(t("companies.address"), branch.address ? <Bdi>{branch.address}</Bdi> : null)}
          {row(
            t("common.status"),
            branch.active
              ? <Badge tone="green">{t("companies.active")}</Badge>
              : <Badge tone="slate">{t("companies.inactive")}</Badge>,
          )}
          <p className="mt-3 text-xs text-ink-3">{t("companies.assignHint")}</p>
        </Card>
        <MemberList
          title={t("companies.vehicles")}
          table="vehicles"
          branchId={branch.id}
          select="id, name, license_plate"
          order="name"
          toMember={(r) => ({ id: String(r.id), label: String(r.name), meta: r.license_plate as string | null })}
          href={(id) => `/vehicles/${id}`}
        />
        {isEnabled("drivers") && (
          <MemberList
            title={t("companies.drivers")}
            table="drivers"
            branchId={branch.id}
            select="id, first_name, last_name, phone"
            order="first_name"
            toMember={(r) => ({ id: String(r.id), label: person(r), meta: r.phone as string | null })}
            href={() => "/drivers"}
          />
        )}
        {isEnabled("employees") && (
          <MemberList
            title={t("companies.employees")}
            table="employees"
            branchId={branch.id}
            select="id, first_name, last_name, doc_number"
            order="first_name"
            toMember={(r) => ({ id: String(r.id), label: person(r), meta: r.doc_number as string | null })}
            href={(id) => `/employees/${id}`}
          />
        )}
        {isEnabled("inventory") && (
          <MemberList
            title={t("companies.warehouses")}
            table="warehouses"
            branchId={branch.id}
            select="id, name, code"
            order="name"
            toMember={(r) => ({ id: String(r.id), label: String(r.name), meta: r.code as string | null })}
            href={() => "/inventory/warehouses"}
          />
        )}
      </div>

      <Modal title={t("companies.editBranch")} open={editing} onClose={() => setEditing(false)} wide>
        {editing && <BranchForm branch={branch} onDone={() => setEditing(false)} />}
      </Modal>
    </>
  );
}
