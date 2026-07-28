-- The technician a certificate is issued under by default.
--
-- Lives on sl_settings rather than tenants because it is speed-limiter module
-- configuration, next to cert_prefix and cert_validity_months, not letterhead.
--
-- A reference, not a name: technicians are a real table, so the certificate
-- picker and this default resolve from the same list, and renaming a
-- technician does not leave a stale string behind. The certificate itself
-- still snapshots the NAME at issuance
-- (speed_limiter_certificates.technician_name) — an issued document must not
-- change because staff changed later.
alter table public.sl_settings
  add column if not exists default_technician_id uuid
    references public.sl_technicians (id) on delete set null;

comment on column public.sl_settings.default_technician_id is
  'Technician preselected when issuing a certificate. The certificate snapshots the name at issuance.';
