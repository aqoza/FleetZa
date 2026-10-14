// Customer portal smoke fixture: service requests in every status (one in
// Arabic), portal links that are active, revoked and expired, and the public
// portal payload for one link with every section on.
const T = "170d2d86-5c22-4bcb-9d74-420c879419b2";
const ME = "129bbbae-fdfc-4d21-8a86-8949fec2403b";
const CUST_1 = "c1a0e5f2-3b4d-4e6f-8a9b-0c1d2e3f4a51";
const CUST_2 = "c1a0e5f2-3b4d-4e6f-8a9b-0c1d2e3f4a52";
const V1 = "5eed0000-0000-4000-8000-00000000e001";
const TOKEN = "18000000-0000-4000-8000-00000000aaaa";
const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const ts = (n) => new Date(Date.now() + n * 86_400_000).toISOString();
const rid = (n) => `18100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const lid = (n) => `18200000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = { created_by: null, updated_by: ME };
const gulf = { name: "Gulf Freight Co." };
const desert = { name: "Desert Transport LLC" };

const req = (n, o) => ({
  id: rid(n), tenant_id: T, number: n, doc_number: `SRQ-${String(n).padStart(5, "0")}`, customer_id: CUST_1, access_id: lid(1),
  request_type: "service", vehicle_id: null, description: "Request", preferred_date: null, contact_name: null, contact_phone: null,
  status: "new", scheduled_for: null, internal_notes: null, handled_by: null, resolved_at: null, created_at: ts(-n), updated_at: ts(-n),
  customer: gulf, vehicle: null, handler: null, link: { label: "Fleet office" }, ...actor, ...o,
});
const portal_service_requests = [
  req(1, { request_type: "inspection", vehicle_id: V1, vehicle: { name: "Truck 07", license_plate: "1234 AB" },
    description: "Annual inspection before the permit renewal.", preferred_date: day(6), contact_name: "Ahmed Al Balushi",
    contact_phone: "+968 9123 4567" }),
  req(2, { request_type: "installation", description: "Fit speed limiters on two new trucks arriving next week.",
    status: "in_review", handled_by: ME, handler: { full_name: "Demo Owner", email: "demo@fleetmanage.test" },
    internal_notes: "Check stock of SL-200 units." }),
  req(3, { request_type: "renewal", description: "Renew the certificate for Van 12.", status: "scheduled", scheduled_for: day(3),
    handled_by: ME, handler: { full_name: "Demo Owner", email: "demo@fleetmanage.test" }, customer_id: CUST_2, customer: desert,
    link: { label: null } }),
  req(4, { request_type: "support", description: "عطل في جهاز التتبع بالحافلة رقم ٣", contact_name: "سالم الحارثي", status: "new" }),
  req(5, { request_type: "service", description: "Oil change.", status: "done", resolved_at: ts(-2), handled_by: ME,
    handler: { full_name: "Demo Owner", email: "demo@fleetmanage.test" } }),
  req(6, { request_type: "other", description: "Can you pick up our old devices?", status: "rejected", resolved_at: ts(-4) }),
];

const link = (n, o) => ({
  id: lid(n), tenant_id: T, customer_id: CUST_1, token: `18000000-0000-4000-8000-${String(n).padStart(12, "0")}`, label: null,
  active: true, expires_at: null, show_vehicles: true, show_certificates: true, show_invoices: true, show_quotes: true,
  show_contracts: true, allow_requests: true, last_accessed_at: ts(-1), access_count: 7, revoked_at: null,
  created_at: ts(-30 + n), updated_at: ts(-1), customer: gulf, created_by: ME, updated_by: ME, ...o,
});
const customer_portal_access = [
  link(1, { token: TOKEN, label: "Fleet office" }),
  link(2, { customer_id: CUST_2, customer: desert, show_invoices: false, show_quotes: false, last_accessed_at: null, access_count: 0,
    expires_at: ts(60) }),
  link(3, { label: "Old link", active: false, revoked_at: ts(-5), allow_requests: false }),
  link(4, { customer_id: CUST_2, customer: desert, label: "Trial", expires_at: ts(-3) }),
];

