-- iOS APNs 디바이스 토큰 저장 테이블
-- AI 생성 완료/실패 푸시 라우팅에 사용한다.

create table if not exists public.user_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  device_id text not null,
  platform text not null default 'ios',
  apns_token text not null,
  apns_env_hint text not null default 'production',
  is_active boolean not null default true,
  last_registered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_push_tokens_platform_check
    check (platform in ('ios')),
  constraint user_push_tokens_apns_env_hint_check
    check (apns_env_hint in ('production', 'sandbox'))
);

create unique index if not exists user_push_tokens_user_device_platform_uidx
  on public.user_push_tokens (user_id, device_id, platform);

create index if not exists user_push_tokens_user_active_idx
  on public.user_push_tokens (user_id, is_active);

drop trigger if exists set_user_push_tokens_updated_at on public.user_push_tokens;
create trigger set_user_push_tokens_updated_at
before update on public.user_push_tokens
for each row execute function public.set_updated_at();

alter table public.user_push_tokens enable row level security;

drop policy if exists user_push_tokens_select_by_user on public.user_push_tokens;
create policy user_push_tokens_select_by_user
on public.user_push_tokens
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists user_push_tokens_insert_by_user on public.user_push_tokens;
create policy user_push_tokens_insert_by_user
on public.user_push_tokens
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists user_push_tokens_update_by_user on public.user_push_tokens;
create policy user_push_tokens_update_by_user
on public.user_push_tokens
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());
