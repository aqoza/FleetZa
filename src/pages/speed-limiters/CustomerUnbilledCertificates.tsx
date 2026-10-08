/**
 * The customer page's "Not invoiced" card: the live certificates issued to
 * one customer that no invoice bills yet. Contributed by the certificates +
 * billing modules (docs/ARCHITECTURE_REVIEW.md §9.1) — CustomerDetailPage only
 * mounts it when both are on.
 *
 * "Not invoiced" is the same definition everywhere: the list reads the
 * `billing_state` computed column, "Invoice all" reads
 * sales_report_certificates_pending_invoice — both go through
 * app.certificate_invoice_id(), so this card, the certificates list's
 * "Not invoiced" chip and the Sales report can never disagree. Live means
 * status = 'valid' and superseded_by IS NULL, as in that report.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { BadgeCheck, Receipt } from "lucide-react";
import { listPage, wrapDbError } from "../../lib/db";
import { supabase } from "../../lib/supabase";
import { formatDate } from "../../lib/format";
import { certificateStatusMeta } from "../../lib/certificateStatus";
import type { InvoiceableCertificate } from "../../lib/certificateBilling";
import type { SpeedLimiterCertificate, Vehicle } from "../../lib/types";
import { useAuth } from "../../context/AuthContext";
import { useT, useTp } from "../../i18n";
import {
  Badge, Bdi, Button, Card, ErrorState, LoadingState, Ltr, Pagination,
} from "../../components/ui";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { InvoiceCertificatesModal } from "./InvoiceCertificatesModal";
import { MarkPaidExternallyModal } from "./MarkPaidExternallyModal";

const PAGE_SIZE = 8;

type UnbilledRow = Pick<
  SpeedLimiterCertificate,
  "id" | "certificate_number" | "issued_at" | "expires_at" | "status" | "superseded_by"
> & { vehicles: Pick<Vehicle, "name" | "license_plate"> | null };

/** One row of sales_report_certificates_pending_invoice(). */
interface PendingRow {
  certificate_id: string;
  certificate_number: string;
  customer_id: string | null;
  customer_name: string | null;
  vehicle_id: string | null;
  vehicle_name: string | null;
  license_plate: string | null;
}

