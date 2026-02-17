-- Feed list + detail tables (MVP)

create table if not exists public.feed_posts (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'active',
  title text not null,
  thumbnail_url text not null,
  shape_category text not null,
  style_tags text[] not null default '{}',
  is_reservable boolean not null default false,
  studio_name text not null,
  location_text text not null,
  distance_km numeric(6,2),
  original_price integer not null check (original_price >= 0),
  discounted_price integer not null check (discounted_price >= 0 and discounted_price <= original_price),
  duration_min integer not null default 60 check (duration_min > 0),
  description text not null default '',
  like_count integer not null default 0 check (like_count >= 0),
  review_count integer not null default 0 check (review_count >= 0),
  rating_avg numeric(2,1) not null default 0.0 check (rating_avg >= 0 and rating_avg <= 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feed_posts_status_check check (status in ('active', 'hidden'))
);
create table if not exists public.feed_post_images (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.feed_posts(id) on delete cascade,
  image_url text not null,
  sort_order integer not null default 0 check (sort_order >= 0)
);
create table if not exists public.feed_post_reviews (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.feed_posts(id) on delete cascade,
  user_name text not null,
  rating integer not null check (rating between 1 and 5),
  comment text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.feed_post_likes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.feed_posts(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint feed_post_likes_post_user_key unique (post_id, user_id)
);
create index if not exists feed_posts_status_created_idx
  on public.feed_posts (status, created_at desc, id desc);
create index if not exists feed_posts_status_reservable_created_idx
  on public.feed_posts (status, is_reservable, created_at desc, id desc);
create index if not exists feed_posts_style_tags_gin_idx
  on public.feed_posts using gin (style_tags);
create index if not exists feed_post_images_post_sort_idx
  on public.feed_post_images (post_id, sort_order);
create index if not exists feed_post_reviews_post_created_idx
  on public.feed_post_reviews (post_id, created_at desc);
create index if not exists feed_post_likes_user_created_idx
  on public.feed_post_likes (user_id, created_at desc);
create or replace function public.feed_posts_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists feed_posts_set_updated_at on public.feed_posts;
create trigger feed_posts_set_updated_at
before update on public.feed_posts
for each row
execute function public.feed_posts_set_updated_at();
-- Seed rows for local/dev environments.
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
values
  (
    '11111111-1111-4111-8111-111111111111',
    'active',
    '시럽 그라데이션 & 미니멀 포인트 네일',
    'https://picsum.photos/seed/nail-feed-1/800/800',
    '아몬드',
    array['그라데이션/옴브레', '청순/내추럴'],
    true,
    'Glow Nail Studio',
    '강남구 신사동',
    2.4,
    68000,
    55000,
    60,
    '투명한 시럽 베이스에 은은한 펄 포인트를 더한 디자인입니다.',
    245,
    1240,
    4.9,
    now() - interval '1 day'
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'active',
    '데일리 프렌치 라인 네일',
    'https://picsum.photos/seed/nail-feed-2/800/800',
    '라운드',
    array['프렌치', '오피스/미니멀'],
    false,
    'Lumi Nail',
    '서초구 반포동',
    3.1,
    59000,
    47000,
    55,
    '깔끔한 화이트 라인으로 데일리 룩에 매치하기 좋은 디자인입니다.',
    156,
    420,
    4.7,
    now() - interval '2 day'
  ),
  (
    '33333333-3333-4333-8333-333333333333',
    'active',
    '글리터 포인트 파츠 네일',
    'https://picsum.photos/seed/nail-feed-3/800/800',
    '스퀘어',
    array['글리터/펄', '포인트아트'],
    true,
    'Dear Nail House',
    '송파구 잠실동',
    4.7,
    75000,
    62000,
    70,
    '은은한 글리터와 파츠 포인트가 들어간 반짝이는 무드의 네일입니다.',
    312,
    870,
    4.8,
    now() - interval '3 day'
  )
on conflict (id) do nothing;
insert into public.feed_post_images (post_id, image_url, sort_order)
values
  ('11111111-1111-4111-8111-111111111111', 'https://picsum.photos/seed/nail-feed-1-a/1200/1200', 0),
  ('11111111-1111-4111-8111-111111111111', 'https://picsum.photos/seed/nail-feed-1-b/1200/1200', 1),
  ('11111111-1111-4111-8111-111111111111', 'https://picsum.photos/seed/nail-feed-1-c/1200/1200', 2),
  ('22222222-2222-4222-8222-222222222222', 'https://picsum.photos/seed/nail-feed-2-a/1200/1200', 0),
  ('22222222-2222-4222-8222-222222222222', 'https://picsum.photos/seed/nail-feed-2-b/1200/1200', 1),
  ('33333333-3333-4333-8333-333333333333', 'https://picsum.photos/seed/nail-feed-3-a/1200/1200', 0),
  ('33333333-3333-4333-8333-333333333333', 'https://picsum.photos/seed/nail-feed-3-b/1200/1200', 1)
on conflict do nothing;
insert into public.feed_post_reviews (post_id, user_name, rating, comment, created_at)
values
  (
    '11111111-1111-4111-8111-111111111111',
    'user_0921',
    5,
    '사진보다 실제가 더 예뻐요. 손이 길어 보이고 컬러가 차분해서 데일리로 딱입니다.',
    now() - interval '10 hour'
  ),
  (
    '11111111-1111-4111-8111-111111111111',
    'nail_lover',
    5,
    '시럽 레이어가 맑게 올라가서 깔끔해요. 어떤 옷이랑도 잘 어울립니다.',
    now() - interval '18 hour'
  ),
  (
    '11111111-1111-4111-8111-111111111111',
    'daily_beauty',
    4,
    '전체적으로 만족! 큐티클 라인 정리가 섬세해서 완성도가 높았어요.',
    now() - interval '30 hour'
  ),
  (
    '33333333-3333-4333-8333-333333333333',
    'beauty_day',
    5,
    '파츠 배치가 세련되고 사진이 잘 나와요.',
    now() - interval '12 hour'
  )
on conflict do nothing;
