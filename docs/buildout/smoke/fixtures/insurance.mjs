// Insurance smoke fixture: policies in every derived status (one Arabic
// insurer), covered vehicles with a past one, claims across the pipeline and
// three years of settled claims for the premium chart.
const T = "170d2d86-5c22-4bcb-9d74-420c879419b2";
const VEH_1 = "a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01";
const SUP_1 = "5a000000-0000-4000-8000-000000000023";
const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const ts = (n) => new Date(Date.now() + n * 86_400_000).toISOString();
const pid = (n) => `14300000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const cid = (n) => `14400000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const policy = (n, o) => {
  const p = {
    id: pid(n), tenant_id: T, policy_number: `GS-${2026}-${String(n).padStart(3, "0")}`, insurer_supplier_id: SUP_1, insurer_name: null,
    policy_type: "comprehensive", coverage_amount: 250000, premium: 1200, premium_frequency: "annual", deductible: 250, currency: "USD",
    start_date: day(-200), end_date: day(165), auto_renew: false, broker: null, canceled_at: null, cancel_reason: null, notes: null,
    created_by: null, updated_by: null, created_at: ts(-200), updated_at: ts(-10), ...o,
  };
  p.insurer = p.insurer_supplier_id ? { name: "Gulf Shield Insurance" } : null;
  return p;
};

const insurance_policies = [
  policy(1, { broker: "Al Noor Brokers", notes: "Covers the delivery vans." }),
  policy(2, { policy_number: "OQ-MTR-8812", insurer_supplier_id: null, insurer_name: "الشركة الوطنية للتأمين", policy_type: "third_party",
    premium: 95, premium_frequency: "monthly", start_date: day(-340), end_date: day(12), coverage_amount: null, deductible: null }),
  policy(3, { policy_number: "CARGO-77", policy_type: "cargo", premium: 600, premium_frequency: "quarterly", start_date: day(-30),
    end_date: day(335), coverage_amount: 80000 }),
  policy(4, { policy_number: "GS-2025-004", start_date: day(-560), end_date: day(-195), premium: 1100 }),
  policy(5, { policy_number: "LIAB-2026", policy_type: "liability", premium: 2400, start_date: day(20), end_date: day(384) }),
  policy(6, { policy_number: "GS-2025-009", start_date: day(-300), end_date: day(65), canceled_at: day(-40), cancel_reason: "Vehicle sold" }),
];

const cover = (n, o) => ({
  id: `14500000-0000-4000-8000-${String(n).padStart(12, "0")}`, tenant_id: T, added_on: day(-200), removed_on: null,
  created_by: null, updated_by: null, created_at: ts(-200), updated_at: ts(-200), ...o,
});
const insurance_policy_vehicles = [
  cover(1, { policy_id: pid(1), vehicle_id: VEH_1, vehicle: { name: "Van 04", license_plate: "7ABC219", status: "active" } }),
  cover(2, { policy_id: pid(1), vehicle_id: "a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d02", vehicle: { name: "Truck 12", license_plate: "4KTR882", status: "active" } }),
  cover(3, { policy_id: pid(1), vehicle_id: "a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d03", removed_on: day(-60),
    vehicle: { name: "شاحنة 7", license_plate: "1234 AB", status: "retired" } }),
];

const claim = (n, o) => {
  const c = {
    id: cid(n), tenant_id: T, number: n, doc_number: `CLM-${String(n).padStart(5, "0")}`, policy_id: pid(1), vehicle_id: VEH_1,
    incident_id: null, status: "draft", claim_date: day(-5), loss_date: day(-6), description: "Rear bumper hit while reversing in the yard.",
    amount_claimed: 4200, amount_approved: null, amount_paid: null, deductible_applied: null, currency: "USD", insurer_reference: null,
    adjuster_name: null, adjuster_phone: null, submitted_at: null, decided_at: null, settled_at: null, withdrawn_at: null,
    rejection_reason: null, notes: null, created_by: null, updated_by: null, created_at: ts(-5), updated_at: ts(-1), ...o,
  };
  c.policy = insurance_policies.find((p) => p.id === c.policy_id);
  c.policy = c.policy ? { policy_number: c.policy.policy_number, insurer_name: c.policy.insurer_name, insurer: c.policy.insurer } : null;
  c.vehicle = c.vehicle_id ? { name: "Van 04", license_plate: "7ABC219" } : null;
  return c;
};

const insurance_claims = [
  claim(1, { status: "under_review", insurer_reference: "GS-CL-8841", adjuster_name: "R. Nair", adjuster_phone: "+968 9123 4567",
    submitted_at: ts(-4) }),
  claim(2, { status: "approved", description: "Windscreen cracked by a stone on the Sohar highway.", amount_claimed: 650,
    amount_approved: 600, deductible_applied: 50, submitted_at: ts(-20), decided_at: ts(-3), loss_date: day(-25), claim_date: day(-24) }),
  claim(3, { status: "draft", policy_id: pid(2), vehicle_id: null, description: "خدش في الباب الأيسر أثناء التحميل", amount_claimed: 300 }),
  claim(4, { status: "rejected", description: "Tyre wear", amount_claimed: 420, submitted_at: ts(-40), decided_at: ts(-30),
    rejection_reason: "Wear and tear is excluded.", loss_date: day(-45), claim_date: day(-44) }),
  claim(5, { status: "settled", description: "Side mirror replaced", amount_claimed: 380, amount_approved: 380, amount_paid: 330,
    deductible_applied: 50, submitted_at: ts(-90), decided_at: ts(-80), settled_at: day(-70), loss_date: day(-95), claim_date: day(-92) }),
];
// Settled claims over the last three years for the chart.
for (let y = 1; y <= 2; y++) {
  insurance_claims.push(claim(10 + y, { status: "settled", amount_claimed: 900 * y, amount_approved: 800 * y, amount_paid: 800 * y,
    settled_at: day(-365 * y), loss_date: day(-365 * y - 20), claim_date: day(-365 * y - 18), policy_id: pid(4) }));
}

export default {
  tables: {
    insurance_policies,
    insurance_policy_vehicles,
    insurance_claims,
    suppliers: [{ id: SUP_1, tenant_id: T, name: "Gulf Shield Insurance", doc_number: "SUP-00023", status: "active", supplier_type: "insurance" }],
  },
  rpc: {
    insurance_uninsured_vehicles: () => [
      { id: "a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d04", name: "Pickup 3", license_plate: "9PKP110", status: "active" },
      { id: "a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d05", name: "رافعة شوكية 2", license_plate: null, status: "in_shop" },
    ],
    insurance_renew_policy: () => pid(7),
  },
};
