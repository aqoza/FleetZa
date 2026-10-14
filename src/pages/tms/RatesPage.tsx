import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Tags, Trash2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { deleteRow, listPage, sanitizeSearch, wrapDbError } from "../../lib/db";
import { formatDate, formatMoney } from "../../lib/format";
import { ltrText } from "../../lib/bidi";
import { useCustomerPicker } from "../../lib/pickers";
import { SHIPMENT_MODES, type ShipmentMode } from "../../../shared/tms";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Badge, Bdi, Button, Card, EmptyState, ErrorState, Field, Input, LoadingState, Modal, Pagination, Select } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { RateForm } from "./forms";
import { Lane } from "./ShipmentsPage";
import { RATE_SELECT, type FreightRateRow } from "./types";

const PAGE_SIZE = 25;

function QuoteCalculator() {
  const t = useT();
  const tenant = useTenant();
  const [f, setF] = useState({ origin: "", destination: "", mode: "road_ftl" as ShipmentMode, weight: "", customer_id: "" });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const customers = useCustomerPicker(f.customer_id, { activeOnly: true });
  const quote = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("quote_freight", {
        p_origin_city: f.origin, p_destination_city: f.destination, p_mode: f.mode, p_weight_kg: Number(f.weight) || 0,
        ...(f.customer_id ? { p_customer_id: f.customer_id } : {}),
      });
      if (error) throw wrapDbError(error);
      return data?.[0] ?? null;
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    quote.mutate();
  };
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-ink">{t("tms.quote.title")}</h2>
      <p className="mb-3 text-xs text-ink-3">{t("tms.quote.hint")}</p>
      <form className="space-y-3" onSubmit={submit}>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("tms.rates.f.origin")} required>
            <Input value={f.origin} onChange={(e) => set("origin", e.target.value)} required maxLength={100} />
          </Field>
          <Field label={t("tms.rates.f.destination")} required>
            <Input value={f.destination} onChange={(e) => set("destination", e.target.value)} required maxLength={100} />
          </Field>
          <Field label={t("tms.rates.f.mode")}>
            <Select value={f.mode} onChange={(e) => set("mode", e.target.value as ShipmentMode)}>
              {SHIPMENT_MODES.map((m) => <option key={m} value={m}>{t(`tms.mode.${m}`)}</option>)}
            </Select>
          </Field>
          <Field label={t("tms.quote.weight")}>
            <Input type="number" min={0} step="0.01" value={f.weight} onChange={(e) => set("weight", e.target.value)} placeholder="0" />
          </Field>
        </div>
        <Field label={t("tms.rates.f.customer")}>
          <Combobox {...customers} value={f.customer_id} onChange={(v) => set("customer_id", v)} placeholder={t("tms.rates.f.anyCustomer")} />
        </Field>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 text-sm">
            {quote.error && <span className="text-serious">{(quote.error as Error).message}</span>}
            {quote.isSuccess && (quote.data ? (
              <div>
                <div className="text-lg font-semibold text-ink">{formatMoney(quote.data.price, tenant.currency)}</div>
                <div className="text-xs text-ink-3">{quote.data.customer_specific ? t("tms.quote.customerRate") : t("tms.quote.generalRate")}</div>
              </div>
            ) : <span className="text-ink-3">{t("tms.quote.none")}</span>)}
          </div>
          <Button type="submit" variant="secondary" loading={quote.isPending}>{t("tms.quote.get")}</Button>
        </div>
      </form>
    </Card>
  );
}

