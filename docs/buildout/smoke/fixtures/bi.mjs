// BI analytics smoke fixture: a shared "Fleet overview" dashboard with every
// widget type (KPI, bar, line, donut, table) and a private one, plus a
// bi_metric stand-in that answers each metric/dimension pair with
// deterministic rows (months and weeks over the asked period).
const T = "170d2d86-5c22-4bcb-9d74-420c879419b2";
const ME = "129bbbae-fdfc-4d21-8a86-8949fec2403b";
const ts = (n) => new Date(Date.now() + n * 86_400_000).toISOString();
const did = (n) => `1a100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const wid = (n) => `1a200000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = { created_by: ME, updated_by: ME, created_at: ts(-40), updated_at: ts(-2) };

const bi_dashboards = [
  { id: did(1), tenant_id: T, name: "Fleet overview", description: "Fuel, maintenance and distance at a glance.", is_shared: true, owner_id: ME, ...actor },
  { id: did(2), tenant_id: T, name: "My cost review", description: null, is_shared: false, owner_id: ME, ...actor },
];
const w = (n, dash, widget_type, metric, dimension, period, size, title = null) => ({
  id: wid(n), tenant_id: T, dashboard_id: did(dash), title, widget_type, metric, dimension, period, date_from: null, date_to: null,
  position: n, size, ...actor,
});
const bi_widgets = [
  w(1, 1, "kpi", "fuel_cost", "none", "last_30_days", "small"),
  w(2, 1, "kpi", "maintenance_cost", "none", "last_30_days", "small"),
  w(3, 1, "kpi", "distance_km", "none", "last_30_days", "small"),
  w(4, 1, "kpi", "issues_count", "none", "last_30_days", "small"),
  w(5, 1, "bar", "fuel_cost", "month", "last_12_months", "medium"),
  w(6, 1, "line", "distance_km", "month", "last_12_months", "medium"),
  w(7, 1, "bar", "maintenance_cost", "vehicle", "last_90_days", "medium"),
  w(8, 1, "pie", "work_orders_count", "status", "last_90_days", "medium"),
  w(9, 1, "table", "revenue_invoiced", "customer", "this_year", "medium", "Top customers"),
  w(10, 1, "bar", "issues_count", "week", "last_90_days", "large"),
  w(11, 2, "kpi", "expenses_total", "none", "this_year", "small"),
];

const monthsBetween = (from, to) => {
  const out = [];
  const d = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
  while (d.toISOString().slice(0, 7) <= to.slice(0, 7)) { out.push(d.toISOString().slice(0, 7)); d.setUTCMonth(d.getUTCMonth() + 1); }
  return out;
};
const weeksBetween = (from, to) => {
  const out = [];
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  while (d.toISOString().slice(0, 10) <= to) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 7); }
  return out;
};
const base = { fuel_cost: 820, fuel_liters: 210, distance_km: 3400, maintenance_cost: 640, work_orders_count: 6, issues_count: 4,
  revenue_invoiced: 5200, expenses_total: 1900, payments_received: 4100 };
const vehicles = [["5eed0000-0000-4000-8000-00000000e001", "NV-1001"], ["5eed0000-0000-4000-8000-00000000e002", "NV-1002"],
  ["5eed0000-0000-4000-8000-00000000e003", "NV-2003"], ["", ""]];
const customers = [["c1", "Gulf Freight Co."], ["c2", "شركة النقل الحديث"], ["c3", "Desert Logistics"]];

function metric(a) {
  const b = base[a.p_metric] ?? 10;
  switch (a.p_dimension) {
    case "none": return [{ key: "total", label: "total", value: b * 3 }];
    case "month": return monthsBetween(a.p_from, a.p_to).map((k, i) => ({ key: k, label: k, value: i % 5 === 3 ? 0 : Math.round(b * (0.7 + ((i * 37) % 10) / 15)) }));
    case "week": return weeksBetween(a.p_from, a.p_to).map((k, i) => ({ key: k, label: k, value: (i * 7) % 5 }));
    case "vehicle": return vehicles.map(([k, l], i) => ({ key: k, label: l, value: Math.round(b / (i + 1)) }));
    case "customer": return customers.map(([k, l], i) => ({ key: k, label: l, value: Math.round(b / (i + 1)) }));
    case "status": return [["open", 5], ["in_progress", 3], ["completed", 12], ["canceled", 1]].map(([k, v]) => ({ key: k, label: k, value: v }));
    default: return [{ key: "part", label: "part", value: b / 2 }, { key: "labor", label: "labor", value: b / 3 }];
  }
}

export default {
  tables: { bi_dashboards, bi_widgets },
  rpc: {
    bi_metric: metric,
    bi_create_default_dashboard: did(1),
  },
};
