// Regulatory smoke fixture: Omani requirements (some unverified templates, one
// inactive, one Arabic-only authority), obligations in every state for
// vehicles, drivers, employees and the company.
const T = "170d2d86-5c22-4bcb-9d74-420c879419b2";
const VEH_1 = "a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01";
const VEH_2 = "a7e1c0de-0002-4b2c-9d3e-4f5a6b7c8d02";
const VEH_3 = "a7e1c0de-0003-4b2c-9d3e-4f5a6b7c8d03";
const DRV_1 = "d0c0ffee-0001-4a1b-8c2d-3e4f5a6b7c01";
const EMP_1 = "e3000000-0000-4000-8000-000000000001";
const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const ts = (n) => new Date(Date.now() + n * 86_400_000).toISOString();
const rid = (n) => `15100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const oid = (n) => `15200000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const req = (n, o) => ({
  id: rid(n), tenant_id: T, code: `REQ-${n}`, title: "Requirement", title_ar: null, authority: null, country: "OM", category: "license",
  applies_to: "vehicle", frequency_months: 12, lead_days: 30, reference_url: null, description: null, verified: true, active: true,
  created_by: null, updated_by: null, created_at: ts(-90), updated_at: ts(-5), ...o,
});
const compliance_requirements = [
  req(1, { code: "OM-REG", title: "Vehicle registration (Mulkiya) renewal", title_ar: "تجديد ملكية المركبة", authority: "Royal Oman Police",
    reference_url: "https://www.rop.gov.om/", description: "Renew each vehicle's registration before it lapses." }),
  req(2, { code: "OM-SL", title: "Speed limiter certificate", title_ar: "شهادة محدد السرعة", category: "safety", verified: false,
    authority: "Royal Oman Police", description: "Certificates are issued in the Speed limiters module." }),
  req(3, { code: "OM-VAT", title: "VAT return", title_ar: "إقرار ضريبة القيمة المضافة", category: "tax", applies_to: "company",
    frequency_months: 3, lead_days: 14, authority: "Tax Authority", verified: false }),
  req(4, { code: "OM-DRV-LIC", title: "Driving licence renewal", title_ar: "تجديد رخصة القيادة", applies_to: "driver", frequency_months: null }),
  req(5, { code: "OM-LABOUR", title: "Work permit renewal", title_ar: "تجديد تصريح العمل", category: "permit", applies_to: "employee",
    frequency_months: 24, lead_days: 60, authority: "وزارة العمل" }),
  req(6, { code: "OLD-EMIS", title: "Emissions sticker", category: "emissions", active: false, country: null }),
];

const brief = (r) => ({ code: r.code, title: r.title, title_ar: r.title_ar, category: r.category, lead_days: r.lead_days,
  frequency_months: r.frequency_months, active: r.active });
const obl = (n, r, o) => ({
  id: oid(n), tenant_id: T, requirement_id: r.id, subject_type: r.applies_to, subject_id: VEH_1, due_date: day(20), status: "pending",
  completed_on: null, evidence_document_id: null, responsible_user: null, notes: null, created_by: null, updated_by: null,
  created_at: ts(-30), updated_at: ts(-2), requirement: brief(r), responsible: null, ...o,
});
const [R1, R2, R3, R4, R5] = compliance_requirements;
const owner = { full_name: "Demo Owner", email: "demo@fleetmanage.test" };
const compliance_obligations = [
  obl(1, R1, { due_date: day(-4), responsible_user: "129bbbae-fdfc-4d21-8a86-8949fec2403b", responsible: owner }),
  obl(2, R2, { due_date: day(12) }),
  obl(3, R1, { subject_id: VEH_2, due_date: day(75) }),
  obl(4, R2, { subject_id: VEH_2, status: "non_compliant", due_date: day(5), notes: "Seal broken at inspection." }),
  obl(5, R1, { subject_id: VEH_3, status: "compliant", due_date: day(-10), completed_on: day(-12), notes: "Renewed at ROP Sohar." }),
  obl(6, R3, { subject_id: null, due_date: day(-1) }),
  obl(7, R3, { subject_id: null, status: "compliant", due_date: day(-92), completed_on: day(-95) }),
  obl(8, R4, { subject_id: DRV_1, due_date: day(150) }),
  obl(9, R5, { subject_id: EMP_1, due_date: day(40), responsible_user: "129bbbae-fdfc-4d21-8a86-8949fec2403b", responsible: owner }),
  obl(10, R2, { subject_id: VEH_3, status: "waived", due_date: day(-30), notes: "Vehicle exempt: under 3.5 tonnes." }),
];

export default {
  tables: {
    compliance_requirements,
    compliance_obligations,
    employees: [{ id: EMP_1, tenant_id: T, first_name: "Aisha", last_name: "Al Balushi", doc_number: "EMP-00001", status: "active" }],
  },
  rpc: {
    regulatory_seed_templates: () => 9,
    regulatory_generate_obligations: () => 3,
    obligation_complete: () => oid(99),
  },
};
