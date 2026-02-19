-- Multi-social identity table for Kakao + Google login
-- Keep users.kakao_user_id for backward compatibility, but move source of truth to user_identities.

create table if not exists public.user_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  provider text not null,
  provider_user_id text not null,
  email text,
  email_verified boolean not null default false,
  display_name text,
  profile_image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz not null default now(),
  constraint user_identities_provider_check check (provider in ('kakao', 'google'))
);

create unique index if not exists user_identities_provider_provider_user_id_key
  on public.user_identities (provider, provider_user_id);

create unique index if not exists user_identities_user_provider_key
  on public.user_identities (user_id, provider);

create index if not exists user_identities_user_id_idx
  on public.user_identities (user_id);

alter table if exists public.user_identities enable row level security;

alter table if exists public.users
  alter column kakao_user_id drop not null;

insert into public.user_identities (
  user_id,
  provider,
  provider_user_id,
  email_verified,
  last_login_at
)
select
  u.id,
  'kakao',
  u.kakao_user_id,
  false,
  now()
from public.users u
where coalesce(trim(u.kakao_user_id), '') <> ''
on conflict (provider, provider_user_id)
do update
set
  user_id = excluded.user_id,
  updated_at = now(),
  last_login_at = excluded.last_login_at;
