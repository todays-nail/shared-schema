-- Add reference_likes for dashboard top 5 sorting by likes.
-- Write path is handled by external backend/service-role. Owner app reads only.

create table if not exists public.reference_likes (
  reference_id uuid not null references public.references (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (reference_id, user_id)
);

create index if not exists reference_likes_shop_id_reference_id_idx
  on public.reference_likes (shop_id, reference_id);

create index if not exists reference_likes_reference_id_idx
  on public.reference_likes (reference_id);

create index if not exists reference_likes_shop_id_created_at_desc_idx
  on public.reference_likes (shop_id, created_at desc);

alter table public.reference_likes enable row level security;

drop policy if exists reference_likes_select_by_membership on public.reference_likes;
create policy reference_likes_select_by_membership
on public.reference_likes
for select
to authenticated
using (
  shop_id in (
    select sm.shop_id
    from public.shop_members sm
    where sm.user_id = auth.uid()
  )
);
