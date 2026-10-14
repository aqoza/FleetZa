import { useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Pencil } from "lucide-react";
import { getRow, listPage, listRows } from "../../lib/db";
import { accumulatedDepreciation, bookValue, disposalResult, yearlySchedule } from "../../lib/depreciation";
import { bdiText } from "../../lib/bidi";
import { formatDate, formatDateTime, formatMoney } from "../../lib/format";
import { employeeName } from "../../lib/employees";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useI18n, useT } from "../../i18n";
import {
  Badge, Bdi, Button, Card, ErrorState, LoadingState, Ltr, Modal, PageHeader, Pagination, Table,
} from "../../components/ui";
import { useWarehouses } from "../inventory/hooks";
import { AssetForm } from "./AssetForm";
import { AssetActionModal, type AssetAction } from "./AssetActions";
import { WarrantyBadge } from "./shared";
import { categories, currencyDecimals, depreciationInput, eventTypes, methods, statuses, todayIso } from "./labels";
import { ASSET_SELECT, EVENT_SELECT, type Asset, type AssetEvent } from "./types";

const PAGE_SIZE = 15;

export default function AssetDetailPage() {
  const { assetId = "" } = useParams();
  const t = useT();
  const { language } = useI18n();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const { isEnabled } = useModules();
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState<AssetAction | null>(null);
  const [page, setPage] = useState(0);
  const warehousesQ = useWarehouses();

  const assetQ = useQuery({
    queryKey: ["assets", "one", assetId],
    queryFn: async () =>
      (await listRows<Asset>("assets", (q) => q.select(ASSET_SELECT).eq("id", assetId).limit(1)))[0] ?? null,
  });
  const eventsQ = useQuery({
    queryKey: ["asset_events", assetId, page],
    queryFn: () =>
      listPage<AssetEvent>("asset_events", page, PAGE_SIZE, (q) =>
        q.select(EVENT_SELECT).eq("asset_id", assetId).order("at", { ascending: false }).order("created_at", { ascending: false }),
      ),
  });
  const branchId = assetQ.data?.branch_id ?? null;
  const branchQ = useQuery({
    queryKey: ["branches", "one", branchId],
    queryFn: () => getRow<{ id: string; name: string }>("branches", branchId!),
    enabled: !!branchId && isEnabled("companies"),
  });
  const supplierId = assetQ.data?.supplier_id ?? null;
  const supplierQ = useQuery({
    queryKey: ["suppliers", "one", supplierId],
    queryFn: () => getRow<{ id: string; name: string }>("suppliers", supplierId!),
    enabled: !!supplierId && isEnabled("suppliers"),
  });
  const warehouseName = useMemo(() => {
    const m = new Map((warehousesQ.data ?? []).map((w) => [w.id, w.name]));
    return (id: string | null) => (id ? m.get(id) ?? null : null);
  }, [warehousesQ.data]);

  if (assetQ.isLoading) return <LoadingState />;
  if (assetQ.error) return <ErrorState message={(assetQ.error as Error).message} />;
  const asset = assetQ.data;
  if (!asset) return <ErrorState message={t("assets.notFound")} />;

  const today = todayIso();
  const decimals = currencyDecimals(tenant.currency);
  const input = depreciationInput(asset);
  const schedule = yearlySchedule(input, decimals);
  const disposed = asset.status === "disposed";
  const money = (v: number | null | undefined) => (v != null ? formatMoney(v, tenant.currency) : "—");
  const date = (d: string | null) => (d ? formatDate(d, tenant.timezone) : "—");
  const assigned = !!(asset.assigned_employee_id || asset.assigned_vehicle_id);
  const canAct = isManager && !disposed;
  const thisYear = schedule.findIndex((y, i) => y.from <= today && (schedule[i + 1]?.from ?? "9999") > today);

  const detail = (label: string, value: ReactNode) => (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{value ?? "—"}</dd>
    </div>
  );

  const holder = (h: Pick<AssetEvent, "employee" | "vehicle" | "employee_id" | "vehicle_id">) => {
    const parts: ReactNode[] = [];
    if (h.employee) {
      parts.push(
        <Link key="e" to={`/employees/${h.employee_id}`} className="text-brand-700 hover:underline">
          <Bdi>{employeeName(h.employee, language)}</Bdi>
        </Link>,
      );
    }
    if (h.vehicle) {
      parts.push(
        <Link key="v" to={`/vehicles/${h.vehicle_id}`} className="text-brand-700 hover:underline">
          <Bdi>{h.vehicle.name}</Bdi>
        </Link>,
      );
    }
    return parts;
  };

  let disposal: ReactNode = null;
  if (disposed && asset.disposed_at) {
    const result = asset.purchase_cost != null
      ? disposalResult(input, asset.disposed_at, Number(asset.disposal_value ?? 0), decimals)
      : 0;
    const amount = bdiText(formatMoney(Math.abs(result), tenant.currency));
    disposal = (
      <Card className="mb-4 p-4">
        <p className="text-sm text-ink">
          {t("assets.disposedOn", { date: bdiText(date(asset.disposed_at)) })}
          {asset.disposal_value != null && <> {t("assets.disposedFor", { amount: bdiText(money(asset.disposal_value)) })}</>}
        </p>
        {result !== 0 && (
          <p className={result > 0 ? "mt-1 text-sm text-good" : "mt-1 text-sm text-serious"}>
            {result > 0 ? t("assets.gain", { amount }) : t("assets.loss", { amount })}
          </p>
        )}
      </Card>
    );
  }

  return (
    <>
      <Link to="/assets" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink-2">
        <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> {t("assets.title")}
      </Link>
      <PageHeader
        title={asset.name}
        description={[asset.doc_number, t(categories[asset.category])].filter(Boolean).join(" · ")}
        badge={<Badge tone={statuses[asset.status].tone}>{t(statuses[asset.status].labelKey)}</Badge>}
        actions={
          canAct ? (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setAction("assign")}>{assigned ? t("assets.reassign") : t("assets.assign")}</Button>
              {assigned && <Button variant="secondary" onClick={() => setAction("return")}>{t("assets.return")}</Button>}
              <Button variant="secondary" onClick={() => setAction("event")}>{t("assets.logEvent")}</Button>
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" /> {t("assets.edit")}
              </Button>
              <Button variant="danger" onClick={() => setAction("dispose")}>{t("assets.dispose")}</Button>
            </div>
          ) : undefined
        }
      />

      {disposal}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink">{t("assets.details")}</h2>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {detail(t("assets.f.manufacturer"), asset.manufacturer ? <Bdi>{asset.manufacturer}</Bdi> : null)}
              {detail(t("assets.f.model"), asset.model ? <Bdi>{asset.model}</Bdi> : null)}
              {detail(t("assets.f.serial"), asset.serial_number ? <Ltr>{asset.serial_number}</Ltr> : null)}
              {detail(t("assets.f.location"), asset.location ? <Bdi>{asset.location}</Bdi> : null)}
              {isEnabled("inventory") && detail(t("assets.f.warehouse"), warehouseName(asset.warehouse_id))}
              {isEnabled("companies") && detail(t("assets.f.branch"), branchQ.data ? (
                <Link to={`/companies/branches/${branchQ.data.id}`} className="text-brand-700 hover:underline">
                  <Bdi>{branchQ.data.name}</Bdi>
                </Link>
              ) : null)}
              {detail(t("assets.f.purchaseDate"), date(asset.purchase_date))}
              {detail(t("assets.f.purchaseCost"), money(asset.purchase_cost))}
              {isEnabled("suppliers") && detail(t("assets.f.supplier"), supplierQ.data ? (
                <Link to={`/suppliers/${supplierQ.data.id}`} className="text-brand-700 hover:underline">
                  <Bdi>{supplierQ.data.name}</Bdi>
                </Link>
              ) : null)}
              {detail(t("assets.f.warrantyExpiry"), asset.warranty_expiry ? (
                <span className="inline-flex flex-wrap items-center gap-2">
                  {date(asset.warranty_expiry)}
                  {!disposed && <WarrantyBadge expiry={asset.warranty_expiry} />}
                </span>
              ) : null)}
            </dl>
            {asset.notes && <p className="mt-4 whitespace-pre-line text-sm text-ink-2"><Bdi>{asset.notes}</Bdi></p>}
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink">{t("assets.depreciation")}</h2>
            {asset.depreciation_method === "none" ? (
              <p className="text-sm text-ink-3">{t("assets.notDepreciated")}</p>
            ) : schedule.length === 0 ? (
              <p className="text-sm text-ink-3">{t("assets.noDepreciation")}</p>
            ) : (
              <>
                <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {detail(t("assets.f.method"), t(methods[asset.depreciation_method]))}
                  {detail(t("assets.cost"), money(asset.purchase_cost))}
                  {detail(t("assets.salvage"), money(asset.salvage_value))}
                  {!disposed && detail(t("assets.bookValueToday"), (
                    <span className="font-semibold">{money(bookValue(input, today, decimals))}</span>
                  ))}
                  {!disposed && detail(t("assets.accumulated"), money(accumulatedDepreciation(input, today, decimals)))}
                </dl>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">{t("assets.schedule")}</h3>
                <Table headers={[t("assets.sch.year"), t("assets.sch.from"), t("assets.sch.depreciation"), t("assets.sch.closing")]}>
                  {schedule.map((y, i) => (
                    <tr key={y.year} className={i === thisYear && !disposed ? "bg-brand-50" : undefined}>
                      <td className="whitespace-nowrap px-4 py-2 text-sm text-ink">{t("assets.sch.yearN", { n: y.year })}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-sm text-ink-2">{date(y.from)}</td>
                      <td className="px-4 py-2 text-sm text-ink-2 tabular-nums"><Ltr>{money(y.depreciation)}</Ltr></td>
                      <td className="px-4 py-2 text-sm text-ink tabular-nums"><Ltr>{money(y.closingValue)}</Ltr></td>
                    </tr>
                  ))}
                </Table>
              </>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink">{t("assets.assignment")}</h2>
            {assigned ? (
              <dl className="space-y-3">
                {asset.assigned_employee_id && detail(t("assets.employee"), asset.employee ? holder({ ...asset, vehicle: null, employee_id: asset.assigned_employee_id, vehicle_id: null }) : "—")}
                {asset.assigned_vehicle_id && detail(t("assets.vehicle"), asset.vehicle ? holder({ ...asset, employee: null, employee_id: null, vehicle_id: asset.assigned_vehicle_id }) : "—")}
                {asset.assigned_at && (
                  <p className="text-xs text-ink-3">{t("assets.assignedSince", { date: bdiText(date(asset.assigned_at)) })}</p>
                )}
              </dl>
            ) : (
              <p className="text-sm text-ink-3">{t("assets.notAssigned")}</p>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink">{t("assets.history")}</h2>
            {eventsQ.isLoading && <LoadingState />}
            {eventsQ.error && <ErrorState message={(eventsQ.error as Error).message} />}
            {eventsQ.data && eventsQ.data.rows.length === 0 && <p className="text-sm text-ink-3">{t("assets.noHistory")}</p>}
            {eventsQ.data && eventsQ.data.rows.length > 0 && (
              <>
                <ol className="space-y-3 border-s border-line ps-4">
                  {eventsQ.data.rows.map((ev) => {
                    const who = holder(ev);
                    return (
                      <li key={ev.id} className="relative">
                        <span className="absolute -start-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand-500" aria-hidden />
                        <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                          <span className="text-sm font-medium text-ink">{t(eventTypes[ev.event_type])}</span>
                          <span className="text-xs text-ink-3">{formatDateTime(ev.at, tenant.timezone)}</span>
                        </div>
                        {who.length > 0 && (
                          <div className="flex flex-wrap gap-x-2 text-sm">{who}</div>
                        )}
                        {ev.detail && <p className="whitespace-pre-line text-sm text-ink-2"><Bdi>{ev.detail}</Bdi></p>}
                        {ev.cost != null && <p className="text-xs text-ink-3 tabular-nums"><Ltr>{money(ev.cost)}</Ltr></p>}
                      </li>
                    );
                  })}
                </ol>
                <Pagination page={page} pageSize={PAGE_SIZE} total={eventsQ.data.total} onPage={setPage} />
              </>
            )}
          </Card>
        </div>
      </div>

      <Modal title={t("assets.edit")} open={editing} onClose={() => setEditing(false)} wide>
        {editing && <AssetForm asset={asset} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />}
      </Modal>
      <AssetActionModal asset={asset} action={action} onClose={() => setAction(null)} />
    </>
  );
}
