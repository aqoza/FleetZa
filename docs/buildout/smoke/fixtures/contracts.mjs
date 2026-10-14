// Contracts smoke fixture: active contracts (one due for billing, one ending
// soon with auto-renew, one open-ended, one one-time), a draft, an expired
// contract, a terminated one and a renewed one linked to its successor; covered
// vehicles with and without their own rate, and a billing history.
const T = "170d2d86-5c22-4bcb-9d74-420c879419b2";
const ME = "129bbbae-fdfc-4d21-8a86-8949fec2403b";
const CUST_1 = "c1a0e5f2-3b4d-4e6f-8a9b-0c1d2e3f4a51";
const CUST_2 = "c1a0e5f2-3b4d-4e6f-8a9b-0c1d2e3f4a52";
const V1 = "5eed0000-0000-4000-8000-00000000e001";
const V2 = "5eed0000-0000-4000-8000-00000000e002";
const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const ts = (n) => new Date(Date.now() + n * 86_400_000).toISOString();
const cid = (n) => `17100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const vid = (n) => `17200000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const bid = (n) => `17300000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const iid = (n) => `17400000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = { created_by: ME, updated_by: ME };
const gulf = { name: "Gulf Freight Co." };
const desert = { name: "Desert Transport LLC" };

const contract = (n, o) => ({
  id: cid(n), tenant_id: T, number: n, doc_number: `CTR-${String(n).padStart(5, "0")}`, customer_id: CUST_1, contract_type: "service",
  title: "Contract", start_date: day(-200), end_date: day(165), status: "active", billing_frequency: "monthly", recurring_amount: 500,
  currency: "USD", tax_rate: null, auto_renew: false, notice_days: 30, next_billing_date: day(10), terms: null, signed_at: day(-205),
  signed_by_name: "Ahmed Al Balushi", activated_at: ts(-200), terminated_at: null, termination_reason: null, renewed_to: null,
  renewed_from: null, notes: null, created_at: ts(-210 + n), updated_at: ts(-1), customer: gulf, vehicles: [], ...actor, ...o,
});
const contracts = [
  contract(1, { title: "Speed limiter service 2026", contract_type: "speed_limiter_service", recurring_amount: 1200, next_billing_date: day(-3),
    terms: "Quarterly inspection of every covered unit.\nReplacement parts billed separately.",
    vehicles: [{ rate_override: 45 }, { rate_override: null }] }),
  contract(2, { title: "Truck lease, 12 units", contract_type: "lease", billing_frequency: "quarterly", recurring_amount: 18000,
    start_date: day(-345), end_date: day(20), auto_renew: true, next_billing_date: day(15), customer_id: CUST_2, customer: desert }),
  contract(3, { title: "Workshop maintenance SLA", contract_type: "sla", end_date: null, recurring_amount: 850, next_billing_date: day(4),
    auto_renew: false }),
  contract(4, { title: "Fleet onboarding", contract_type: "other", billing_frequency: "one_time", recurring_amount: 2500, start_date: day(-1),
    end_date: day(29), next_billing_date: day(-1), customer_id: CUST_2, customer: desert }),
  contract(5, { title: "Rental, two vans", contract_type: "rental", status: "draft", start_date: day(7), end_date: day(371),
    recurring_amount: 1400, next_billing_date: null, activated_at: null, signed_at: null, signed_by_name: null }),
  contract(6, { title: "خدمة الصيانة الدورية", contract_type: "maintenance", status: "expired", start_date: day(-400), end_date: day(-35),
    next_billing_date: null, recurring_amount: 300, signed_by_name: "سالم الحارثي" }),
  contract(7, { title: "GPS tracking", contract_type: "service", status: "terminated", start_date: day(-300), end_date: day(65),
    terminated_at: ts(-60), termination_reason: "Customer sold the vehicles.", next_billing_date: day(-50), recurring_amount: 220 }),
  contract(8, { title: "Speed limiter service 2025", contract_type: "speed_limiter_service", status: "renewed", start_date: day(-565),
    end_date: day(-201), next_billing_date: null, recurring_amount: 1100, renewed_to: cid(1) }),
];
contracts[0].renewed_from = cid(8);

const contract_vehicles = [
  { id: vid(1), tenant_id: T, contract_id: cid(1), vehicle_id: V1, rate_override: 45, created_at: ts(-200), updated_at: ts(-200),
    vehicle: { name: "Truck 07", license_plate: "1234 AB" }, ...actor },
  { id: vid(2), tenant_id: T, contract_id: cid(1), vehicle_id: V2, rate_override: null, created_at: ts(-199), updated_at: ts(-199),
    vehicle: { name: "Van 12", license_plate: "5678 CD" }, ...actor },
];

const billed = (n, start, end, status, total) => ({
  id: bid(n), tenant_id: T, contract_id: cid(1), invoice_id: iid(n), period_start: start, period_end: end, created_at: ts(-n * 30),
  invoice: { doc_number: `INV-${String(40 + n).padStart(5, "0")}`, status, total, currency: "USD" },
});
const contract_invoices = [
  billed(1, day(-34), day(-4), "issued", 1431.75),
  billed(2, day(-64), day(-35), "paid", 1431.75),
  billed(3, day(-95), day(-65), "paid", 1431.75),
];

export default {
  tables: { contracts, contract_vehicles, contract_invoices },
  rpc: {
    contract_bill_period: () => iid(9),
    contracts_bill_due: () => 2,
    contract_renew: () => cid(9),
  },
};