export default function CustomerUnbilledCertificates({
  customerId,
  customerName,
}: {
  customerId: string;
  customerName: string | null;
}) {
  const t = useT();
  const tp = useTp();
  const { isManager } = useAuth();
  const [page, setPage] = useState(0);
  const [invoicing, setInvoicing] = useState<InvoiceableCertificate[] | null>(null);
  const [markingPaid, setMarkingPaid] = useState<InvoiceableCertificate[] | null>(null);

  const listQ = useQuery({
    queryKey: ["speed_limiter_certificates", "customer", customerId, "unbilled", page],
    placeholderData: keepPreviousData,
    queryFn: () =>
      listPage<UnbilledRow>("speed_limiter_certificates", page, PAGE_SIZE, (q) =>
        q
          .select(
            "id, certificate_number, issued_at, expires_at, status, superseded_by, " +
              "vehicles(name, license_plate)",
          )
          .eq("customer_id", customerId)
          .eq("status", "valid")
          .is("superseded_by", null)
          .eq("billing_state", "unbilled")
          // Oldest first: the longest-unbilled work is the payment most at risk.
          .order("issued_at", { ascending: true })
          .order("certificate_number"),
      ),
  });
  const rows = listQ.data?.rows ?? [];
  const total = listQ.data?.total ?? 0;

  // The whole backlog, not this page — a hundred-vehicle renewal is one
  // invoice. Fetched on click so the card itself stays one paged query.
  const loadAll = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("sales_report_certificates_pending_invoice", {
        p_customer_id: customerId,
      });
      if (error) throw wrapDbError(error);
      return (data ?? []) as PendingRow[];
    },
    onSuccess: (all) =>
      setInvoicing(
        all.map((r) => ({
          id: r.certificate_id,
          certificate_number: r.certificate_number,
          customer_id: r.customer_id,
          customer_name: r.customer_name,
          vehicle_id: r.vehicle_id,
          vehicle_name: r.vehicle_name,
          license_plate: r.license_plate,
        })),
      ),
  });

  const toInvoiceable = (c: UnbilledRow): InvoiceableCertificate => ({
    id: c.id,
    certificate_number: c.certificate_number,
    customer_id: customerId,
    customer_name: customerName,
    vehicle_id: null,
    vehicle_name: c.vehicles?.name ?? null,
    license_plate: c.vehicles?.license_plate ?? null,
  });

  const columns: Array<DataTableColumn<UnbilledRow>> = [
    {
      id: "number",
      header: t("slCertificates.number"),
      cell: (c) => (
        <Link
          to={`/speed-limiters/certificates?q=${encodeURIComponent(c.certificate_number)}`}
          className="font-medium text-brand-700 hover:underline"
        >
          <Ltr>{c.certificate_number}</Ltr>
        </Link>
      ),
      sortValue: (c) => c.certificate_number,
    },
    {
      id: "vehicle",
      header: t("field.vehicle"),
      cell: (c) => (
        <>
          <div className="text-ink-2"><Bdi>{c.vehicles?.name ?? t("common.dash")}</Bdi></div>
          {c.vehicles?.license_plate && (
            <div className="text-xs text-ink-3"><Ltr>{c.vehicles.license_plate}</Ltr></div>
          )}
        </>
      ),
      sortValue: (c) => c.vehicles?.license_plate ?? null,
    },
    {
      id: "issued",
      header: t("slCertificates.issued"),
      cell: (c) => <span className="text-ink-2">{formatDate(c.issued_at)}</span>,
      sortValue: (c) => c.issued_at,
      minBreakpoint: "md",
      dir: "ltr",
    },
    {
      id: "expires",
      header: t("slCertificates.expires"),
      cell: (c) => {
        const meta = certificateStatusMeta(c);
        return (
          <div className="flex items-center gap-2">
            <Badge tone={meta.tone}>{t(meta.labelKey)}</Badge>
            <span className="text-xs text-ink-3"><Ltr>{formatDate(c.expires_at)}</Ltr></span>
          </div>
        );
      },
      sortValue: (c) => c.expires_at,
    },
  ];

  const listHref =
    `/speed-limiters/certificates?customer=${encodeURIComponent(customerId)}&billing=unbilled`;

  return (
    <Card className="p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
          {t("slCertificates.unbilledTitle")}
          {total > 0 && <Badge tone="yellow">{tp("slCertificates.unbilledCount", total)}</Badge>}
        </h3>
        <div className="flex items-center gap-3">
          <Link to={listHref} className="text-xs font-medium text-brand-700 hover:underline">
            {t("slCertificates.unbilledViewAll")}
          </Link>
          {isManager && total > 0 && (
            <Button
              variant="secondary"
              onClick={() => loadAll.mutate()}
              loading={loadAll.isPending}
            >
              <Receipt className="h-4 w-4" /> {t("slCertificates.unbilledInvoiceAll")}
            </Button>
          )}
        </div>
      </div>
      <p className="mb-3 text-xs text-ink-3">{t("slCertificates.unbilledHint")}</p>

      {loadAll.error && (
        <div className="mb-3">
          <ErrorState message={(loadAll.error as Error).message} />
        </div>
      )}

      {listQ.isLoading ? (
        <LoadingState />
      ) : listQ.error ? (
        <ErrorState message={(listQ.error as Error).message} />
      ) : total === 0 ? (
        <p className="py-6 text-center text-sm text-ink-3">{t("slCertificates.unbilledNone")}</p>
      ) : (
        <DataTable<UnbilledRow>
          tableId="customer_unbilled_certificates"
          columns={columns}
          rows={rows}
          rowKey={(c) => c.id}
          selectable={isManager}
          bulkActions={(selected) => (
            <>
              <Button onClick={() => setInvoicing(selected.map(toInvoiceable))}>
                <Receipt className="h-4 w-4" /> {t("slCertificates.createInvoice")}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setMarkingPaid(selected.map(toInvoiceable))}
              >
                <BadgeCheck className="h-4 w-4" /> {t("slCertificates.markPaid")}
              </Button>
            </>
          )}
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />}
        />
      )}

      <InvoiceCertificatesModal certificates={invoicing} onClose={() => setInvoicing(null)} />
      <MarkPaidExternallyModal certificates={markingPaid} onClose={() => setMarkingPaid(null)} />
    </Card>
  );
}
