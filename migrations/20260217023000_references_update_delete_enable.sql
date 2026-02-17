-- Enable reference update/delete/toggle write path for authenticated shop members.

-- references UPDATE policy
drop policy if exists references_update_by_membership on public.references;
create policy references_update_by_membership
on public.references
for update
to authenticated
using (
  shop_id in (
    select sm.shop_id
    from public.shop_members sm
    where sm.user_id = auth.uid()
  )
)
with check (
  shop_id in (
    select sm.shop_id
    from public.shop_members sm
    where sm.user_id = auth.uid()
  )
);
-- reference_images DELETE policy
drop policy if exists reference_images_delete_by_membership on public.reference_images;
create policy reference_images_delete_by_membership
on public.reference_images
for delete
to authenticated
using (
  exists (
    select 1
    from public.references r
    join public.shop_members sm on sm.shop_id = r.shop_id
    where r.id = reference_images.reference_id
      and sm.user_id = auth.uid()
  )
);
-- reference_style_tags DELETE policy
drop policy if exists reference_style_tags_delete_by_membership on public.reference_style_tags;
create policy reference_style_tags_delete_by_membership
on public.reference_style_tags
for delete
to authenticated
using (
  exists (
    select 1
    from public.references r
    join public.shop_members sm on sm.shop_id = r.shop_id
    where r.id = reference_style_tags.reference_id
      and sm.user_id = auth.uid()
  )
);
-- This trigger blocks deleting all tags and conflicts with hard-delete flow.
drop trigger if exists trg_prevent_delete_last_style_tag on public.reference_style_tags;
