// Deliveries smoke fixture: a route out today with mixed results, a planned
// route for tomorrow, waiting deliveries (one Arabic), a returned one and
// two weeks of history for the overview chart. Public tracking responses for
// a delivery out for delivery, a delivered one and a bad token.
const T = "170d2d86-5c22-4bcb-9d74-420c879419b2";
const VEH_1 = "a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01";
const VEH_2 = "a7e1c0de-0002-4b2c-9d3e-4f5a6b7c8d02";
const DRV_1 = "d0c0ffee-0001-4a1b-8c2d-3e4f5a6b7c01";
const DRV_2 = "d0c0ffee-0002-4a1b-8c2d-3e4f5a6b7c02";
const CUST_1 = "c1a0e5f2-3b4d-4e6f-8a9b-0c1d2e3f4a51";
const H = 3_600_000;
const at = (hours) => new Date(Math.floor(Date.now() / H) * H + hours * H).toISOString();
const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const veh = { [VEH_1]: { name: "Van 04", license_plate: "7ABC219" }, [VEH_2]: { name: "Truck 12", license_plate: "8KLM392" } };
const drv = { [DRV_1]: { first_name: "Maria", last_name: "Lopez" }, [DRV_2]: { first_name: "Omar", last_name: "Haddad" } };
const rid = (n) => `12100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const did = (n) => `12200000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SIG = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMTAwIj48cGF0aCBkPSJNMjAgNzAgQyA1MCAxMCwgNzAgOTAsIDEwMCA1MCBTIDE1MCAyMCwgMTcwIDYwIFMgMjMwIDgwLCAyODAgMzAiIHN0cm9rZT0iIzBmMTcyYSIgc3Ryb2tlLXdpZHRoPSIzIiBmaWxsPSJub25lIi8+PC9zdmc+";

const routeInfo = {
  [rid(1)]: { doc_number: "RTE-00001", route_date: day(0), status: "out_for_delivery" },
  [rid(2)]: { doc_number: "RTE-00002", route_date: day(1), status: "planned" },
};

const delivery = (n, o) => ({
  id: did(n), tenant_id: T, number: n, doc_number: `DLV-${String(n).padStart(5, "0")}`, customer_id: null, reference: null,
  route_id: null, sequence: null, recipient_phone: null, city: "Muscat", lat: null, lng: null, parcels: 1, weight_kg: null,
  cod_amount: 0, cod_collected: null, instructions: null, status: "pending", attempts: 0, delivered_at: null, failed_at: null,
  returned_at: null, pod_name: null, pod_signature: null, pod_photo_path: null, failure_reason: null, failure_note: null,
  tracking_token: `7a000000-0000-4000-8000-${String(n).padStart(12, "0")}`, created_at: at(-30), updated_at: at(-1), ...o,
  customer: o.customer_id ? { name: "Gulf Freight Co." } : null,
  route: o.route_id ? routeInfo[o.route_id] : null,
});

