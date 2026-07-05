-- Profile settings: the person using the account, separate from the business
-- display_name. The avatar stays device-local (data URL) and is never synced.
alter table public.profiles
  add column if not exists owner_name text;
