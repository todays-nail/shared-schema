-- User default region + region boundary cache tables for region picker UX.

alter table public.users
  add column if not exists default_region_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_default_region_id_fkey'
      and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_default_region_id_fkey
      foreign key (default_region_id) references public.regions(id)
      on delete set null;
  end if;
end
$$;

create index if not exists users_default_region_id_idx
  on public.users (default_region_id);

create table if not exists public.region_boundaries (
  region_id uuid primary key references public.regions(id) on delete cascade,
  geometry jsonb not null,
  bbox jsonb not null,
  center jsonb not null,
  source text not null default 'vworld',
  source_version text not null,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.region_sync_meta (
  source_version text primary key,
  synced_at timestamptz not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.region_boundaries enable row level security;
alter table public.region_sync_meta enable row level security;

drop policy if exists public_read_region_boundaries on public.region_boundaries;
create policy public_read_region_boundaries
on public.region_boundaries
for select
to authenticated
using (true);

drop policy if exists service_manage_region_boundaries on public.region_boundaries;
create policy service_manage_region_boundaries
on public.region_boundaries
for all
to service_role
using (true)
with check (true);

drop policy if exists public_read_region_sync_meta on public.region_sync_meta;
create policy public_read_region_sync_meta
on public.region_sync_meta
for select
to authenticated
using (true);

drop policy if exists service_manage_region_sync_meta on public.region_sync_meta;
create policy service_manage_region_sync_meta
on public.region_sync_meta
for all
to service_role
using (true)
with check (true);

drop trigger if exists set_region_boundaries_updated_at on public.region_boundaries;
create trigger set_region_boundaries_updated_at
before update on public.region_boundaries
for each row execute function public.set_updated_at();

drop trigger if exists set_region_sync_meta_updated_at on public.region_sync_meta;
create trigger set_region_sync_meta_updated_at
before update on public.region_sync_meta
for each row execute function public.set_updated_at();

grant select on table public.region_boundaries to authenticated;
grant all on table public.region_boundaries to service_role;

grant select on table public.region_sync_meta to authenticated;
grant all on table public.region_sync_meta to service_role;
