-- Add missing columns expected by Edge Functions / iOS app.
-- - role: user role (default USER)
-- - profile_image_url: optional profile image URL
-- Also ensure updated_at is kept in sync on UPDATE.

alter table if exists public.users
  add column if not exists role text not null default 'USER';
alter table if exists public.users
  add column if not exists profile_image_url text;
-- updated_at trigger (safe to re-run)
create or replace function public.users_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at
before update on public.users
for each row
execute function public.users_set_updated_at();
