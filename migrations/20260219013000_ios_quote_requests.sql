-- User quote request targets from AI fitting result detail.
-- - REGION target: one region_id selected
-- - SHOP target: one shop_id selected

create table if not exists public.quote_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  ai_generation_job_id uuid not null references public.nail_generation_jobs(id) on delete cascade,
  target_type text not null,
  region_id uuid references public.regions(id) on delete set null,
  shop_id uuid references public.shops(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quote_requests_target_type_check
    check (target_type in ('REGION', 'SHOP')),
  constraint quote_requests_target_scope_check
    check (
      (target_type = 'REGION' and region_id is not null and shop_id is null)
      or
      (target_type = 'SHOP' and shop_id is not null and region_id is null)
    )
);

create index if not exists quote_requests_user_created_idx
  on public.quote_requests (user_id, created_at desc);

create index if not exists quote_requests_ai_generation_created_idx
  on public.quote_requests (ai_generation_job_id, created_at desc);

drop trigger if exists set_quote_requests_updated_at on public.quote_requests;
create trigger set_quote_requests_updated_at
before update on public.quote_requests
for each row execute function public.set_updated_at();

alter table public.quote_requests enable row level security;

drop policy if exists quote_requests_select_by_user on public.quote_requests;
create policy quote_requests_select_by_user
on public.quote_requests
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists quote_requests_insert_by_user on public.quote_requests;
create policy quote_requests_insert_by_user
on public.quote_requests
for insert
to authenticated
with check (user_id = auth.uid());
