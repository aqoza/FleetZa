-- Dealer contact block + authorized signatory on the RSL certificate.
--
-- The Omani dealer format prints two things this schema had no home for:
--
--   * a website in the footer registration strip, next to the e-mail — dealers
--     write it as a bare domain ("gawhrat.com"), never as a URL; and
--   * the authorized-signatory block that sits with the scanned signature in
--     the QR / signature / stamp strip: "For <trade name>" above the mark and
--     the signing person's name below it.
--
-- The two GSM numbers already in the registration block (phone,
-- phone_secondary) stop being a slash-joined pair and become separately
-- labelled entries — Service & Support and Alternative Contact — which is a
-- rendering change only, so no schema change is needed for it here.
--
-- Additive only; new columns inherit the tenants table's existing RLS.

alter table public.tenants
  add column if not exists website           text,
  add column if not exists signatory_name    text,
  add column if not exists signatory_name_ar text;

-- Deliberately unconstrained, unlike signature_url/stamp_url in
-- 20260727000001_rsl_oman_letterhead.sql. Those two are fetched — they render
-- as <img src> on an issued document, so a scheme allow-list keeps a mistaken
-- paste from putting an arbitrary remote resource on a compliance certificate.
-- The website is only ever printed as text; nothing dereferences it. Dealers
-- write the bare domain, so any URL-shaped check ('^https://') would reject
-- the exact value they hand us ("gawhrat.com"), and a domain-shaped regex
-- would then reject the dealer who does paste a full URL. Presentation belongs
-- to the certificate renderer, not to a check constraint.

comment on column public.tenants.website is
  'Dealer website as written on the letterhead, normally a bare domain (gawhrat.com). '
  'Prints as a Website entry in the certificate footer registration block, in both the Arabic and the English pass. Text only — never fetched or linked.';

comment on column public.tenants.signatory_name is
  'Person authorized to sign issued documents. Prints under the scanned signature in the certificate''s QR / signature / stamp strip, beneath the "For <trade name>" line.';

comment on column public.tenants.signatory_name_ar is
  'Arabic form of signatory_name for the Arabic pass of the same signature cell. NULL falls back to signatory_name, since a Latin-spelled name is acceptable on the Arabic side but a missing one is not.';
