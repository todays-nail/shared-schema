-- Enable reference create POST flow
-- - Add public storage bucket for reference images
-- - Add insert/delete RLS policies for references write path

insert into storage.buckets (id, name, public)
values ('reference-images', 'reference-images', true)
on conflict (id) do nothing;
-- Storage objects policies for reference-images bucket
-- Path convention: shops/<shop_id>/references/<reference_id>/<filename>
drop policy if exists reference_images_storage_insert_by_membership on storage.objects;
create policy reference_images_storage_insert_by_membership
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'reference-images'
  and split_part(name, '/', 1) = 'shops'
  and split_part(name, '/', 2) <> ''
  and split_part(name, '/', 3) = 'references'
  and split_part(name, '/', 4) <> ''
  and exists (
    select 1
    from public.shop_members sm
    where sm.user_id = auth.uid()
      and sm.shop_id::text = split_part(name, '/', 2)
  )
);
drop policy if exists reference_images_storage_delete_by_membership on storage.objects;
create policy reference_images_storage_delete_by_membership
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'reference-images'
  and split_part(name, '/', 1) = 'shops'
  and split_part(name, '/', 2) <> ''
  and split_part(name, '/', 3) = 'references'
  and split_part(name, '/', 4) <> ''
  and exists (
    select 1
    from public.shop_members sm
    where sm.user_id = auth.uid()
      and sm.shop_id::text = split_part(name, '/', 2)
  )
);
-- references write policies
drop policy if exists references_insert_by_membership on public.references;
create policy references_insert_by_membership
on public.references
for insert
to authenticated
with check (
  exists (
    select 1
    from public.shop_members sm
    where sm.user_id = auth.uid()
      and sm.shop_id = shop_id
  )
);
drop policy if exists references_delete_by_membership on public.references;
create policy references_delete_by_membership
on public.references
for delete
to authenticated
using (
  exists (
    select 1
    from public.shop_members sm
    where sm.user_id = auth.uid()
      and sm.shop_id = shop_id
  )
);
-- reference_images insert policy
drop policy if exists reference_images_insert_by_membership on public.reference_images;
create policy reference_images_insert_by_membership
on public.reference_images
for insert
to authenticated
with check (
  exists (
    select 1
    from public.references r
    join public.shop_members sm on sm.shop_id = r.shop_id
    where r.id = reference_id
      and sm.user_id = auth.uid()
  )
);
-- reference_style_tags insert policy
drop policy if exists reference_style_tags_insert_by_membership on public.reference_style_tags;
create policy reference_style_tags_insert_by_membership
on public.reference_style_tags
for insert
to authenticated
with check (
  exists (
    select 1
    from public.references r
    join public.shop_members sm on sm.shop_id = r.shop_id
    where r.id = reference_id
      and sm.user_id = auth.uid()
  )
);
