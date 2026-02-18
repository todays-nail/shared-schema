-- Remove deprecated shape_category fields and align display-price mirrors.
-- Source of truth:
--   - references.final_price: customer-facing discounted price
--   - references.discounted_price: mirrored from final_price for internal compatibility

update public.references
set
  base_price = greatest(0, coalesce(base_price, 0)),
  final_price = least(
    greatest(0, coalesce(base_price, 0)),
    greatest(0, coalesce(final_price, discounted_price, base_price, 0))
  );

update public.references
set discounted_price = final_price
where discounted_price is distinct from final_price;

create or replace function public.references_apply_defaults()
returns trigger
language plpgsql
as $$
begin
  new.base_price := greatest(0, coalesce(new.base_price, 0));

  if new.final_price is null then
    new.final_price := coalesce(new.discounted_price, new.base_price, 0);
  end if;

  new.final_price := least(new.base_price, greatest(0, new.final_price));
  new.discounted_price := new.final_price;

  return new;
end;
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
    r.final_price,
    r.discounted_price,
    r.service_duration_min,
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
    greatest(
      0,
      coalesce(
        v_reference.final_price,
        v_reference.discounted_price,
        v_reference.base_price,
        0
      )
    )
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

alter table public.references
  drop column if exists shape_category;

alter table public.feed_posts
  drop column if exists shape_category;
