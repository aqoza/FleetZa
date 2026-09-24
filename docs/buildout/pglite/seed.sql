-- Synthetic seed for the local replica. The demo tenant and its two users carry
-- the production ids (FOUNDATION.md §0.5), so test scripts written against the
-- hosted project run here unchanged. Everything else is invented.
--   demo tenant  170d2d86-5c22-4bcb-9d74-420c879419b2  "Acme Logistics" (US/USD, service_provider)
--   owner        129bbbae-fdfc-4d21-8a86-8949fec2403b  demo@fleetmanage.test
--   manager      950e38aa-2bd7-4c55-9dfc-9b4255316548  teammate@acme.test
--   viewer       5eed0000-0000-4000-8000-00000000a003  viewer@acme.test        (local only)
--   other tenant 5eed0000-0000-4000-8000-0000000000b1  "Other Co" (OM/OMR, 3 decimals) (local only)
--   other owner  5eed0000-0000-4000-8000-00000000b001  owner@other.test       (local only)

insert into auth.users (id, email, raw_app_meta_data, email_confirmed_at, last_sign_in_at) values
  ('129bbbae-fdfc-4d21-8a86-8949fec2403b', 'demo@fleetmanage.test', '{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}', now(), now()),
  ('950e38aa-2bd7-4c55-9dfc-9b4255316548', 'teammate@acme.test', '{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"manager"}', now(), now() - interval '40 days'),
  ('5eed0000-0000-4000-8000-00000000a003', 'viewer@acme.test', '{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"viewer"}', now(), null),
  ('5eed0000-0000-4000-8000-00000000b001', 'owner@other.test', '{"tenant_id":"5eed0000-0000-4000-8000-0000000000b1","role":"owner"}', now(), now());

insert into public.tenants (id, name, country, currency, distance_unit, volume_unit, timezone, archetype, currency_decimals) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'Acme Logistics', 'US', 'USD', 'km', 'L', 'America/New_York', 'service_provider', 2),
  ('5eed0000-0000-4000-8000-0000000000b1', 'Other Co', 'OM', 'OMR', 'km', 'L', 'Asia/Muscat', 'fleet_operator', 3);

insert into public.profiles (id, tenant_id, email, full_name, role) values
  ('129bbbae-fdfc-4d21-8a86-8949fec2403b', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'demo@fleetmanage.test', 'Demo Owner', 'owner'),
  ('950e38aa-2bd7-4c55-9dfc-9b4255316548', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'teammate@acme.test', 'Team Mate', 'manager'),
  ('5eed0000-0000-4000-8000-00000000a003', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'viewer@acme.test', 'View Only', 'viewer'),
  ('5eed0000-0000-4000-8000-00000000b001', '5eed0000-0000-4000-8000-0000000000b1', 'owner@other.test', 'Other Owner', 'owner');

-- Same module set the demo tenant has in production.
insert into public.tenant_modules (tenant_id, module_id, enabled)
select '170d2d86-5c22-4bcb-9d74-420c879419b2', m, m <> 'drivers'
from unnest(array['customers','drivers','fleet','fuel','inspections','issues','maintenance','preventive',
                  'renewals','reports','sl_certificates','speed_limiters']) m;
insert into public.tenant_modules (tenant_id, module_id, enabled)
select '5eed0000-0000-4000-8000-0000000000b1', m, true
from unnest(array['fleet','drivers','fuel','maintenance','issues','customers']) m;

