// Point of sale smoke fixture: two registers (one stocked from a warehouse,
// one inactive), an open session on the main counter with sales, a refund and
// a closed session with its Z-report, plus catalog products for the grid.
const T = "170d2d86-5c22-4bcb-9d74-420c879419b2";
const ME = "129bbbae-fdfc-4d21-8a86-8949fec2403b";
const CUST_1 = "c1a0e5f2-3b4d-4e6f-8a9b-0c1d2e3f4a51";
const ts = (h) => new Date(Date.now() + h * 3_600_000).toISOString();
const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const rid = (n) => `19100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sid = (n) => `19200000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const oid = (n) => `19300000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const lid = (n) => `19400000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const pid = (n) => `19500000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const WH = "19000000-0000-4000-8000-000000000001";
const actor = { created_by: ME, updated_by: ME, created_at: ts(-500), updated_at: ts(-1) };

const warehouses = [{ id: WH, tenant_id: T, name: "Main store", name_ar: null, code: "MAIN", address: null, branch_id: null, is_default: true, active: true, ...actor }];

const pos_registers = [
  { id: rid(1), tenant_id: T, name: "Front counter", warehouse_id: WH, active: true, notes: null, ...actor },
  { id: rid(2), tenant_id: T, name: "Workshop desk", warehouse_id: null, active: true, notes: null, ...actor },
  { id: rid(3), tenant_id: T, name: "Old kiosk", warehouse_id: null, active: false, notes: null, ...actor },
];

const prods = [
  ["Oil change, light vehicle", "SRV-OIL", "service", 18, 5], ["Speed limiter calibration", "SRV-SLC", "service", 45, 5],
  ["Brake pads, front set", "PRT-BRK", "part", 32.5, 5], ["Air filter", "PRT-AIR", "part", 7.25, 5],
  ["Wiper blades (pair)", "PRT-WIP", "part", 6, 5], ["Inspection certificate fee", "FEE-CERT", "fee", 10, 0],
  ["Tyre rotation", "SRV-TYR", "service", 12, 5], ["Coolant 5L", "PRT-COL", "part", 9.5, 5],
];
const products = prods.map(([name, sku, kind, unit_price, tax_rate], i) => ({
  id: pid(i + 1), tenant_id: T, name, sku, kind, unit_price, tax_rate, unit: "ea", description: null, notes: null, active: true, ...actor,
}));

const session = (n, register, status, openedH, extra = {}) => ({
  id: sid(n), tenant_id: T, number: n, doc_number: `POSS-${String(n).padStart(5, "0")}`, register_id: rid(register), status,
  opened_by: ME, opened_at: ts(openedH), opening_cash: 50, closed_by: null, closed_at: null, closing_cash_counted: null,
  expected_cash: null, cash_difference: null, notes: null, ...actor, ...extra,
});
const pos_sessions = [
  session(1, 1, "closed", -30, { closed_by: ME, closed_at: ts(-22), closing_cash_counted: 120.5, expected_cash: 121, cash_difference: -0.5 }),
  session(2, 1, "open", -3),
];

let ln = 0;
const pos_order_lines = [];
const order = (n, session_n, h, lines, pay, extra = {}) => {
  let subtotal = 0, discount_total = 0, tax_total = 0;
  lines.forEach(([p, qty, disc], i) => {
    const pr = products[p - 1];
    const gross = +(qty * pr.unit_price).toFixed(2);
    const d = +((gross * disc) / 100).toFixed(2);
    const net = gross - d;
    const tax = +((net * pr.tax_rate) / 100).toFixed(2);
    subtotal += gross; discount_total += d; tax_total += tax;
    pos_order_lines.push({
      id: lid(++ln), tenant_id: T, order_id: oid(n), sort_order: i + 1, product_id: pr.id, inventory_item_id: null, description: pr.name,
      quantity: qty, unit_price: pr.unit_price, discount_percent: disc, tax_rate: pr.tax_rate, line_gross: gross, line_discount: d,
      line_net: net, line_tax: tax, line_total: +(net + tax).toFixed(2), created_at: ts(h),
    });
  });
  const total = +(subtotal - discount_total + tax_total).toFixed(2);
  return {
    id: oid(n), tenant_id: T, number: n, doc_number: `POS-${String(n).padStart(5, "0")}`, session_id: sid(session_n),
    register_id: rid(1), customer_id: null, status: "completed", currency: "USD", currency_decimals: 2,
    subtotal, discount_total, tax_total, total, paid_cash: total, paid_card: 0, paid_other: 0, change_due: 0,
    completed_at: ts(h), refund_of: null, notes: null, ...actor, ...pay, ...extra,
  };
};
const pos_orders = [
  order(1, 1, -29, [[1, 1, 0], [4, 1, 0]], { paid_cash: 30, change_due: 3.49 }),
  order(2, 1, -27, [[2, 1, 10]], { paid_cash: 0, paid_card: 42.52 }),
  order(3, 1, -25, [[3, 2, 0]], { paid_cash: 68.25 }, { status: "refunded", customer_id: CUST_1 }),
  order(4, 1, -24, [[3, -2, 0]], { paid_cash: -68.25 }, { refund_of: oid(3), customer_id: CUST_1 }),
  order(5, 2, -2, [[7, 1, 0], [6, 1, 0], [5, 1, 0]], { paid_cash: 40, change_due: 11.1 }),
  order(6, 2, -1, [[8, 2, 0]], { paid_cash: 0, paid_other: 19.95 }),
];

const summary = (sessionId) => {
  const os = pos_orders.filter((o) => o.session_id === sessionId && o.status !== "voided");
  const sum = (f) => +os.reduce((a, o) => a + f(o), 0).toFixed(2);
  const sales = os.filter((o) => !o.refund_of);
  const refunds = os.filter((o) => o.refund_of);
  const cash = sum((o) => o.paid_cash - o.change_due);
  return {
    sales_count: sales.length, refund_count: refunds.length,
    gross_sales: +sales.reduce((a, o) => a + o.total, 0).toFixed(2), refunds: -refunds.reduce((a, o) => a + o.total, 0),
    net_sales: sum((o) => o.total), tax: sum((o) => o.tax_total), discounts: sum((o) => o.discount_total),
    cash, card: sum((o) => o.paid_card), other: sum((o) => o.paid_other),
    expected_cash: 50 + cash,
  };
};

export default {
  tables: { warehouses, pos_registers, products, pos_sessions, pos_orders, pos_order_lines },
  rpc: {
    pos_session_summary: (a) => summary(a.p_session_id),
    pos_daily_sales: () => [
      { day: day(-9), orders: 4, total: 212.4 }, { day: day(-6), orders: 7, total: 388.15 }, { day: day(-3), orders: 2, total: 64 },
      { day: day(-1), orders: 3, total: 54.46 }, { day: day(0), orders: 2, total: 50.05 },
    ],
    pos_checkout: { order_id: oid(5), doc_number: "POS-00007", total: 41.48, change_due: 8.52 },
    pos_open_session: sid(3),
    pos_close_session: sid(2),
    pos_refund: oid(7),
  },
};