const portal = {
  status: "ok",
  company: { name: "Acme Logistics", name_ar: "أكمي للخدمات اللوجستية", phone: "+968 2400 0000", email: "service@acme.test",
    address: "Muscat", website: null },
  customer: { name: "Gulf Freight Co." },
  today: day(0),
  sections: { vehicles: true, certificates: true, invoices: true, quotes: true, contracts: true, requests: true },
  vehicles: [
    { id: V1, name: "Truck 07", license_plate: "1234 AB", make: "Volvo", model: "FH16", year: 2022, ownership: "customer" },
    { id: "5eed0000-0000-4000-8000-00000000e002", name: "Van 12", license_plate: "5678 CD", make: "Toyota", model: "Hiace", year: 2020, ownership: "customer" },
  ],
  certificates: [
    { id: "18300000-0000-4000-8000-000000000001", certificate_number: "GOM-2026-0101", vehicle: "Truck 07", license_plate: "1234 AB",
      issued_at: day(-40), expires_at: day(325), state: "valid" },
    { id: "18300000-0000-4000-8000-000000000002", certificate_number: "GOM-2025-0044", vehicle: "Truck 07", license_plate: "1234 AB",
      issued_at: day(-405), expires_at: day(-40), state: "superseded" },
    { id: "18300000-0000-4000-8000-000000000003", certificate_number: "GOM-2025-0090", vehicle: "Van 12", license_plate: "5678 CD",
      issued_at: day(-380), expires_at: day(-15), state: "expired" },
  ],
  invoices: [
    { id: "18400000-0000-4000-8000-000000000001", doc_number: "INV-00041", title: "Speed limiter service, September", issue_date: day(-20),
      due_date: day(-5), currency: "USD", total: 1431.75, amount_paid: 0, balance: 1431.75, status: "issued" },
    { id: "18400000-0000-4000-8000-000000000002", doc_number: "INV-00038", title: "Installation", issue_date: day(-50),
      due_date: day(-20), currency: "USD", total: 900, amount_paid: 400, balance: 500, status: "partially_paid" },
    { id: "18400000-0000-4000-8000-000000000003", doc_number: "INV-00031", title: null, issue_date: day(-80),
      due_date: day(-50), currency: "USD", total: 1200, amount_paid: 1200, balance: 0, status: "paid" },
  ],
  quotes: [
    { id: "18500000-0000-4000-8000-000000000001", doc_number: "QUO-00012", title: "Tracking for 25 vans", issue_date: day(-3),
      valid_until: day(27), currency: "USD", total: 9800, status: "sent", public_token: "18500000-0000-4000-8000-0000000000aa" },
  ],
  contracts: [
    { id: "18600000-0000-4000-8000-000000000001", doc_number: "CTR-00001", title: "Speed limiter service 2026", contract_type: "speed_limiter_service",
      start_date: day(-200), end_date: day(165), billing_frequency: "monthly" },
  ],
  requests: [
    { id: rid(1), doc_number: "SRQ-00001", request_type: "inspection", status: "new", created_at: ts(-1), scheduled_for: null, vehicle: "Truck 07" },
    { id: rid(5), doc_number: "SRQ-00005", request_type: "service", status: "scheduled", created_at: ts(-5), scheduled_for: day(3), vehicle: null },
  ],
};

export default {
  tables: { portal_service_requests, customer_portal_access },
  api: {
    [`GET /api/portal/${TOKEN}`]: portal,
    "GET /api/portal/18000000-0000-4000-8000-00000000dead": { __status: 404, __body: { status: "not_found" } },
    "POST /api/portal/*": { ok: true, request: { id: rid(9), doc_number: "SRQ-00009", status: "new" } },
  },
};
