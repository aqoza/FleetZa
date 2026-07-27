-- The Omani certificate prints its footer registration line twice — Arabic
-- (Arabic-Indic digits) above English — and both carry the locality as the
-- dealer writes it ("Muscat, Sultanate of Oman" / "مسقط، سلطنة عمان"), which
-- is a letterhead style choice rather than a country-table lookup.
alter table public.tenants add column if not exists city_ar text;