insert into public.customers (id, tenant_id, name, email, phone, city, country, status) values
  ('5eed0000-0000-4000-8000-00000000c001', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Gulf Freight Co.', 'ops@gulffreight.test', '+1 702 555 0133', 'Las Vegas', 'US', 'active'),
  ('5eed0000-0000-4000-8000-00000000c002', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Desert Movers LLC', 'fleet@desertmovers.test', '+1 702 555 0190', 'Henderson', 'US', 'active'),
  ('5eed0000-0000-4000-8000-00000000c0b1', '5eed0000-0000-4000-8000-0000000000b1', 'Other Customer', null, null, 'Muscat', 'OM', 'active');

insert into public.contacts (tenant_id, customer_id, name, email, phone, is_primary) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', '5eed0000-0000-4000-8000-00000000c001', 'Sara Haddad', 'sara@gulffreight.test', '+1 702 555 0134', true);

insert into public.vehicles (id, tenant_id, name, vin, license_plate, make, model, year, vehicle_type, status, fuel_type, odometer, fleet_number, ownership, customer_id) values
  ('5eed0000-0000-4000-8000-00000000e001', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Truck 01', '1FTFW1E50NFA00001', 'NV-1001', 'Ford', 'F-750', 2021, 'truck', 'active', 'diesel', 84210, 'T01', 'company', null),
  ('5eed0000-0000-4000-8000-00000000e002', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Truck 02', '1FTFW1E50NFA00002', 'NV-1002', 'Ford', 'F-750', 2022, 'truck', 'active', 'diesel', 51230, 'T02', 'company', null),
  ('5eed0000-0000-4000-8000-00000000e003', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Van 03', '5TDZA23C00S000003', 'NV-2003', 'Toyota', 'Hiace', 2020, 'van', 'active', 'gasoline', 120450, 'V03', 'company', null),
  ('5eed0000-0000-4000-8000-00000000e004', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Pickup 04', '1GCUYDED0NZ000004', 'NV-3004', 'Chevrolet', 'Silverado', 2023, 'truck', 'in_shop', 'gasoline', 18900, 'P04', 'company', null),
  ('5eed0000-0000-4000-8000-00000000e005', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Customer Bus', 'JTFSX23P0N0000005', 'NV-4005', 'Toyota', 'Coaster', 2019, 'bus', 'active', 'diesel', 230100, null, 'customer', '5eed0000-0000-4000-8000-00000000c001'),
  ('5eed0000-0000-4000-8000-00000000e0b1', '5eed0000-0000-4000-8000-0000000000b1', 'Other Truck', null, 'OM-9999', 'Isuzu', 'NPR', 2020, 'truck', 'active', 'diesel', 40000, null, 'company', null);

insert into public.drivers (id, tenant_id, first_name, last_name, email, phone, license_number, license_expiry, status) values
  ('5eed0000-0000-4000-8000-00000000d001', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Omar', 'Khalil', 'omar@acme.test', '+1 702 555 0101', 'NV-DL-1001', current_date + 20, 'active'),
  ('5eed0000-0000-4000-8000-00000000d002', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Maria', 'Lopez', 'maria@acme.test', '+1 702 555 0102', 'NV-DL-1002', current_date + 400, 'active'),
  ('5eed0000-0000-4000-8000-00000000d003', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Ken', 'Ito', null, null, 'NV-DL-1003', current_date - 5, 'inactive'),
  ('5eed0000-0000-4000-8000-00000000d0b1', '5eed0000-0000-4000-8000-0000000000b1', 'Other', 'Driver', null, null, null, null, 'active');

insert into public.vehicle_assignments (tenant_id, vehicle_id, driver_id, started_at) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', '5eed0000-0000-4000-8000-00000000e001', '5eed0000-0000-4000-8000-00000000d001', now() - interval '90 days'),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', '5eed0000-0000-4000-8000-00000000e002', '5eed0000-0000-4000-8000-00000000d002', now() - interval '60 days');

insert into public.sl_technicians (id, tenant_id, name, phone, active) values
  ('5eed0000-0000-4000-8000-00000000f001', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Ali Technician', '+1 702 555 0150', true);

insert into public.products (id, tenant_id, sku, name, kind, unit, unit_price, tax_rate, active) values
  ('5eed0000-0000-4000-8000-00000000a101', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'OIL-5W30', 'Engine oil 5W-30 (1 L)', 'part', 'L', 12.5, 0, true),
  ('5eed0000-0000-4000-8000-00000000a102', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'SVC-INSP', 'Vehicle inspection', 'service', 'unit', 80, 0, true);

insert into public.fuel_logs (tenant_id, vehicle_id, driver_id, filled_at, odometer, volume, total_cost, is_full_tank) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', '5eed0000-0000-4000-8000-00000000e001', '5eed0000-0000-4000-8000-00000000d001', now() - interval '60 days', 82000, 180, 720, true),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', '5eed0000-0000-4000-8000-00000000e001', '5eed0000-0000-4000-8000-00000000d001', now() - interval '30 days', 83100, 190, 760, true),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', '5eed0000-0000-4000-8000-00000000e001', '5eed0000-0000-4000-8000-00000000d001', now() - interval '2 days', 84210, 200, 800, true),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', '5eed0000-0000-4000-8000-00000000e003', null, now() - interval '10 days', 120400, 60, 210, true);

insert into public.issues (id, tenant_id, vehicle_id, title, status, priority) values
  ('5eed0000-0000-4000-8000-00000000a201', '170d2d86-5c22-4bcb-9d74-420c879419b2', '5eed0000-0000-4000-8000-00000000e004', 'Brake noise on front axle', 'open', 'high'),
  ('5eed0000-0000-4000-8000-00000000a202', '170d2d86-5c22-4bcb-9d74-420c879419b2', '5eed0000-0000-4000-8000-00000000e003', 'AC not cooling', 'open', 'normal');

insert into public.service_reminders (tenant_id, vehicle_id, task, interval_months, interval_km, due_date, due_km, active) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', '5eed0000-0000-4000-8000-00000000e001', 'Oil change', 6, 10000, current_date + 12, 90000, true),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', '5eed0000-0000-4000-8000-00000000e003', 'Tire rotation', 12, 20000, current_date - 3, 121000, true);

insert into public.renewals (tenant_id, vehicle_id, renewal_type, name, due_date, amount) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', '5eed0000-0000-4000-8000-00000000e001', 'registration', 'Registration', current_date + 25, 150),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', '5eed0000-0000-4000-8000-00000000e002', 'insurance', 'Insurance', current_date - 2, 1200);
