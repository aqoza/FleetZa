/**
 * Seeds a demo tenant with realistic fleet data.
 *
 * Prereqs: the app running locally (`npm run dev`) against a running Supabase
 * (`npx supabase start`), with .dev.vars / .env configured.
 *
 * Usage:
 *   node scripts/seed-demo.mjs
 * Env (defaults suit local dev):
 *   APP_URL=http://localhost:5173
 *   SUPABASE_URL=http://127.0.0.1:54321
 *   SUPABASE_SERVICE_ROLE_KEY=<from `npx supabase status`>
 */
import { createClient } from "@supabase/supabase-js";

const APP_URL = process.env.APP_URL ?? "http://localhost:5173";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const DEMO_EMAIL = "demo@fleetmanage.test";
const DEMO_PASSWORD = "Demo1234!";

if (!SERVICE_KEY) {
  console.error("Set SUPABASE_SERVICE_ROLE_KEY (see `npx supabase status`).");
  process.exit(1);
}

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000);
const iso = (d) => d.toISOString();
const day = (d) => d.toISOString().slice(0, 10);
const daysAhead = (n) => new Date(Date.now() + n * 86_400_000);

async function main() {
  console.log(`Creating demo tenant via ${APP_URL}/api/onboarding/signup …`);
  const res = await fetch(`${APP_URL}/api/onboarding/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      fullName: "Demo Owner",
      companyName: "Acme Logistics",
      country: "US",
      currency: "USD",
      timezone: "America/New_York",
      distanceUnit: "km",
      volumeUnit: "L",
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    if (res.status === 409) {
      console.error("Demo account already exists — delete it first or skip seeding.");
      process.exit(1);
    }
    throw new Error(body.error ?? `signup failed (${res.status})`);
  }
  const tenantId = body.tenantId;
  console.log(`Tenant ${tenantId} created. Seeding data…`);

  // Service role bypasses RLS, so tenant_id must be explicit on every row.
  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const t = { tenant_id: tenantId };

  const ins = async (table, rows) => {
    const { data, error } = await db.from(table).insert(rows.map((r) => ({ ...t, ...r }))).select();
    if (error) throw new Error(`${table}: ${error.message}`);
    return data;
  };

  const vehicles = await ins("vehicles", [
    { name: "Truck 01", make: "Volvo", model: "FH16", year: 2022, vehicle_type: "truck", fuel_type: "diesel", status: "active", license_plate: "TRK-9012", odometer: 148_230 },
    { name: "Truck 02", make: "Scania", model: "R500", year: 2021, vehicle_type: "truck", fuel_type: "diesel", status: "active", license_plate: "TRK-4471", odometer: 201_540 },
    { name: "Van 01", make: "Ford", model: "Transit", year: 2023, vehicle_type: "van", fuel_type: "diesel", status: "active", license_plate: "VAN-3308", odometer: 61_910 },
    { name: "Van 02", make: "Mercedes-Benz", model: "Sprinter", year: 2020, vehicle_type: "van", fuel_type: "diesel", status: "in_shop", license_plate: "VAN-7745", odometer: 143_775 },
    { name: "Car 01", make: "Toyota", model: "Corolla", year: 2024, vehicle_type: "car", fuel_type: "hybrid", status: "active", license_plate: "CAR-1189", odometer: 28_450 },
  ]);
  const [truck1, truck2, van1, van2, car1] = vehicles;

  const drivers = await ins("drivers", [
    { first_name: "Maya", last_name: "Rodriguez", email: "maya@acme.test", phone: "+1 555 0101", license_number: "D-448291", license_class: "CDL-A", license_expiry: day(daysAhead(320)), status: "active" },
    { first_name: "James", last_name: "Okafor", email: "james@acme.test", phone: "+1 555 0102", license_number: "D-102394", license_class: "CDL-A", license_expiry: day(daysAhead(18)), status: "active" },
    { first_name: "Elena", last_name: "Petrova", email: "elena@acme.test", phone: "+1 555 0103", license_number: "D-583920", license_class: "B", license_expiry: day(daysAhead(700)), status: "active" },
    { first_name: "Sam", last_name: "Whitfield", email: "sam@acme.test", phone: "+1 555 0104", license_number: "D-771034", license_class: "B", license_expiry: day(daysAgo(12)), status: "inactive" },
  ]);
  const [maya, james, elena] = drivers;

  await ins("vehicle_assignments", [
    { vehicle_id: truck1.id, driver_id: maya.id, started_at: iso(daysAgo(200)) },
    { vehicle_id: truck2.id, driver_id: james.id, started_at: iso(daysAgo(150)) },
    { vehicle_id: van1.id, driver_id: elena.id, started_at: iso(daysAgo(90)) },
  ]);

  // Fuel history: ~6 months per vehicle, increasing odometer.
  const fuel = [];
  const series = [
    { v: truck1, startKm: 138_000, kmPerFill: 1_450, liters: 410, price: 1.62, fills: 7 },
    { v: truck2, startKm: 192_000, kmPerFill: 1_300, liters: 390, price: 1.62, fills: 7 },
    { v: van1, startKm: 55_000, kmPerFill: 980, liters: 78, price: 1.71, fills: 7 },
    { v: car1, startKm: 24_000, kmPerFill: 640, liters: 41, price: 1.78, fills: 7 },
  ];
  for (const s of series) {
    for (let i = 0; i < s.fills; i++) {
      const jitter = 0.9 + ((i * 37) % 20) / 100;
      const volume = Math.round(s.liters * jitter * 100) / 100;
      fuel.push({
        vehicle_id: s.v.id,
        filled_at: iso(daysAgo(180 - i * 26)),
        odometer: s.startKm + s.kmPerFill * (i + 1),
        volume,
        total_cost: Math.round(volume * s.price * 100) / 100,
        is_full_tank: true,
        vendor: i % 2 ? "Shell" : "Pilot Flying J",
      });
    }
  }
  await ins("fuel_logs", fuel);

  await ins("service_reminders", [
    { vehicle_id: truck1.id, task: "Oil & filter change", interval_km: 25_000, due_km: 150_000, last_completed_at: day(daysAgo(80)), last_completed_km: 125_000 },
    { vehicle_id: truck2.id, task: "Brake inspection", interval_months: 6, due_date: day(daysAgo(9)) },
    { vehicle_id: van1.id, task: "Tire rotation", interval_km: 10_000, due_km: 63_000 },
    { vehicle_id: car1.id, task: "Annual service", interval_months: 12, due_date: day(daysAhead(45)) },
  ]);

  const wos = await ins("work_orders", [
    { vehicle_id: van2.id, title: "Transmission slipping — diagnose and repair", status: "in_progress", priority: "high", vendor: "Downtown Truck Service", odometer: 143_775, scheduled_date: day(daysAgo(2)) },
    { vehicle_id: truck1.id, title: "Replace worn brake pads", status: "completed", priority: "normal", vendor: "FleetFix Garage", odometer: 146_900, scheduled_date: day(daysAgo(30)), completed_at: iso(daysAgo(28)) },
    { vehicle_id: van1.id, title: "A/C blowing warm", status: "open", priority: "low", scheduled_date: day(daysAhead(7)) },
  ]);
  await ins("work_order_lines", [
    { work_order_id: wos[1].id, category: "part", description: "Brake pad set (front axle)", quantity: 1, unit_cost: 240 },
    { work_order_id: wos[1].id, category: "part", description: "Brake rotors", quantity: 2, unit_cost: 118.5 },
    { work_order_id: wos[1].id, category: "labor", description: "Labor — brake service", quantity: 3, unit_cost: 95 },
    { work_order_id: wos[0].id, category: "labor", description: "Diagnostic — transmission", quantity: 2, unit_cost: 110 },
  ]);

  await ins("issues", [
    { vehicle_id: truck2.id, title: "Check engine light on", description: "Intermittent CEL, code P0299 (turbo underboost).", status: "open", priority: "high", reported_at: iso(daysAgo(3)) },
    { vehicle_id: van1.id, title: "Cracked side mirror", status: "open", priority: "low", reported_at: iso(daysAgo(6)) },
    { vehicle_id: van2.id, title: "Transmission slipping between 2nd and 3rd", status: "in_progress", priority: "critical", work_order_id: wos[0].id, reported_at: iso(daysAgo(5)) },
  ]);

  await ins("renewals", [
    { vehicle_id: truck1.id, renewal_type: "insurance", due_date: day(daysAhead(21)), amount: 3_800, recurrence_months: 12 },
    { vehicle_id: truck2.id, renewal_type: "registration", due_date: day(daysAgo(4)), amount: 420, recurrence_months: 12 },
    { vehicle_id: van1.id, renewal_type: "emission_test", due_date: day(daysAhead(75)), amount: 65, recurrence_months: 12 },
    { vehicle_id: car1.id, renewal_type: "insurance", due_date: day(daysAhead(140)), amount: 1_150, recurrence_months: 12, completed_at: null },
  ]);

  console.log("Done. Sign in with:");
  console.log(`  email:    ${DEMO_EMAIL}`);
  console.log(`  password: ${DEMO_PASSWORD}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
