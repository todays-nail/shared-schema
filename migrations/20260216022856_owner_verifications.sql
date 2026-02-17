-- Owner verification (owner-app)
-- - Public schema table with RLS
-- - Private Storage bucket + object policies

create table if not exists public.owner_verifications (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status text not null default 'UNSUBMITTED' check (status in ('UNSUBMITTED','PENDING','APPROVED','REJECTED')),
  business_number text,
  shop_name text,
  owner_name text,
  contact_phone text,
  shop_address1 text,
  shop_address2 text,
  shop_postcode text,
  shop_photo_path text,
  business_license_path text,
  rejected_reason text,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.owner_verifications enable row level security;
-- Ensure columns exist if the table was created previously.
alter table public.owner_verifications
  add column if not exists shop_address1 text,
  add column if not exists shop_address2 text,
  add column if not exists shop_postcode text,
  add column if not exists shop_photo_path text;
-- updated_at trigger
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists set_owner_verifications_updated_at on public.owner_verifications;
create trigger set_owner_verifications_updated_at
before update on public.owner_verifications
for each row execute function public.set_updated_at();
-- RLS policies
drop policy if exists "owner_verifications_select_own" on public.owner_verifications;
create policy "owner_verifications_select_own"
on public.owner_verifications
for select
to authenticated
using (user_id = auth.uid());
drop policy if exists "owner_verifications_insert_own" on public.owner_verifications;
create policy "owner_verifications_insert_own"
on public.owner_verifications
for insert
to authenticated
with check (user_id = auth.uid() and status = 'PENDING');
drop policy if exists "owner_verifications_update_own_pending_only" on public.owner_verifications;
create policy "owner_verifications_update_own_pending_only"
on public.owner_verifications
for update
to authenticated
using (user_id = auth.uid() and status in ('UNSUBMITTED','REJECTED','PENDING'))
with check (user_id = auth.uid() and status = 'PENDING');
-- Storage: private bucket + object policies
insert into storage.buckets (id, name, public)
values ('owner-licenses', 'owner-licenses', false)
on conflict (id) do nothing;
drop policy if exists "owner_licenses_select_own" on storage.objects;
create policy "owner_licenses_select_own"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'owner-licenses'
  and (
    name like ('licenses/' || auth.uid()::text || '/%')
    or name like ('shops/' || auth.uid()::text || '/%')
  )
);
drop policy if exists "owner_licenses_insert_own" on storage.objects;
create policy "owner_licenses_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'owner-licenses'
  and (
    name like ('licenses/' || auth.uid()::text || '/%')
    or name like ('shops/' || auth.uid()::text || '/%')
  )
);
drop policy if exists "owner_licenses_delete_own" on storage.objects;
create policy "owner_licenses_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'owner-licenses'
  and (
    name like ('licenses/' || auth.uid()::text || '/%')
    or name like ('shops/' || auth.uid()::text || '/%')
  )
);
