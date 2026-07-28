-- The technician named on a certificate, snapshotted onto the certificate.
--
-- Until now the printed name was read live through the job that produced the
-- certificate (job -> technician -> name). That has two problems:
--
--   1. A certificate issued without a job — imported history, or a document
--      recorded after the fact — can never name a technician at all, and
--      prints a dash forever. Two of this tenant's certificates are exactly
--      that case.
--   2. A live read is not a snapshot. Reassigning a job's technician silently
--      rewrites who is named on a certificate that has already been issued
--      and handed to a customer.
--
-- This mirrors what `limiter_type` and `tamper_seal_number` already do on this
-- table: the certificate records what it was issued with, and the job relation
-- stays as the fallback for rows that predate the column.
alter table public.speed_limiter_certificates
  add column if not exists technician_name text;

comment on column public.speed_limiter_certificates.technician_name is
  'Technician named on the issued certificate. Snapshot: takes precedence over the job''s current technician.';