const deliveries = [
  delivery(1, { route_id: rid(1), sequence: 1, status: "delivered", recipient_name: "Aisha Al Balushi", recipient_phone: "+968 9123 4567",
    address: "Way 3021, Al Khuwair", lat: 23.5957, lng: 58.4167, parcels: 2, cod_amount: 12.5, cod_collected: 12.5, attempts: 1,
    delivered_at: at(-3), pod_name: "Aisha", pod_signature: SIG, customer_id: CUST_1, reference: "SO-1042" }),
  delivery(2, { route_id: rid(1), sequence: 2, status: "failed", recipient_name: "Khalid Said", address: "Building 44, Ruwi",
    lat: 23.588, lng: 58.545, attempts: 1, failed_at: at(-2), failure_reason: "not_home", failure_note: "Gate locked, no answer." }),
  delivery(3, { route_id: rid(1), sequence: 3, status: "out_for_delivery", recipient_name: "فاطمة ناصر", recipient_phone: "+968 9988 7766",
    address: "الحيل الشمالية، سكة 12", city: "السيب", lat: 23.65, lng: 58.2, cod_amount: 4.25, instructions: "اتصل قبل الوصول بعشر دقائق." }),
  delivery(4, { route_id: rid(1), sequence: 4, status: "out_for_delivery", recipient_name: "Rashid Al Hinai", address: "Bausher Heights, Villa 7",
    lat: 23.56, lng: 58.4, parcels: 3, weight_kg: 18.5 }),
  delivery(5, { route_id: rid(2), sequence: 1, status: "assigned", recipient_name: "Salma Al Lawati", address: "Qurum Heights", lat: 23.61, lng: 58.48 }),
  delivery(6, { route_id: rid(2), sequence: 2, status: "assigned", recipient_name: "Yousef Al Kindi", address: "Azaiba North", lat: 23.59, lng: 58.37, cod_amount: 9 }),
  delivery(7, { recipient_name: "Huda Al Rawahi", address: "Mawaleh South, Way 8", city: "Seeb", lat: 23.63, lng: 58.25, cod_amount: 22 }),
  delivery(8, { recipient_name: "Nasser Al Farsi", address: "Al Hail North", city: "Seeb" }),
  delivery(9, { recipient_name: "مريم البلوشية", address: "الخوير، طريق 33", lat: 23.6, lng: 58.42, reference: "INV-2210" }),
  delivery(10, { status: "returned", recipient_name: "Ali Al Busaidi", address: "Wattayah", attempts: 2, returned_at: at(-26),
    failed_at: at(-27), failure_reason: "refused" }),
];
// Two weeks of finished deliveries for the chart: mostly first attempt.
for (let d = 1; d <= 13; d++) {
  for (let k = 0; k < 2 + (d % 3); k++) {
    const n = 100 + d * 10 + k;
    const failed = (d + k) % 6 === 0;
    deliveries.push(delivery(n, failed
      ? { status: "pending", recipient_name: `Customer ${n}`, address: "Ruwi", attempts: 1, failed_at: at(-24 * d + 2) }
      : { status: "delivered", recipient_name: `Customer ${n}`, address: "Ruwi", attempts: (d + k) % 5 === 0 ? 2 : 1,
          delivered_at: at(-24 * d + 3), pod_name: "Signed", cod_amount: k ? 5 : 0, cod_collected: k ? (d === 4 ? 3 : 5) : 0 }));
  }
}

const route = (n, o) => ({
  id: rid(n), tenant_id: T, number: n, doc_number: `RTE-${String(n).padStart(5, "0")}`, driver_id: null, depot_name: "Ghala depot",
  depot_lat: 23.588, depot_lng: 58.383, started_at: null, completed_at: null, canceled_at: null, notes: null, created_at: at(-40), ...o,
  vehicle: veh[o.vehicle_id], driver: o.driver_id ? drv[o.driver_id] : null,
  deliveries: deliveries.filter((d) => d.route_id === rid(n)).map((d) => ({ status: d.status })),
});

export default {
  tables: {
    deliveries,
    delivery_routes: [
      route(1, { route_date: day(0), vehicle_id: VEH_1, driver_id: DRV_1, status: "out_for_delivery", started_at: at(-5) }),
      route(2, { route_date: day(1), vehicle_id: VEH_2, driver_id: DRV_2, status: "planned", notes: "Load from bay 3." }),
      route(3, { route_date: day(-1), vehicle_id: VEH_2, status: "completed", started_at: at(-30), completed_at: at(-20), depot_lat: null, depot_lng: null, depot_name: null }),
    ],
  },
  rpc: {
    delivery_route_plan: () => null,
    deliveries_import: () => 3,
  },
  api: {
    "GET /api/track/7a000000-0000-4000-8000-000000000003": {
      status: "out_for_delivery", docNumber: "DLV-00003", recipientFirstName: "فاطمة", city: "السيب",
      updatedAt: at(-1), deliveredAt: null, companyName: "Acme Logistics",
    },
    "GET /api/track/7a000000-0000-4000-8000-000000000001": {
      status: "delivered", docNumber: "DLV-00001", recipientFirstName: "Aisha", city: "Muscat",
      updatedAt: at(-3), deliveredAt: at(-3), companyName: "Acme Logistics",
    },
    "GET /api/track/*": { __status: 404, __body: { status: "not_found" } },
  },
};
