-- Booking availability contract update
-- - Introduce shop-level booking toggle
-- - Add slot lookup index for availability checks
-- - Allow shop members to read reservations and manage slots

alter table public.shop_settings
  add column if not exists booking_enabled boolean not null default false;

create index if not exists idx_slots_shop_status_start
  on public.slots (shop_id, status, start_at);

alter table public.slots enable row level security;
alter table public.reservations enable row level security;

drop policy if exists slots_select_by_membership on public.slots;
create policy slots_select_by_membership
on public.slots
for select
to authenticated
using (
  exists (
    select 1
    from public.shop_members sm
    where sm.shop_id = slots.shop_id
      and sm.user_id = auth.uid()
  )
);

drop policy if exists slots_insert_by_membership on public.slots;
create policy slots_insert_by_membership
on public.slots
for insert
to authenticated
with check (
  exists (
    select 1
    from public.shop_members sm
    where sm.shop_id = slots.shop_id
      and sm.user_id = auth.uid()
  )
);

drop policy if exists slots_update_by_membership on public.slots;
create policy slots_update_by_membership
on public.slots
for update
to authenticated
using (
  exists (
    select 1
    from public.shop_members sm
    where sm.shop_id = slots.shop_id
      and sm.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.shop_members sm
    where sm.shop_id = slots.shop_id
      and sm.user_id = auth.uid()
  )
);

drop policy if exists slots_delete_by_membership on public.slots;
create policy slots_delete_by_membership
on public.slots
for delete
to authenticated
using (
  exists (
    select 1
    from public.shop_members sm
    where sm.shop_id = slots.shop_id
      and sm.user_id = auth.uid()
  )
);

drop policy if exists reservations_select_by_membership on public.reservations;
create policy reservations_select_by_membership
on public.reservations
for select
to authenticated
using (
  exists (
    select 1
    from public.shop_members sm
    where sm.shop_id = reservations.shop_id
      and sm.user_id = auth.uid()
  )
);