export default function RatesPage() {
  const t = useT();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<FreightRateRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<FreightRateRow | null>(null);
  const term = sanitizeSearch(search);
  const today = new Date().toISOString().slice(0, 10);

  const listQ = useQuery({
    queryKey: ["freight_rates", "list", { page, term }],
    queryFn: () =>
      listPage<FreightRateRow>("freight_rates", page, PAGE_SIZE, (q) => {
        let f = q.select(RATE_SELECT);
        if (term) f = f.or(`origin_city.ilike.%${term}%,destination_city.ilike.%${term}%`);
        return f.order("origin_city").order("destination_city").order("valid_from", { ascending: false });
      }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteRow("freight_rates", id),
    onSuccess: () => {
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ["freight_rates"] });
      toast.success(t("tms.rates.deleted"));
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  const money = (n: number) => ltrText(formatMoney(n, tenant.currency));
  const pricing = (r: FreightRateRow) =>
    [
      r.rate_per_trip != null ? t("tms.rates.perTrip", { amount: money(r.rate_per_trip) }) : null,
      r.rate_per_kg != null ? t("tms.rates.perKg", { amount: money(r.rate_per_kg) }) : null,
      r.min_charge > 0 ? t("tms.rates.min", { amount: money(r.min_charge) }) : null,
    ].filter(Boolean).join(" · ");

  const columns: Array<DataTableColumn<FreightRateRow>> = [
    {
      id: "lane",
      header: t("tms.rates.col.lane"),
      cell: (r) => <span className="text-ink"><Lane s={r} /></span>,
      exportValue: (r) => `${r.origin_city} - ${r.destination_city}`,
    },
    {
      id: "mode",
      header: t("tms.rates.col.mode"),
      minBreakpoint: "md",
      cell: (r) => <span className="text-ink-2">{t(`tms.mode.${r.mode}`)}</span>,
      exportValue: (r) => r.mode,
    },
    {
      id: "customer",
      header: t("tms.rates.col.customer"),
      minBreakpoint: "lg",
      cell: (r) => r.customer ? <Bdi className="text-ink">{r.customer.name}</Bdi> : <span className="text-ink-3">{t("tms.rates.allCustomers")}</span>,
      exportValue: (r) => r.customer?.name ?? "",
    },
    {
      id: "price",
      header: t("tms.rates.col.price"),
      cell: (r) => <span className="text-ink-2">{pricing(r)}</span>,
      exportValue: (r) => pricing(r),
    },
    {
      id: "validity",
      header: t("tms.rates.col.validity"),
      minBreakpoint: "sm",
      cell: (r) => r.valid_to && r.valid_to < today
        ? <Badge tone="slate">{t("tms.rates.expired")}</Badge>
        : <span className="whitespace-nowrap text-ink-2">{r.valid_to
            ? t("tms.rates.range", { from: ltrText(formatDate(r.valid_from)), to: ltrText(formatDate(r.valid_to)) })
            : t("tms.rates.from", { from: ltrText(formatDate(r.valid_from)) })}</span>,
      sortValue: (r) => r.valid_from,
      exportValue: (r) => `${r.valid_from}${r.valid_to ? ` - ${r.valid_to}` : ""}`,
    },
  ];
  if (isManager) {
    columns.push({
      id: "actions",
      header: "",
      align: "end",
      cell: (r) => (
        <Button variant="ghost" aria-label={t("action.delete")} onClick={(e) => { e.stopPropagation(); setDeleting(r); }}>
          <Trash2 className="h-4 w-4" />
        </Button>
      ),
    });
  }

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="min-w-0 xl:col-span-2">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder={t("tms.rates.search")} className="w-full sm:max-w-72" />
          {isManager && (
            <Button className="ms-auto" onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4" /> {t("tms.rates.new")}
            </Button>
          )}
        </div>
        {listQ.isLoading && <LoadingState />}
        {listQ.error && <ErrorState message={(listQ.error as Error).message} />}
        {listQ.data && (
          <DataTable<FreightRateRow>
            tableId="freight_rates"
            exportName="freight-rates"
            rows={listQ.data.rows}
            rowKey={(r) => r.id}
            columns={columns}
            onRowClick={isManager ? (r) => setEditing(r) : undefined}
            empty={<EmptyState icon={<Tags className="h-10 w-10" />} title={t("tms.rates.empty")} description={t("tms.rates.emptyHint")} />}
            footer={<Pagination page={page} pageSize={PAGE_SIZE} total={listQ.data.total} onPage={setPage} />}
          />
        )}
      </div>
      <div>
        <QuoteCalculator />
      </div>

      <Modal title={editing === "new" ? t("tms.rates.newTitle") : t("tms.rates.editTitle")} open={editing != null} onClose={() => setEditing(null)} wide>
        {editing != null && (
          <RateForm
            rate={editing === "new" ? undefined : editing}
            onCancel={() => setEditing(null)}
            onDone={() => {
              setEditing(null);
              void qc.invalidateQueries({ queryKey: ["freight_rates"] });
              toast.success(t("tms.rates.saved"));
            }}
          />
        )}
      </Modal>
      <Modal title={t("action.delete")} open={deleting != null} onClose={() => setDeleting(null)}>
        <p className="text-sm text-ink-2">{t("tms.rates.deleteConfirm")}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setDeleting(null)}>{t("action.cancel")}</Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => deleting && remove.mutate(deleting.id)}>{t("action.delete")}</Button>
        </div>
      </Modal>
    </div>
  );
}
