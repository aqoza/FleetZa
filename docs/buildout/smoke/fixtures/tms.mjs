// TMS smoke fixture: shipments across every status (own fleet and third-party
// carriers, one Arabic customer site, an exception, a late and an on-time
// delivery, an invoiced one), a tracking timeline, lane rates and eight weeks
// of history for the revenue chart.
const T = "170d2d86-5c22-4bcb-9d74-420c879419b2";
const VEH_1 = "a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01";
const DRV_1 = "d0c0ffee-0001-4a1b-8c2d-3e4f5a6b7c01";
const CUST_1 = "c1a0e5f2-3b4d-4e6f-8a9b-0c1d2e3f4a51";
const SUP_1 = "5a000000-0000-4000-8000-000000000001";
const H = 3_600_000;
const at = (hours) => new Date(Math.floor(Date.now() / H) * H + hours * H).toISOString();
const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const sid = (n) => `13100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const INV = "13900000-0000-4000-8000-000000000001";

const shipment = (n, o) => {
  const s = {
    id: sid(n), tenant_id: T, number: n, doc_number: `SHP-${String(n).padStart(5, "0")}`, customer_id: CUST_1, status: "draft",
    mode: "road_ftl", service_level: "standard", origin_name: null, origin_address: null, origin_city: "Muscat", origin_country: "OM",
    origin_lat: null, origin_lng: null, destination_name: null, destination_address: null, destination_city: "Sohar",
    destination_country: "OM", destination_lat: null, destination_lng: null, pickup_window_start: null, pickup_window_end: null,
    delivery_window_start: null, delivery_window_end: null, cargo_description: null, pieces: null, weight_kg: null, volume_m3: null,
    hazardous: false, carrier_type: "own", vehicle_id: null, driver_id: null, carrier_supplier_id: null, freight_charge: 0,
    fuel_surcharge: 0, other_charges: 0, carrier_cost: null, currency: "USD", customer_ref: null, bol_number: null, booked_at: null,
    dispatched_at: null, picked_up_at: null, delivered_at: null, closed_at: null, canceled_at: null, received_by: null, pod_notes: null,
    cancel_reason: null, notes: null, invoice_id: null, created_by: null, updated_by: null, created_at: at(-48), updated_at: at(-2), ...o,
  };
  s.total_charge = s.freight_charge + s.fuel_surcharge + s.other_charges;
  s.margin = s.carrier_cost == null ? null : s.total_charge - s.carrier_cost;
  s.customer = { name: s.customer_id === CUST_1 ? "Gulf Freight Co." : "Oman Cement" };
  s.vehicle = s.vehicle_id ? { name: "Van 04", license_plate: "7ABC219" } : null;
  s.driver = s.driver_id ? { first_name: "Maria", last_name: "Lopez" } : null;
  s.carrier = s.carrier_supplier_id ? { name: "Desert Haulage LLC" } : null;
  s.invoice = s.invoice_id ? { doc_number: "INV-2026-0108", status: "draft" } : null;
  return s;
};

const shipments = [
  shipment(1, { status: "in_transit", vehicle_id: VEH_1, driver_id: DRV_1, freight_charge: 320, fuel_surcharge: 25, carrier_cost: 210,
    origin_name: "Ghala warehouse", origin_address: "Street 41, Ghala Industrial", destination_name: "Sohar Port gate 2",
    destination_address: "Sohar Port", pickup_window_start: at(-8), pickup_window_end: at(-6), delivery_window_end: at(6),
    cargo_description: "Steel coils", pieces: 12, weight_kg: 18000, customer_ref: "PO-7781", bol_number: "BL-22031",
    booked_at: at(-30), dispatched_at: at(-9), picked_up_at: at(-7) }),
  shipment(2, { status: "exception", carrier_type: "third_party", carrier_supplier_id: SUP_1, mode: "road_ltl", service_level: "express",
    origin_city: "Nizwa", destination_city: "صلالة", destination_name: "مستودع الدقم", destination_address: "المنطقة الصناعية، شارع 5",
    freight_charge: 540, carrier_cost: 600, cargo_description: "مواد بناء", weight_kg: 4200, hazardous: true,
    booked_at: at(-50), dispatched_at: at(-26), picked_up_at: at(-24) }),
  shipment(3, { status: "booked", origin_city: "Muscat", destination_city: "Ibri", freight_charge: 180, pickup_window_start: at(20),
    pickup_window_end: at(24), booked_at: at(-3) }),
  shipment(4, { status: "draft", destination_city: "Sur", freight_charge: 0, notes: "Waiting on customer volumes." }),
  shipment(5, { status: "delivered", vehicle_id: VEH_1, freight_charge: 300, fuel_surcharge: 25, carrier_cost: 200, received_by: "Ali Hamad",
    pod_notes: "Two pallets wrapped", delivery_window_end: at(-20), delivered_at: at(-22), dispatched_at: at(-40), booked_at: at(-60),
    picked_up_at: at(-38), customer_ref: "PO-7702" }),
  shipment(6, { status: "closed", carrier_type: "third_party", carrier_supplier_id: SUP_1, freight_charge: 410, carrier_cost: 330,
    received_by: "Store manager", delivery_window_end: at(-80), delivered_at: at(-74), dispatched_at: at(-100), booked_at: at(-120),
    closed_at: at(-50), invoice_id: INV, customer_id: "c1a0e5f2-3b4d-4e6f-8a9b-0c1d2e3f4a52" }),
  shipment(7, { status: "canceled", freight_charge: 150, cancel_reason: "Customer withdrew the order.", canceled_at: at(-12) }),
];
// Eight weeks of finished work for the overview chart.
for (let w = 1; w <= 7; w++) {
  for (let k = 0; k < 2 + (w % 3); k++) {
    const n = 100 + w * 10 + k;
    const charge = 200 + ((w * 37 + k * 53) % 260);
    shipments.push(shipment(n, { status: "closed", vehicle_id: VEH_1, freight_charge: charge, carrier_cost: Math.round(charge * 0.68),
      delivered_at: at(-24 * 7 * w + k * 5), delivery_window_end: at(-24 * 7 * w + k * 5 + ((w + k) % 4 === 0 ? -2 : 3)),
      created_at: at(-24 * 7 * w - 30) }));
  }
}

const ev = (n, o) => ({ id: `13200000-0000-4000-8000-${String(n).padStart(12, "0")}`, tenant_id: T, status: null, location: null,
  note: null, created_by: null, created_at: o.at, ...o });
const shipment_events = [
  ev(1, { shipment_id: sid(1), status: "draft", at: at(-48) }),
  ev(2, { shipment_id: sid(1), status: "booked", at: at(-30) }),
  ev(3, { shipment_id: sid(1), status: "dispatched", at: at(-9) }),
  ev(4, { shipment_id: sid(1), status: "in_transit", at: at(-7) }),
  ev(5, { shipment_id: sid(1), location: "Barka checkpoint", note: "On schedule, light traffic.", at: at(-5) }),
  ev(6, { shipment_id: sid(1), location: "Saham", at: at(-2) }),
  ev(7, { shipment_id: sid(2), status: "in_transit", at: at(-24) }),
  ev(8, { shipment_id: sid(2), status: "exception", at: at(-6) }),
  ev(9, { shipment_id: sid(2), location: "أدم", note: "عطل في الإطار، بانتظار فريق الصيانة.", at: at(-6) }),
];

const rate = (n, o) => ({ id: `13300000-0000-4000-8000-${String(n).padStart(12, "0")}`, tenant_id: T, customer_id: null,
  rate_per_kg: null, rate_per_trip: null, min_charge: 0, valid_from: day(-90), valid_to: null, notes: null, mode: "road_ftl", ...o,
  customer: o.customer_id ? { name: "Gulf Freight Co." } : null });

export default {
  tables: {
    shipments,
    shipment_events,
    freight_rates: [
      rate(1, { origin_city: "Muscat", destination_city: "Sohar", rate_per_trip: 120, rate_per_kg: 0.01, min_charge: 150 }),
      rate(2, { origin_city: "Muscat", destination_city: "Sohar", customer_id: CUST_1, rate_per_trip: 200 }),
      rate(3, { origin_city: "Nizwa", destination_city: "صلالة", mode: "road_ltl", rate_per_kg: 0.12, min_charge: 300 }),
      rate(4, { origin_city: "Muscat", destination_city: "Ibri", rate_per_trip: 170, valid_to: day(-5) }),
    ],
    suppliers: [{ id: SUP_1, tenant_id: T, name: "Desert Haulage LLC", doc_number: "SUP-00001", status: "active", supplier_type: "carrier" }],
  },
  rpc: {
    quote_freight: () => [{ rate_id: "13300000-0000-4000-8000-000000000002", price: 200, customer_specific: true }],
    shipment_create_invoice: () => INV,
  },
};
