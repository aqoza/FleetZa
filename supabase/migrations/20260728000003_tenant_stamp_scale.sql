-- Stamp (company seal) size on printed certificates.
--
-- The seal is a scanned image whose ink covers a different fraction of each
-- dealer's file, so a single hard-coded box height renders some seals large
-- and others tiny. This scales the box the mark is fitted into, as a percent
-- of the default, and applies to both the printed page and the downloaded PDF.
--
-- Bounded rather than free: the mark sits in the closing strip of a one-page
-- A4 document, so an unbounded value would silently push the certificate onto
-- a second page. 50–200 keeps it adjustable without that.
alter table public.tenants
  add column if not exists stamp_scale smallint not null default 100;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tenants_stamp_scale_range'
  ) then
    alter table public.tenants
      add constraint tenants_stamp_scale_range
      check (stamp_scale between 50 and 200);
  end if;
end $$;

comment on column public.tenants.stamp_scale is
  'Percent of the default stamp box height on printed certificates (50-200, default 100).';
