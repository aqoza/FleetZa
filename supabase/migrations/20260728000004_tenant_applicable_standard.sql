-- The standard a fitted speed limiter is certified against, printed in the
-- certificate's header row next to the country of installation.
--
-- Per tenant rather than per certificate: the standard applies to every
-- vehicle a dealer certifies, so recording it on each of hundreds of
-- certificates would be repetition with hundreds of chances to diverge.
--
-- Per tenant rather than a constant in the code: GSO 1026/2002 is the Gulf
-- standard, and this app is not GCC-only. A dealer certifying to a different
-- national standard sets their own; a dealer that sets nothing prints nothing,
-- exactly as the cell behaved before.
alter table public.tenants
  add column if not exists applicable_standard text;

comment on column public.tenants.applicable_standard is
  'Standard printed on speed limiter certificates, e.g. GSO-1026/2002. Print-only text; never dereferenced.';
