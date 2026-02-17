-- Align references POST source with feed GET projection.
-- references/reference_images/reference_style_tags/reference_reviews -> feed_posts/*

alter table public.references
  add column if not exists discounted_price integer;
alter table public.references
  add column if not exists shape_category text;
alter table public.references
  add column if not exists is_reservable boolean not null default false;
update public.references
set discounted_price = base_price
where discounted_price is null;
update public.references
set shape_category = '기타'
where shape_category is null or btrim(shape_category) = '';
alter table public.references
  alter column discounted_price set not null;
alter table public.references
  alter column shape_category set not null;
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'references_discounted_price_check'
      and conrelid = 'public.references'::regclass
  ) then
    alter table public.references
      add constraint references_discounted_price_check
      check (discounted_price >= 0 and discounted_price <= base_price);
  end if;
end
$$;
create or replace function public.references_apply_defaults()
returns trigger
language plpgsql
as $$
begin
  if new.discounted_price is null then
    new.discounted_price := new.base_price;
  end if;

  if new.shape_category is null or btrim(new.shape_category) = '' then
    new.shape_category := '기타';
  end if;

  new.discounted_price := greatest(0, least(new.discounted_price, new.base_price));
  return new;
end;
$$;
drop trigger if exists trg_references_apply_defaults on public.references;
create trigger trg_references_apply_defaults
before insert or update on public.references
for each row
execute function public.references_apply_defaults();
create table if not exists public.reference_reviews (
  id uuid primary key default gen_random_uuid(),
  reference_id uuid not null references public.references(id) on delete cascade,
  user_name text not null,
  rating integer not null check (rating between 1 and 5),
  comment text not null,
  created_at timestamptz not null default now()
);
create index if not exists reference_reviews_reference_created_idx
  on public.reference_reviews (reference_id, created_at desc);
alter table public.reference_reviews enable row level security;
drop policy if exists reference_reviews_select_by_membership on public.reference_reviews;
create policy reference_reviews_select_by_membership
on public.reference_reviews
for select
to authenticated
using (
  exists (
    select 1
    from public.references r
    join public.shop_members sm on sm.shop_id = r.shop_id
    where r.id = reference_reviews.reference_id
      and sm.user_id = auth.uid()
  )
);
drop policy if exists reference_reviews_insert_by_membership on public.reference_reviews;
create policy reference_reviews_insert_by_membership
on public.reference_reviews
for insert
to authenticated
with check (
  exists (
    select 1
    from public.references r
    join public.shop_members sm on sm.shop_id = r.shop_id
    where r.id = reference_reviews.reference_id
      and sm.user_id = auth.uid()
  )
);
drop policy if exists reference_reviews_update_by_membership on public.reference_reviews;
create policy reference_reviews_update_by_membership
on public.reference_reviews
for update
to authenticated
using (
  exists (
    select 1
    from public.references r
    join public.shop_members sm on sm.shop_id = r.shop_id
    where r.id = reference_reviews.reference_id
      and sm.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.references r
    join public.shop_members sm on sm.shop_id = r.shop_id
    where r.id = reference_reviews.reference_id
      and sm.user_id = auth.uid()
  )
);
drop policy if exists reference_reviews_delete_by_membership on public.reference_reviews;
create policy reference_reviews_delete_by_membership
on public.reference_reviews
for delete
to authenticated
using (
  exists (
    select 1
    from public.references r
    join public.shop_members sm on sm.shop_id = r.shop_id
    where r.id = reference_reviews.reference_id
      and sm.user_id = auth.uid()
  )
);
create index if not exists references_active_created_idx
  on public.references (is_active, created_at desc, id desc);
create index if not exists references_active_reservable_created_idx
  on public.references (is_active, is_reservable, created_at desc, id desc);
create index if not exists reference_images_ref_primary_sort_idx
  on public.reference_images (reference_id, is_primary desc, sort_order asc);
create index if not exists reference_style_tags_ref_idx
  on public.reference_style_tags (reference_id);
create index if not exists bookmarks_reference_created_idx
  on public.bookmarks (reference_id, created_at desc);
-- Remove old demo rows that are not tied to references.
delete from public.feed_posts fp
where not exists (
  select 1
  from public.references r
  where r.id = fp.id
);
alter table public.feed_posts
  alter column id drop default;
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'feed_posts_id_fkey'
      and conrelid = 'public.feed_posts'::regclass
  ) then
    alter table public.feed_posts
      add constraint feed_posts_id_fkey
      foreign key (id) references public.references(id) on delete cascade;
  end if;
end
$$;
create or replace function public.sync_feed_from_reference(p_reference_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reference record;
  v_thumbnail_url text;
  v_has_primary_image boolean := false;
  v_style_tags text[] := '{}';
  v_like_count integer := 0;
  v_review_count integer := 0;
  v_rating_avg numeric(2,1) := 0.0;
  v_status text := 'hidden';
  v_original_price integer := 0;
  v_discounted_price integer := 0;
  v_duration_min integer := 60;
begin
  if p_reference_id is null then
    return;
  end if;

  select
    r.id,
    r.is_active,
    r.title,
    coalesce(r.description, '') as description,
    r.base_price,
    r.discounted_price,
    r.service_duration_min,
    r.shape_category,
    r.is_reservable,
    s.name as studio_name,
    s.address as location_text,
    r.created_at
  into v_reference
  from public.references r
  join public.shops s on s.id = r.shop_id
  where r.id = p_reference_id;

  if not found then
    delete from public.feed_posts where id = p_reference_id;
    return;
  end if;

  select exists (
    select 1
    from public.reference_images ri
    where ri.reference_id = p_reference_id
      and ri.is_primary = true
  )
  into v_has_primary_image;

  select ri.image_url
  into v_thumbnail_url
  from public.reference_images ri
  where ri.reference_id = p_reference_id
  order by case when ri.is_primary then 0 else 1 end, ri.sort_order asc, ri.id asc
  limit 1;

  select coalesce(array_agg(st.name order by st.sort_order asc, st.name asc), '{}')
  into v_style_tags
  from public.reference_style_tags rst
  join public.style_tags st on st.id = rst.tag_id
  where rst.reference_id = p_reference_id
    and st.is_active = true;

  select count(*)::integer
  into v_like_count
  from public.bookmarks b
  where b.reference_id = p_reference_id;

  select
    count(*)::integer,
    coalesce(round(avg(rr.rating)::numeric, 1), 0.0)::numeric(2,1)
  into
    v_review_count,
    v_rating_avg
  from public.reference_reviews rr
  where rr.reference_id = p_reference_id;

  v_original_price := greatest(0, coalesce(v_reference.base_price, 0));
  v_discounted_price := least(
    v_original_price,
    greatest(0, coalesce(v_reference.discounted_price, v_reference.base_price, 0))
  );
  v_duration_min := greatest(1, coalesce(v_reference.service_duration_min, 60));

  if v_reference.is_active and v_has_primary_image then
    v_status := 'active';
  end if;

  insert into public.feed_posts (
    id,
    status,
    title,
    thumbnail_url,
    shape_category,
    style_tags,
    is_reservable,
    studio_name,
    location_text,
    distance_km,
    original_price,
    discounted_price,
    duration_min,
    description,
    like_count,
    review_count,
    rating_avg,
    created_at
  )
  values (
    v_reference.id,
    v_status,
    v_reference.title,
    coalesce(v_thumbnail_url, ''),
    coalesce(nullif(btrim(v_reference.shape_category), ''), '기타'),
    coalesce(v_style_tags, '{}'),
    coalesce(v_reference.is_reservable, false),
    v_reference.studio_name,
    v_reference.location_text,
    null,
    v_original_price,
    v_discounted_price,
    v_duration_min,
    v_reference.description,
    v_like_count,
    v_review_count,
    v_rating_avg,
    v_reference.created_at
  )
  on conflict (id) do update
  set
    status = excluded.status,
    title = excluded.title,
    thumbnail_url = excluded.thumbnail_url,
    shape_category = excluded.shape_category,
    style_tags = excluded.style_tags,
    is_reservable = excluded.is_reservable,
    studio_name = excluded.studio_name,
    location_text = excluded.location_text,
    distance_km = excluded.distance_km,
    original_price = excluded.original_price,
    discounted_price = excluded.discounted_price,
    duration_min = excluded.duration_min,
    description = excluded.description,
    like_count = excluded.like_count,
    review_count = excluded.review_count,
    rating_avg = excluded.rating_avg;

  delete from public.feed_post_images where post_id = p_reference_id;
  insert into public.feed_post_images (post_id, image_url, sort_order)
  select
    p_reference_id,
    ri.image_url,
    row_number() over (
      order by case when ri.is_primary then 0 else 1 end, ri.sort_order asc, ri.id asc
    ) - 1
  from public.reference_images ri
  where ri.reference_id = p_reference_id;

  delete from public.feed_post_reviews where post_id = p_reference_id;
  insert into public.feed_post_reviews (post_id, user_name, rating, comment, created_at)
  select
    p_reference_id,
    rr.user_name,
    rr.rating,
    rr.comment,
    rr.created_at
  from public.reference_reviews rr
  where rr.reference_id = p_reference_id
  order by rr.created_at desc, rr.id desc;
end;
$$;
create or replace function public.sync_feed_from_reference_after_references()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_feed_from_reference(new.id);
  return new;
end;
$$;
create or replace function public.sync_feed_from_reference_after_children()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reference_id uuid;
begin
  if tg_op = 'DELETE' then
    v_reference_id := old.reference_id;
  else
    v_reference_id := new.reference_id;
  end if;

  perform public.sync_feed_from_reference(v_reference_id);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
create or replace function public.sync_feed_from_reference_after_bookmarks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reference_id uuid;
begin
  if tg_op = 'DELETE' then
    v_reference_id := old.reference_id;
  else
    v_reference_id := new.reference_id;
  end if;

  perform public.sync_feed_from_reference(v_reference_id);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
create or replace function public.sync_feed_from_shop_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.name is distinct from old.name) or (new.address is distinct from old.address) then
    perform public.sync_feed_from_reference(r.id)
    from public.references r
    where r.shop_id = new.id;
  end if;

  return new;
end;
$$;
drop trigger if exists trg_sync_feed_from_references on public.references;
create trigger trg_sync_feed_from_references
after insert or update on public.references
for each row
execute function public.sync_feed_from_reference_after_references();
drop trigger if exists trg_sync_feed_from_reference_images on public.reference_images;
create trigger trg_sync_feed_from_reference_images
after insert or update or delete on public.reference_images
for each row
execute function public.sync_feed_from_reference_after_children();
drop trigger if exists trg_sync_feed_from_reference_style_tags on public.reference_style_tags;
create trigger trg_sync_feed_from_reference_style_tags
after insert or delete on public.reference_style_tags
for each row
execute function public.sync_feed_from_reference_after_children();
drop trigger if exists trg_sync_feed_from_reference_reviews on public.reference_reviews;
create trigger trg_sync_feed_from_reference_reviews
after insert or update or delete on public.reference_reviews
for each row
execute function public.sync_feed_from_reference_after_children();
drop trigger if exists trg_sync_feed_from_bookmarks on public.bookmarks;
create trigger trg_sync_feed_from_bookmarks
after insert or delete on public.bookmarks
for each row
execute function public.sync_feed_from_reference_after_bookmarks();
drop trigger if exists trg_sync_feed_from_shop_update on public.shops;
create trigger trg_sync_feed_from_shop_update
after update of name, address on public.shops
for each row
execute function public.sync_feed_from_shop_update();
do $$
declare
  v_reference_id uuid;
begin
  for v_reference_id in
    select r.id
    from public.references r
  loop
    perform public.sync_feed_from_reference(v_reference_id);
  end loop;
end
$$;
