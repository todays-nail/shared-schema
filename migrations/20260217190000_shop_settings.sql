-- Shop settings + gallery persistence for owner-app settings page.
-- - Keeps base profile in public.shops
-- - Stores operational settings in public.shop_settings
-- - Stores gallery metadata in public.shop_gallery_images + private storage bucket

create table if not exists public.shop_settings (
  shop_id uuid primary key references public.shops(id) on delete cascade,
  open_time time not null default '10:00',
  close_time time not null default '20:00',
  closed_weekdays text[] not null default '{}'::text[],
  intro text not null default '',
  base_gel_price integer not null default 40000 check (base_gel_price >= 0),
  removal_price integer not null default 10000 check (removal_price >= 0),
  extension_price integer not null default 10000 check (extension_price >= 0),
  art_unit_price integer not null default 5000 check (art_unit_price >= 0),
  deposit_amount integer not null default 20000 check (deposit_amount >= 0),
  auto_confirm boolean not null default false,
  allow_onsite_payment boolean not null default true,
  invoice_email text not null default '',
  settlement_bank text not null default '카카오뱅크',
  settlement_account text not null default '',
  notify_quote_request boolean not null default true,
  notify_booking_created boolean not null default true,
  notify_payment_completed boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shop_settings_closed_weekdays_check check (
    closed_weekdays <@ array['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']::text[]
  )
);

create table if not exists public.shop_gallery_images (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  storage_path text not null,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  unique (shop_id, storage_path)
);

create index if not exists shop_gallery_images_shop_sort_created_idx
  on public.shop_gallery_images (shop_id, sort_order, created_at);

drop trigger if exists set_shop_settings_updated_at on public.shop_settings;
create trigger set_shop_settings_updated_at
before update on public.shop_settings
for each row
execute function public.set_updated_at();

alter table public.shops enable row level security;
alter table public.shop_settings enable row level security;
alter table public.shop_gallery_images enable row level security;

drop policy if exists shops_select_by_membership on public.shops;
create policy shops_select_by_membership
on public.shops
for select
to authenticated
using (
  exists (
    select 1
    from public.shop_members sm
    where sm.shop_id = shops.id
      and sm.user_id = auth.uid()
  )
);

drop policy if exists shops_update_by_membership on public.shops;
create policy shops_update_by_membership
on public.shops
for update
to authenticated
using (
  exists (
    select 1
    from public.shop_members sm
    where sm.shop_id = shops.id
      and sm.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.shop_members sm
    where sm.shop_id = shops.id
      and sm.user_id = auth.uid()
  )
);

drop policy if exists shop_settings_select_by_membership on public.shop_settings;
create policy shop_settings_select_by_membership
on public.shop_settings
for select
to authenticated
using (
  exists (
    select 1
    from public.shop_members sm
    where sm.shop_id = shop_settings.shop_id
      and sm.user_id = auth.uid()
  )
);

drop policy if exists shop_settings_insert_by_membership on public.shop_settings;
create policy shop_settings_insert_by_membership
on public.shop_settings
for insert
to authenticated
with check (
  exists (
    select 1
    from public.shop_members sm
    where sm.shop_id = shop_settings.shop_id
      and sm.user_id = auth.uid()
  )
);

drop policy if exists shop_settings_update_by_membership on public.shop_settings;
create policy shop_settings_update_by_membership
on public.shop_settings
for update
to authenticated
using (
  exists (
    select 1
    from public.shop_members sm
    where sm.shop_id = shop_settings.shop_id
      and sm.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.shop_members sm
    where sm.shop_id = shop_settings.shop_id
      and sm.user_id = auth.uid()
  )
);

drop policy if exists shop_gallery_images_select_by_membership on public.shop_gallery_images;
create policy shop_gallery_images_select_by_membership
on public.shop_gallery_images
for select
to authenticated
using (
  exists (
    select 1
    from public.shop_members sm
    where sm.shop_id = shop_gallery_images.shop_id
      and sm.user_id = auth.uid()
  )
);

drop policy if exists shop_gallery_images_insert_by_membership on public.shop_gallery_images;
create policy shop_gallery_images_insert_by_membership
on public.shop_gallery_images
for insert
to authenticated
with check (
  exists (
    select 1
    from public.shop_members sm
    where sm.shop_id = shop_gallery_images.shop_id
      and sm.user_id = auth.uid()
  )
);

drop policy if exists shop_gallery_images_delete_by_membership on public.shop_gallery_images;
create policy shop_gallery_images_delete_by_membership
on public.shop_gallery_images
for delete
to authenticated
using (
  exists (
    select 1
    from public.shop_members sm
    where sm.shop_id = shop_gallery_images.shop_id
      and sm.user_id = auth.uid()
  )
);

insert into storage.buckets (id, name, public)
values ('shop-gallery-images', 'shop-gallery-images', false)
on conflict (id) do nothing;

drop policy if exists shop_gallery_objects_select_by_membership on storage.objects;
create policy shop_gallery_objects_select_by_membership
on storage.objects
for select
to authenticated
using (
  bucket_id = 'shop-gallery-images'
  and split_part(name, '/', 1) = 'shops'
  and split_part(name, '/', 2) <> ''
  and split_part(name, '/', 3) = 'gallery'
  and split_part(name, '/', 4) <> ''
  and exists (
    select 1
    from public.shop_members sm
    where sm.user_id = auth.uid()
      and sm.shop_id::text = split_part(name, '/', 2)
  )
);

drop policy if exists shop_gallery_objects_insert_by_membership on storage.objects;
create policy shop_gallery_objects_insert_by_membership
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'shop-gallery-images'
  and split_part(name, '/', 1) = 'shops'
  and split_part(name, '/', 2) <> ''
  and split_part(name, '/', 3) = 'gallery'
  and split_part(name, '/', 4) <> ''
  and exists (
    select 1
    from public.shop_members sm
    where sm.user_id = auth.uid()
      and sm.shop_id::text = split_part(name, '/', 2)
  )
);

drop policy if exists shop_gallery_objects_delete_by_membership on storage.objects;
create policy shop_gallery_objects_delete_by_membership
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'shop-gallery-images'
  and split_part(name, '/', 1) = 'shops'
  and split_part(name, '/', 2) <> ''
  and split_part(name, '/', 3) = 'gallery'
  and split_part(name, '/', 4) <> ''
  and exists (
    select 1
    from public.shop_members sm
    where sm.user_id = auth.uid()
      and sm.shop_id::text = split_part(name, '/', 2)
  )
);
