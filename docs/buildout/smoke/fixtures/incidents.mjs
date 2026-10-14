// Incidents smoke fixture: incidents in every status and severity (one in
// Arabic), parties and a status timeline on the first, a year of history for
// the monthly chart and the driver ranking.
const T = "170d2d86-5c22-4bcb-9d74-420c879419b2";
const VEH_1 = "a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01";
const DRV_1 = "d71e0000-0000-4000-8000-000000000001";
const DRV_2 = "d71e0000-0000-4000-8000-000000000002";
const DRV_3 = "d71e0000-0000-4000-8000-000000000003";
const ts = (n) => new Date(Date.now() + n * 86_400_000).toISOString();
const iid = (n) => `14600000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const drivers = {
  [DRV_1]: { first_name: "Salim", last_name: "Al Harthy" },
  [DRV_2]: { first_name: "أحمد", last_name: "البلوشي" },
  [DRV_3]: { first_name: "Ravi", last_name: "Kumar" },
};

const incident = (n, o) => {
  const i = {
    id: iid(n), tenant_id: T, number: n, doc_number: `INC-${String(n).padStart(5, "0")}`, vehicle_id: VEH_1, driver_id: DRV_1,
    occurred_at: ts(-2), location: "Sohar port gate 3", lat: null, lng: null, incident_type: "collision", severity: "minor",
    description: "Reversed into a bollard while leaving the loading bay.", injuries: 0, fatalities: 0, police_report_number: null,
    police_station: null, at_fault: "our_driver", estimated_damage: 350, actual_cost: null, currency: "USD", vehicle_drivable: true,
    status: "reported", driving_event_id: null, issue_id: null, work_order_id: null, claim_id: null, root_cause: null,
    corrective_actions: null, resolved_at: null, closed_at: null, notes: null, created_by: null, updated_by: null,
    created_at: ts(-2), updated_at: ts(-1), ...o,
  };
  i.vehicle = { name: "Van 04", license_plate: "7ABC219" };
  i.driver = i.driver_id ? drivers[i.driver_id] : null;
  i.work_order = i.work_order_id ? { number: 118, status: "in_progress" } : null;
  return i;
};

const incidents = [
  incident(1, { severity: "major", status: "investigating", occurred_at: ts(-6), injuries: 1, at_fault: "third_party",
    description: "Hit from the side at the Falaj roundabout by a car running the red light.", location: "Falaj Al Qabail roundabout",
    police_report_number: "ROP-SH-2026-4471", police_station: "Sohar police station", estimated_damage: 5200, vehicle_drivable: false,
    work_order_id: "0e000000-0000-4000-8000-000000000118" }),
  incident(2, { driver_id: DRV_2, severity: "moderate", status: "awaiting_repair", incident_type: "vandalism", occurred_at: ts(-12),
    description: "كسر زجاج النافذة الخلفية أثناء التوقف ليلًا", location: "صحار", at_fault: "none", estimated_damage: 800 }),
  incident(3),
  incident(4, { severity: "critical", status: "resolved", occurred_at: ts(-30), injuries: 2, driver_id: DRV_3, actual_cost: 14800,
    description: "Rolled over on the Sohar–Buraimi road after a tyre burst.", resolved_at: ts(-3), claim_id: "14400000-0000-4000-8000-000000000001" }),
  incident(5, { status: "closed", incident_type: "near_miss", occurred_at: ts(-50), estimated_damage: null, at_fault: "unknown",
    description: "Pedestrian stepped out at the depot exit; driver braked in time.", root_cause: "Blind corner at the exit",
    corrective_actions: "Mirror installed at the exit.", closed_at: ts(-40), resolved_at: ts(-45) }),
];
// History across the year for the chart and driver ranking.
const hist = [
  [-75, "theft", "moderate", DRV_2, "none", 2100], [-110, "collision", "minor", DRV_1, "our_driver", 400],
  [-150, "collision", "major", DRV_1, "shared", 6400], [-200, "breakdown", "minor", DRV_3, "none", 250],
  [-240, "collision", "minor", DRV_3, "our_driver", 520], [-290, "weather", "moderate", null, "none", 1300],
];
hist.forEach(([d, type, sev, drv, fault, cost], k) =>
  incidents.push(incident(10 + k, { occurred_at: ts(d), incident_type: type, severity: sev, driver_id: drv, at_fault: fault,
    actual_cost: cost, estimated_damage: null, status: "closed", root_cause: "Recorded", closed_at: ts(d + 10) })));

const party = (n, o) => ({
  id: `14700000-0000-4000-8000-${String(n).padStart(12, "0")}`, tenant_id: T, incident_id: iid(1), party_type: "third_party_driver",
  name: "Khalid Al Maamari", phone: "+968 9234 5678", vehicle_plate: "33219 R", insurer: "Dhofar Insurance", insurance_policy_number: "DH-77120",
  statement: "Says the light was amber.", created_by: null, updated_by: null, created_at: ts(-6), updated_at: ts(-6), ...o,
});

const ev = (n, status, d) => ({ id: `14800000-0000-4000-8000-${String(n).padStart(12, "0")}`, tenant_id: T, incident_id: iid(1), status, at: ts(d) });

export default {
  tables: {
    incidents,
    incident_parties: [
      party(1),
      party(2, { party_type: "witness", name: "فاطمة الكندي", vehicle_plate: null, insurer: null, insurance_policy_number: null,
        statement: "رأيت السيارة الأخرى تتجاوز الإشارة الحمراء." }),
      party(3, { party_type: "police", name: "Sgt. Hamed", phone: null, vehicle_plate: null, insurer: null, insurance_policy_number: null, statement: null }),
    ],
    incident_events: [ev(1, "reported", -6), ev(2, "investigating", -5)],
  },
  rpc: {
    incident_create_work_order: () => "0e000000-0000-4000-8000-000000000119",
    incident_create_claim: () => "14400000-0000-4000-8000-000000000009",
  },
};
