-- Feed region filter support
-- Source of truth: public.shops.region_id
-- Mirror field: public.feed_posts.region_id

alter table public.feed_posts
  add column if not exists region_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'feed_posts_region_id_fkey'
      and conrelid = 'public.feed_posts'::regclass
  ) then
    alter table public.feed_posts
      add constraint feed_posts_region_id_fkey
      foreign key (region_id) references public.regions(id) on delete set null;
  end if;
end
$$;

create index if not exists feed_posts_status_region_created_idx
  on public.feed_posts (status, region_id, created_at desc, id desc);

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
    s.region_id as shop_region_id,
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
    region_id,
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
    v_reference.shop_region_id,
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
    region_id = excluded.region_id,
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

create or replace function public.sync_feed_from_shop_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if
    (new.name is distinct from old.name)
    or (new.address is distinct from old.address)
    or (new.region_id is distinct from old.region_id)
  then
    perform public.sync_feed_from_reference(r.id)
    from public.references r
    where r.shop_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_feed_from_shop_update on public.shops;
create trigger trg_sync_feed_from_shop_update
after update of name, address, region_id on public.shops
for each row
execute function public.sync_feed_from_shop_update();

update public.feed_posts fp
set region_id = s.region_id
from public.references r
join public.shops s on s.id = r.shop_id
where fp.id = r.id
  and fp.region_id is distinct from s.region_id;
