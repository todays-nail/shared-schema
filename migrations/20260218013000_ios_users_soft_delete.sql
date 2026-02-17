-- Soft delete support for iOS account deletion flow.

alter table if exists public.users
  add column if not exists deleted_at timestamptz;

alter table if exists public.users
  add column if not exists deleted_reason text;

create index if not exists users_deleted_at_idx
  on public.users (deleted_at);
