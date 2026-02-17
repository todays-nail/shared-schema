-- Enable references GET with membership-based multitenancy
-- - Add shop_members mapping table
-- - Add references.badge column
-- - Enforce RLS select policies by shop membership
-- - Backfill shop_members from existing owner/shop data

create table if not exists public.shop_members (
  user_id uuid not null references auth.users (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'manager', 'staff')),
  created_at timestamptz not null default now(),
  primary key (user_id, shop_id)
);
create index if not exists shop_members_shop_id_idx on public.shop_members (shop_id);
create index if not exists shop_members_user_id_idx on public.shop_members (user_id);
alter table public.shop_members enable row level security;
alter table public.references
  add column if not exists badge text;
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'references_badge_check'
      and conrelid = 'public.references'::regclass
  ) then
    alter table public.references
      add constraint references_badge_check
      check (badge in ('NEW', '인기') or badge is null);
  end if;
end
$$;
-- Backfill from existing owner relationship
insert into public.shop_members (user_id, shop_id, role)
select distinct s.owner_id, s.id, 'owner'
from public.shops s
on conflict (user_id, shop_id) do nothing;
-- Backfill from approved/pending owner verification by business number match
insert into public.shop_members (user_id, shop_id, role)
select distinct ov.user_id, s.id, 'owner'
from public.owner_verifications ov
join public.shops s
  on nullif(regexp_replace(s.business_registration_no, '[^0-9]', '', 'g'), '') =
     nullif(regexp_replace(ov.business_number, '[^0-9]', '', 'g'), '')
on conflict (user_id, shop_id) do nothing;
alter table public.references enable row level security;
alter table public.reference_images enable row level security;
alter table public.reference_style_tags enable row level security;
alter table public.reference_categories enable row level security;
alter table public.reference_options enable row level security;
drop policy if exists shop_members_select_own on public.shop_members;
create policy shop_members_select_own
on public.shop_members
for select
to authenticated
using (user_id = auth.uid());
drop policy if exists references_select_by_membership on public.references;
create policy references_select_by_membership
on public.references
for select
to authenticated
using (
  exists (
    select 1
    from public.shop_members sm
    where sm.shop_id = shop_id
      and sm.user_id = auth.uid()
  )
);
drop policy if exists reference_images_select_by_membership on public.reference_images;
create policy reference_images_select_by_membership
on public.reference_images
for select
to authenticated
using (
  exists (
    select 1
    from public.references r
    join public.shop_members sm on sm.shop_id = r.shop_id
    where r.id = reference_id
      and sm.user_id = auth.uid()
  )
);
drop policy if exists reference_style_tags_select_by_membership on public.reference_style_tags;
create policy reference_style_tags_select_by_membership
on public.reference_style_tags
for select
to authenticated
using (
  exists (
    select 1
    from public.references r
    join public.shop_members sm on sm.shop_id = r.shop_id
    where r.id = reference_id
      and sm.user_id = auth.uid()
  )
);
drop policy if exists reference_categories_select_by_membership on public.reference_categories;
create policy reference_categories_select_by_membership
on public.reference_categories
for select
to authenticated
using (
  exists (
    select 1
    from public.references r
    join public.shop_members sm on sm.shop_id = r.shop_id
    where r.id = reference_id
      and sm.user_id = auth.uid()
  )
);
drop policy if exists reference_options_select_by_membership on public.reference_options;
create policy reference_options_select_by_membership
on public.reference_options
for select
to authenticated
using (
  exists (
    select 1
    from public.references r
    join public.shop_members sm on sm.shop_id = r.shop_id
    where r.id = reference_id
      and sm.user_id = auth.uid()
  )
);
