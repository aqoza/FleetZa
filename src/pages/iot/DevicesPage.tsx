import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Cpu, Plus, Search } from "lucide-react";
import { countRows, listPage, sanitizeSearch } from "../../lib/db";
import { DEVICE_TYPES } from "../../lib/iot";
import { formatDateTime } from "../../lib/format";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useT, useTp } from "../../i18n";
import { Badge, Bdi, Button, Card, EmptyState, ErrorState, Input, LoadingState, Pagination, Select } from "../../components/ui";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { DeviceForm } from "./DeviceForm";
import { FreshDot, LatestChips } from "./shared";
import { statusTone } from "./labels";
import { DEVICE_SELECT, type IotDevice } from "./types";

const PAGE_SIZE = 25;

export default function DevicesPage() {
  const t = useT();
  const tp = useTp();
  const tenant = useTenant();
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const { isEnabled } = useModules();
  const [raw, setRaw] = useState("");
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(sanitizeSearch(raw));
      setPage(0);
    }, 250);
    return () => clearTimeout(id);
  }, [raw]);

  const listQ = useQuery({
    queryKey: ["iot_devices", { page, search, type, status }],
    queryFn: () =>
      listPage<IotDevice>("iot_devices", page, PAGE_SIZE, (q) => {
        let f = q.select(DEVICE_SELECT);
        if (search) f = f.or(`name.ilike.%${search}%,serial.ilike.%${search}%`);
        if (type !== "all") f = f.eq("device_type", type);
        if (status !== "all") f = f.eq("status", status);
        return f.order("name");
      }),
  });
  const openQ = useQuery({
    queryKey: ["iot_alerts", "open-count"],
    queryFn: () => countRows("iot_alerts", (q) => q.eq("status", "open")),
  });

  const columns: Array<DataTableColumn<IotDevice>> = [
    {
      id: "device",
      header: t("iot.col.device"),
      cell: (d) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FreshDot lastSeenAt={d.last_seen_at} />
            <Bdi className="font-medium text-ink">{d.name}</Bdi>
          </div>
          <div dir="ltr" className="text-start text-xs text-ink-3 rtl:text-end">{d.serial}</div>
        </div>
      ),
      sortValue: (d) => d.name,
      exportValue: (d) => `${d.name} (${d.serial})`,
    },
    {
      id: "type",
      header: t("iot.col.type"),
      minBreakpoint: "sm",
      cell: (d) => <span className="text-ink-2">{t(`iot.type.${d.device_type}`)}</span>,
      sortValue: (d) => d.device_type,
      exportValue: (d) => d.device_type,
    },
    {
      id: "mounted",
      header: t("iot.col.mountedOn"),
      minBreakpoint: "md",
      cell: (d) =>
        d.vehicle ? (
          <Bdi className="text-ink-2">{d.vehicle.name}</Bdi>
        ) : d.asset_label ? (
          <Bdi className="text-ink-2">{d.asset_label}</Bdi>
        ) : (
          <span className="text-ink-3">{t("iot.notMounted")}</span>
        ),
      exportValue: (d) => d.vehicle?.name ?? d.asset_label ?? "",
    },
    {
      id: "latest",
      header: t("iot.col.latest"),
      minBreakpoint: "lg",
      cell: (d) => <LatestChips lastReading={d.last_reading} />,
    },
    {
      id: "lastSeen",
      header: t("iot.col.lastSeen"),
      minBreakpoint: "md",
      cell: (d) => (
        <span className="whitespace-nowrap text-ink-2">
          {d.last_seen_at ? formatDateTime(d.last_seen_at, tenant.timezone) : t("iot.never")}
        </span>
      ),
      sortValue: (d) => d.last_seen_at,
      exportValue: (d) => d.last_seen_at ?? "",
    },
    {
      id: "status",
      header: t("iot.col.status"),
      cell: (d) => <Badge tone={statusTone[d.status]}>{t(`iot.status.${d.status}`)}</Badge>,
      sortValue: (d) => d.status,
      exportValue: (d) => d.status,
    },
  ];

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <p className="min-w-0 flex-1 text-sm text-ink-2">{t("iot.apiHint")}</p>
        {isEnabled("integrations") && (
          <Link to="/integrations" className="text-sm font-medium text-brand-700 hover:underline">
            {t("iot.openIntegrations")}
          </Link>
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-64">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
          <Input className="ps-9" placeholder={t("iot.search")} value={raw} onChange={(e) => setRaw(e.target.value)} />
        </div>
        <Select
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPage(0);
          }}
          className="max-w-44"
        >
          <option value="all">{t("iot.allTypes")}</option>
          {DEVICE_TYPES.map((ty) => (
            <option key={ty} value={ty}>{t(`iot.type.${ty}`)}</option>
          ))}
        </Select>
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
          className="max-w-40"
        >
          <option value="all">{t("iot.allStatuses")}</option>
          {(["active", "inactive", "faulty"] as const).map((s) => (
            <option key={s} value={s}>{t(`iot.status.${s}`)}</option>
          ))}
        </Select>
        {(openQ.data ?? 0) > 0 && (
          <Link to="/iot/alerts" className="text-sm font-medium text-serious hover:underline">
            {tp("iot.openAlerts", openQ.data ?? 0)}
          </Link>
        )}
        {isManager && (
          <Button className="ms-auto" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> {t("iot.addDevice")}
          </Button>
        )}
      </div>

      {listQ.isLoading && <LoadingState />}
      {listQ.error && <ErrorState message={(listQ.error as Error).message} />}
      {listQ.data && (
        <DataTable<IotDevice>
          tableId="iot-devices"
          exportName="iot-devices"
          rows={listQ.data.rows}
          rowKey={(d) => d.id}
          columns={columns}
          onRowClick={(d) => navigate(`/iot/devices/${d.id}`)}
          empty={
            <EmptyState icon={<Cpu className="h-10 w-10" />} title={t("iot.devicesEmpty")} description={t("iot.devicesEmptyHint")} />
          }
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={listQ.data.total} onPage={setPage} />}
        />
      )}

      {adding && <DeviceForm device={null} onClose={() => setAdding(false)} />}
    </div>
  );
}
