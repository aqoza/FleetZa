-- Per-user UI language preference. Additive and safe on the live DB.
alter table public.profiles
  add column language text not null default 'en' check (language in ('en', 'ar'));

-- Let users update their own language (adds to the existing full_name/phone grant).
grant update (full_name, phone, language) on public.profiles to authenticated;
