-- KakaoSDK login + Edge Function session/JWT architecture
-- NOTE: 이 마이그레이션은 기존에 users.id가 auth.users.id를 FK로 참조하던 구조를 끊기 위한 변경을 포함합니다.
--       프로젝트마다 FK constraint 이름이 달라질 수 있어, auth.users를 참조하는 FK는 동적으로 찾아 제거합니다.

-- Bootstrap core tables for environments where the base schema is not yet present.
-- This keeps shadow DB replay stable when multiple clients evolve the same project.
create table if not exists public.users (
  id uuid primary key,
  kakao_user_id text,
  role text not null default 'USER',
  profile_image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.owners (
  id uuid primary key,
  manager_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.shops (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid,
  name text not null default '내 샵',
  representative_name text,
  business_registration_no text,
  phone text,
  address text,
  address_detail text,
  status text not null default 'DRAFT',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shops_owner_id_idx on public.shops (owner_id);
create unique index if not exists shops_business_registration_no_key
  on public.shops (business_registration_no);
create table if not exists public.references (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  title text not null default '',
  description text,
  base_price integer not null default 0,
  service_duration_min integer not null default 60,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists references_shop_id_idx on public.references (shop_id);
create table if not exists public.reference_images (
  id uuid primary key default gen_random_uuid(),
  reference_id uuid not null references public.references(id) on delete cascade,
  image_url text not null default '',
  is_primary boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists reference_images_reference_id_idx
  on public.reference_images (reference_id);
create table if not exists public.style_tags (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.reference_style_tags (
  reference_id uuid not null references public.references(id) on delete cascade,
  tag_id uuid not null references public.style_tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (reference_id, tag_id)
);
create index if not exists reference_style_tags_reference_id_idx
  on public.reference_style_tags (reference_id);
create table if not exists public.reference_categories (
  id uuid primary key default gen_random_uuid(),
  reference_id uuid not null references public.references(id) on delete cascade,
  category text,
  created_at timestamptz not null default now()
);
create index if not exists reference_categories_reference_id_idx
  on public.reference_categories (reference_id);
create table if not exists public.reference_options (
  id uuid primary key default gen_random_uuid(),
  reference_id uuid not null references public.references(id) on delete cascade,
  name text,
  value text,
  created_at timestamptz not null default now()
);
create index if not exists reference_options_reference_id_idx
  on public.reference_options (reference_id);
create table if not exists public.bookmarks (
  id uuid primary key default gen_random_uuid(),
  reference_id uuid not null references public.references(id) on delete cascade,
  user_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists bookmarks_reference_id_idx
  on public.bookmarks (reference_id);

-- 1) users: kakao_user_id 추가 + (가능하면) auth.users.id FK 제거
alter table if exists public.users
  add column if not exists kakao_user_id text;
-- public.users에서 auth.users를 참조하는 FK는 모두 제거
do $$
declare
  r record;
begin
  if to_regclass('public.users') is null or to_regclass('auth.users') is null then
    return;
  end if;

  for r in
    select c.conname
    from pg_constraint c
    where c.conrelid = to_regclass('public.users')
      and c.contype = 'f'
      and c.confrelid = to_regclass('auth.users')
  loop
    execute format('alter table public.users drop constraint if exists %I', r.conname);
  end loop;
end $$;
-- unique index (NULL은 여러 개 가능: 기존 데이터가 있으면 먼저 backfill 후 NOT NULL로 강화)
create unique index if not exists users_kakao_user_id_key
  on public.users (kakao_user_id);
-- 2) refresh token rotation table
create table if not exists public.user_refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  device_id text not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  replaced_by uuid null references public.user_refresh_tokens(id)
);
create index if not exists user_refresh_tokens_user_device_idx
  on public.user_refresh_tokens (user_id, device_id);
