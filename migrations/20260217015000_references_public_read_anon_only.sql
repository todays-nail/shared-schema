-- Keep public read for consumer surfaces, but do not bypass membership for authenticated users.

drop policy if exists "public read references" on public.references;
create policy "public read references"
on public.references
for select
to anon
using (true);
drop policy if exists "public read reference_images" on public.reference_images;
create policy "public read reference_images"
on public.reference_images
for select
to anon
using (true);
