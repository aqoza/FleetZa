// CRM smoke fixture: leads in every status (one converted, one Arabic), open
// opportunities across the stages with close dates over the next months plus
// won and lost deals, and activities that are overdue, due today, upcoming,
// done and unscheduled.
const T = "170d2d86-5c22-4bcb-9d74-420c879419b2";
const ME = "129bbbae-fdfc-4d21-8a86-8949fec2403b";
const CUST_1 = "c1a0e5f2-3b4d-4e6f-8a9b-0c1d2e3f4a51";
const CUST_2 = "c1a0e5f2-3b4d-4e6f-8a9b-0c1d2e3f4a52";
const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const ts = (n) => new Date(Date.now() + n * 86_400_000).toISOString();
const hrs = (n) => new Date(Date.now() + n * 3_600_000).toISOString();
const lid = (n) => `16100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const oid = (n) => `16200000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const aid = (n) => `16300000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = { full_name: "Demo Owner", email: "demo@fleetmanage.test" };
const sara = { full_name: "Sara Haddad", email: "sara@fleetmanage.test" };
const actor = { created_by: ME, updated_by: ME };

const lead = (n, o) => ({
  id: lid(n), tenant_id: T, number: n, doc_number: `LEAD-${String(n).padStart(5, "0")}`, name: "Contact", company_name: null,
  email: null, phone: null, source: "website", status: "new", owner_id: ME, estimated_value: null, currency: "USD", fleet_size: null,
  interest: null, notes: null, converted_customer_id: null, converted_opportunity_id: null, converted_at: null,
  created_at: ts(-n * 3), updated_at: ts(-1), owner, ...actor, ...o,
});
const crm_leads = [
  lead(1, { name: "Khalid Al Rashdi", company_name: "Rashdi Transport", email: "khalid@rashdi.test", phone: "+968 9123 4567",
    source: "referral", status: "qualified", estimated_value: 12000, fleet_size: 40, interest: "Speed limiters for 40 trucks" }),
  lead(2, { name: "Maya Chen", company_name: "Bayline Couriers", email: "maya@bayline.test", source: "website", status: "contacted",
    estimated_value: 4500, fleet_size: 12, interest: "Telematics pilot" }),
  lead(3, { name: "سالم الحارثي", company_name: "مؤسسة الحارثي للنقل", phone: "+968 9555 0101", source: "walk_in",
    interest: "محددات سرعة لعشر حافلات", fleet_size: 10, owner_id: null, owner: null }),
  lead(4, { name: "Tom Becker", source: "event", status: "unqualified", notes: "Only one private car." }),
  lead(5, { name: "Lena Ortiz", company_name: "Desert Transport LLC", source: "partner", status: "converted", estimated_value: 9000,
    converted_customer_id: CUST_2, converted_opportunity_id: oid(5), converted_at: ts(-20), owner_id: "5eed0000-0000-4000-8000-0000000000a1", owner: sara }),
];

const opp = (n, o) => ({
  id: oid(n), tenant_id: T, number: n, doc_number: `OPP-${String(n).padStart(5, "0")}`, title: "Deal", customer_id: CUST_1, lead_id: null,
  stage: "prospecting", amount: 1000, currency: "USD", probability: 10, expected_close_date: day(30), owner_id: ME, lost_reason: null,
  quote_id: null, won_at: null, lost_at: null, notes: null, created_at: ts(-n * 4), updated_at: ts(-1),
  customer: { name: "Gulf Freight Co." }, lead: null, owner, ...actor, ...o,
});
const crm_opportunities = [
  opp(1, { title: "Fleet-wide speed limiter refit", amount: 18000, stage: "negotiation", probability: 75, expected_close_date: day(-3),
    notes: "Waiting on their finance sign-off." }),
  opp(2, { title: "Annual certificate renewals", amount: 6400, stage: "proposal", probability: 50, expected_close_date: day(20) }),
  opp(3, { title: "GPS tracking for 25 vans", amount: 9800, stage: "qualification", probability: 25, expected_close_date: day(48),
    customer_id: null, customer: null, lead_id: lid(2), lead: { doc_number: "LEAD-00002", name: "Maya Chen" } }),
  opp(4, { title: "Driver behaviour coaching", amount: 3200, stage: "prospecting", probability: 10, expected_close_date: null }),
  opp(5, { title: "Desert Transport onboarding", amount: 9000, stage: "won", probability: 100, customer_id: CUST_2,
    customer: { name: "Desert Transport LLC" }, lead_id: lid(5), lead: { doc_number: "LEAD-00005", name: "Lena Ortiz" },
    won_at: ts(-2), expected_close_date: day(-2), owner_id: "5eed0000-0000-4000-8000-0000000000a1", owner: sara }),
  opp(6, { title: "Workshop software", amount: 5000, stage: "lost", probability: 0, lost_reason: "Chose a cheaper supplier.", lost_at: ts(-40),
    expected_close_date: day(-45) }),
  opp(7, { title: "Tachograph calibration contract", amount: 7200, stage: "proposal", probability: 60, expected_close_date: day(80),
    customer_id: CUST_2, customer: { name: "Desert Transport LLC" } }),
];

const act = (n, o) => ({
  id: aid(n), tenant_id: T, activity_type: "call", subject: "Follow up", body: null, due_at: ts(2), done_at: null, owner_id: ME,
  lead_id: null, opportunity_id: oid(1), customer_id: CUST_1, created_at: ts(-n), updated_at: ts(-n), owner,
  lead: null, opportunity: { doc_number: "OPP-00001", title: "Fleet-wide speed limiter refit" }, customer: { name: "Gulf Freight Co." },
  ...actor, ...o,
});
const crm_activities = [
  act(1, { subject: "Chase finance approval", due_at: ts(-2) }),
  act(2, { activity_type: "meeting", subject: "Site visit at the depot", due_at: hrs(3), body: "Bring two demo units." }),
  act(3, { activity_type: "email", subject: "Send revised pricing", due_at: ts(4), opportunity_id: oid(2),
    opportunity: { doc_number: "OPP-00002", title: "Annual certificate renewals" } }),
  act(4, { activity_type: "whatsapp", subject: "Confirm fleet list", due_at: ts(-6), done_at: ts(-5) }),
  act(5, { activity_type: "note", subject: "Prefers Arabic paperwork", due_at: null, done_at: ts(-7) }),
  act(6, { activity_type: "task", subject: "Prepare demo", due_at: null, opportunity_id: null, opportunity: null, customer_id: null,
    customer: null, lead_id: lid(1), lead: { doc_number: "LEAD-00001", name: "Khalid Al Rashdi" } }),
];

export default {
  tables: { crm_leads, crm_opportunities, crm_activities },
  rpc: {
    crm_convert_lead: () => ({ customer_id: CUST_1, contact_id: "16400000-0000-4000-8000-000000000001", opportunity_id: oid(1) }),
  },
};
