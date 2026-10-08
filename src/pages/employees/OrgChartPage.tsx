import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Network } from "lucide-react";
import { listRows } from "../../lib/db";
import { employeeName, orgChart } from "../../lib/employees";
import { useI18n, useT } from "../../i18n";
import { Bdi, Card, EmptyState, ErrorState, LoadingState } from "../../components/ui";
import type { Employee } from "./types";

type OrgRow = Pick<Employee, "id" | "first_name" | "last_name" | "name_ar" | "job_title" | "manager_id" | "doc_number">;

/** The chart is read whole; past this it wants a department filter, not a longer page. */
const ORG_CAP = 1000;

export default function OrgChartPage() {
  const t = useT();
  const { language } = useI18n();

  const { data, isLoading, error } = useQuery({
    queryKey: ["employees", "org"],
    queryFn: () =>
      listRows<OrgRow>("employees", (q) =>
        q
          .select("id, first_name, last_name, name_ar, job_title, manager_id, doc_number")
          .neq("status", "terminated")
          .order("first_name")
          .limit(ORG_CAP),
      ),
  });

  const rows = useMemo(() => orgChart(data ?? [], (e) => employeeName(e, language)), [data, language]);

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={(error as Error).message} />;
  if (rows.length === 0) {
    return <EmptyState icon={<Network className="h-10 w-10" />} title={t("employees.orgEmpty")} />;
  }

  return (
    <Card className="p-5">
      <p className="mb-3 text-xs text-ink-3">{t("employees.orgHint")}</p>
      <ul className="space-y-1">
        {rows.map(({ employee: e, depth }) => (
          <li
            key={e.id}
            // Indent with logical padding so the tree mirrors on Arabic pages.
            style={{ paddingInlineStart: `${depth * 1.5}rem` }}
          >
            <div
              className={`flex flex-wrap items-baseline gap-x-2 rounded-lg px-2 py-1.5 hover:bg-canvas ${
                depth > 0 ? "border-s-2 border-line" : ""
              }`}
            >
              <Link to={`/employees/${e.id}`} className="text-sm font-medium text-brand-700 hover:underline">
                <Bdi>{employeeName(e, language)}</Bdi>
              </Link>
              {e.job_title && <span className="text-xs text-ink-3"><Bdi>{e.job_title}</Bdi></span>}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
