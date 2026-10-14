// Workshop smoke fixture: four bays (one out of service, one occupied), a day
// of bookings in every state, open work orders waiting for a bay, technicians
// on and off the clock (one linked to the smoke login), six weeks of labor for
// the productivity report, and stock for issuing parts.
const T = "170d2d86-5c22-4bcb-9d74-420c879419b2";
const USER_ID = "129bbbae-fdfc-4d21-8a86-8949fec2403b";
const VEH_1 = "a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01";
const VEH_2 = "a7e1c0de-0002-4b2c-9d3e-4f5a6b7c8d02";
const D = 86_400_000;
const midnight = Math.floor(Date.now() / D) * D;
const dayAt = (h, dayOffset = 0) => new Date(midnight + dayOffset * D + h * 3_600_000).toISOString();
const ago = (mins) => new Date(Date.now() - mins * 60_000).toISOString();
const id = (p, n) => `${p}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const bay = (n) => id("14100000", n);
const wo = (n) => id("14200000", n);
const emp = (n) => id("14300000", n);

const vehicles = { [VEH_1]: { name: "Van 04" }, [VEH_2]: { name: "Truck 12" } };
const workOrders = [
  [1, "Brake pads and discs", VEH_1, "in_progress", "high"],
  [2, "A service, 60,000 km", VEH_2, "open", "normal"],
  [3, "Replace windscreen", VEH_1, "open", "normal"],
  [4, "تغيير زيت المحرك", VEH_2, "open", "low"],
  [5, "Tyre rotation", VEH_1, "completed", "normal"],
  [6, "AC not cooling", VEH_2, "open", "critical"],
].map(([n, title, vehicle_id, status, priority]) => ({
  id: wo(n), tenant_id: T, vehicle_id, number: 4000 + n, title, description: null, status, priority, vendor: null, odometer: null,
  scheduled_date: null, completed_at: status === "completed" ? dayAt(11) : null, issue_id: null, reminder_id: null, tax_rate: 0,
  created_by: null, created_at: dayAt(-24), updated_at: dayAt(-2), vehicles: { ...vehicles[vehicle_id], odometer: 61000 },
}));
const woInfo = (n) => {
  const w = workOrders[n - 1];
  return { number: w.number, title: w.title, status: w.status, vehicles: { name: w.vehicles.name } };
};

const bays = [
  [1, "Lift 1", "L1", "lift", "occupied"],
  [2, "Lift 2", "L2", "lift", "available"],
  [3, "Wash bay", "W1", "wash", "available"],
  [4, "منصة الفحص", "I1", "inspection", "out_of_service"],
].map(([n, name, code, bay_type, status]) => ({
  id: bay(n), tenant_id: T, name, code, bay_type, status, active: true, notes: null, created_at: dayAt(-500),
  created_by: null, updated_by: null, updated_at: dayAt(-3),
}));
const bayInfo = (n) => ({ name: bays[n - 1].name, code: bays[n - 1].code });

const booking = (n, bayN, woN, from, to, status, extra = {}) => ({
  id: id("14400000", n), tenant_id: T, bay_id: bay(bayN), work_order_id: wo(woN), starts_at: from, ends_at: to, status,
  started_at: status === "in_progress" || status === "done" ? from : null, finished_at: status === "done" ? to : null, notes: null,
  created_by: null, updated_by: null, created_at: dayAt(-30), updated_at: dayAt(-1), ...extra,
  bay: bayInfo(bayN), work_order: woInfo(woN),
});
const workshop_bookings = [
  booking(1, 1, 5, dayAt(7), dayAt(9.5), "done"),
  booking(2, 1, 1, dayAt(10), dayAt(15), "in_progress"),
  booking(3, 2, 2, dayAt(8), dayAt(11), "done"),
  booking(4, 2, 3, dayAt(16), dayAt(19), "scheduled", { notes: "Glass arrives at 15:30." }),
  booking(5, 3, 2, dayAt(12), dayAt(13), "canceled"),
  booking(6, 3, 3, dayAt(9, 1), dayAt(11, 1), "scheduled"),
];

const employees = [
  [1, "Imran", "Khan", "Senior technician", 4.5, USER_ID],
  [2, "Joseph", "Mathew", "Technician", 3.75, null],
  [3, "سالم", "الحارثي", "فني كهرباء", 4, null],
].map(([n, first_name, last_name, job_title, hourly_rate, user_id]) => ({
  id: emp(n), tenant_id: T, number: n, doc_number: `EMP-${String(n).padStart(5, "0")}`, first_name, last_name, name_ar: null, job_title,
  status: "active", hourly_rate, user_id, created_at: dayAt(-900), updated_at: dayAt(-10),
}));
const empInfo = (n) => ({ first_name: employees[n - 1].first_name, last_name: employees[n - 1].last_name });

const labor = (n, empN, woN, started, ended, hours, extra = {}) => {
  const rate = employees[empN - 1].hourly_rate;
  return {
    id: id("14500000", n), tenant_id: T, work_order_id: wo(woN), employee_id: emp(empN), started_at: started, ended_at: ended,
    hours, hourly_rate: rate, cost: hours == null ? 0 : Math.round(hours * rate * 1000) / 1000, notes: null, work_order_line_id: null,
    created_by: null, updated_by: null, created_at: started, updated_at: ended ?? started, ...extra,
    employee: empInfo(empN), work_order: { number: woInfo(woN).number, title: woInfo(woN).title, vehicles: woInfo(woN).vehicles },
  };
};
const work_order_labor = [
  labor(1, 2, 1, ago(95), null, null),
  labor(2, 1, 5, dayAt(7), dayAt(9.5), 2.5, { notes: "Rotated and balanced." }),
  labor(3, 3, 2, dayAt(8), dayAt(10.75), 2.75),
];
for (let w = 0; w < 6; w++) {
  for (let k = 0; k < 3; k++) {
    const n = 100 + w * 10 + k;
    const start = dayAt(8 + k, -7 * w - 2);
    const hours = 3 + ((w + k) % 4) * 1.5;
    work_order_labor.push(labor(n, (k % 3) + 1, 5, start, new Date(Date.parse(start) + hours * 3_600_000).toISOString(), hours));
  }
}

const work_order_lines = [
  { id: id("14600000", 1), tenant_id: T, work_order_id: wo(1), category: "part", description: "Brake pads (BP-220)", quantity: 2, unit_cost: 38.5, created_at: dayAt(10) },
  { id: id("14600000", 2), tenant_id: T, work_order_id: wo(1), category: "labor", description: "Joseph Mathew", quantity: 1.5, unit_cost: 3.75, created_at: dayAt(10) },
];

export default {
  tables: {
    work_orders: workOrders,
    work_order_lines,
    workshop_bays: bays,
    workshop_bookings,
    work_order_labor,
    employees,
    warehouses: [{ id: id("14700000", 1), tenant_id: T, code: "MAIN", name: "Main store", is_default: true, active: true }],
    inventory_items: [{ id: id("14800000", 1), tenant_id: T, sku: "BP-220", name: "Brake pads (set)", active: true, cost_price: 38.5, uom: "set" }],
  },
  rpc: {
    workshop_clock_on: () => id("14500000", 999),
    workshop_clock_off: () => 1.5,
    workshop_issue_part: () => id("14600000", 999),
  },
};
