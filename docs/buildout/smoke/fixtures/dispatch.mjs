// Dispatch smoke fixture: open jobs in every board column (one urgent, one late,
// one unassigned), today's jobs on two vehicles, a canceled job and thirty days
// of completions (a few late) for the SLA numbers.
const T = "170d2d86-5c22-4bcb-9d74-420c879419b2";
const VEH_1 = "a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01";
const VEH_2 = "a7e1c0de-0002-4b2c-9d3e-4f5a6b7c8d02";
const VEH_3 = "a7e1c0de-0003-4b2c-9d3e-4f5a6b7c8d03";
const DRV_1 = "d0c0ffee-0001-4a1b-8c2d-3e4f5a6b7c01";
const DRV_2 = "d0c0ffee-0002-4a1b-8c2d-3e4f5a6b7c02";
const CUST_1 = "c1a0e5f2-3b4d-4e6f-8a9b-0c1d2e3f4a51";
const H = 3_600_000;
const at = (hours) => new Date(Math.floor(Date.now() / H) * H + hours * H).toISOString();
const veh = {
  [VEH_1]: { name: "Truck 12", license_plate: "8KLM392" },
  [VEH_2]: { name: "Van 04", license_plate: "7ABC219" },
  [VEH_3]: { name: "GF Tractor 7", license_plate: "4TRK771" },
};
const drv = { [DRV_1]: { first_name: "Maria", last_name: "Lopez" }, [DRV_2]: { first_name: "Omar", last_name: "Haddad" } };
const id = (n) => `12000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const job = (n, o) => ({
  id: id(n), tenant_id: T, number: n, doc_number: `DSP-${String(n).padStart(5, "0")}`, customer_id: null, contact_name: null,
  contact_phone: null, job_type: "delivery", priority: "normal", pickup_address: null, pickup_lat: null, pickup_lng: null,
  dropoff_address: null, dropoff_lat: null, dropoff_lng: null, vehicle_id: null, driver_id: null, assigned_at: null,
  en_route_at: null, on_site_at: null, completed_at: null, canceled_at: null, notes: null, completion_notes: null, cancel_reason: null,
  created_at: at(-30), updated_at: at(-1), ...o,
  vehicle: o.vehicle_id ? veh[o.vehicle_id] : null, driver: o.driver_id ? drv[o.driver_id] : null,
  customer: o.customer_id ? { name: "Gulf Freight Co." } : null,
});

const jobs = [
  job(101, { title: "Deliver 12 pallets to Rusayl warehouse", priority: "urgent", status: "new", customer_id: CUST_1,
    contact_name: "Salim Al Harthi", contact_phone: "+968 9123 4567", window_start: at(1), window_end: at(4),
    pickup_address: "Ghala Industrial Area", dropoff_address: "Rusayl Industrial Estate, Block 3" }),
  job(102, { title: "Collect returns from Barka depot", job_type: "pickup", status: "new", window_start: at(5), window_end: at(9) }),
  job(103, { title: "Generator service visit", job_type: "service", priority: "high", status: "assigned", vehicle_id: VEH_2,
    driver_id: DRV_2, assigned_at: at(-3), window_start: at(2), window_end: at(5) }),
  job(104, { title: "Transfer trailer to Sohar yard", job_type: "transfer", status: "en_route", vehicle_id: VEH_1, driver_id: DRV_1,
    assigned_at: at(-6), en_route_at: at(-1), window_start: at(-2), window_end: at(1), customer_id: CUST_1 }),
  job(105, { title: "توصيل قطع غيار إلى نزوى", status: "on_site", vehicle_id: VEH_3, assigned_at: at(-8), en_route_at: at(-5),
    on_site_at: at(-0.5), window_start: at(-6), window_end: at(-1), priority: "high" }),
  job(106, { title: "Office furniture delivery", status: "canceled", window_start: at(3), window_end: at(6), canceled_at: at(-2),
    cancel_reason: "Customer postponed" }),
  job(107, { title: "Morning pallet run", status: "completed", vehicle_id: VEH_1, driver_id: DRV_1, assigned_at: at(-12),
    en_route_at: at(-8), on_site_at: at(-7), completed_at: at(-6.5), window_start: at(-9), window_end: at(-6),
    completion_notes: "Signed by gate security." }),
];
// Thirty days of completions: about one in five late.
for (let d = 1; d <= 28; d++) {
  const start = -24 * d + 2;
  const late = d % 5 === 0;
  jobs.push(job(200 + d, {
    title: ["Rusayl delivery", "Barka pickup", "Sohar transfer"][d % 3], job_type: ["delivery", "pickup", "transfer"][d % 3],
    status: "completed", vehicle_id: [VEH_1, VEH_2, VEH_3][d % 3], driver_id: d % 2 ? DRV_2 : DRV_1, window_start: at(start),
    window_end: at(start + 3), assigned_at: at(start - 4), en_route_at: at(start), on_site_at: at(start + 1),
    completed_at: at(start + (late ? 3 + (d % 3) + 0.75 : 2.5)),
  }));
}

export default {
  tables: { dispatch_jobs: jobs },
  rpc: {
    dispatch_busy: () => [
      { kind: "vehicle", resource_id: VEH_1, job_id: id(104), doc_number: "DSP-00104", status: "en_route" },
      { kind: "driver", resource_id: DRV_1, job_id: id(104), doc_number: "DSP-00104", status: "en_route" },
    ],
    dispatch_assign: () => null,
  },
};
