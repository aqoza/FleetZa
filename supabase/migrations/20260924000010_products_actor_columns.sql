-- products: add the actor columns its stamp trigger writes.
--
-- 20260726000001_sales_billing.sql attached `products_stamp_actor`
-- (app.stamp_actor, BEFORE INSERT OR UPDATE) to public.products, but the table
-- was created without created_by / updated_by. Every insert or update of a
-- product therefore fails with 42703 `record "new" has no field "created_by"` —
-- the sales catalog cannot add or edit products, and POS sells from it.
--
-- Additive only: two nullable columns (metadata-only change, no rewrite), the
-- same shape every other stamped table has. Existing rows keep null actors.

set local lock_timeout = '3s';
set local statement_timeout = '60s';

alter table public.products
  add column if not exists created_by uuid,
  add column if not exists updated_by uuid;
