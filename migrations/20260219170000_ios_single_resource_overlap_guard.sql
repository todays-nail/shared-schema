-- Single-resource booking guard for one-person shops
-- - Persist reservation interval snapshots
-- - Prevent active reservation interval overlaps within the same shop

create extension if not exists btree_gist;

alter table public.reservations
  add column if not exists slot_start_at timestamp with time zone,
  add column if not exists slot_end_at timestamp with time zone;

create or replace function public.validate_reservation_shop_consistency()
returns trigger
language plpgsql
as $$
declare
  v_reference_shop_id uuid;
  v_slot_shop_id uuid;
  v_slot_start_at timestamp with time zone;
  v_slot_duration_min integer;
begin
  select r.shop_id
    into v_reference_shop_id
  from public.references r
  where r.id = new.reference_id;

  if v_reference_shop_id is null then
    raise exception 'reference not found for reservation.reference_id=%', new.reference_id;
  end if;

  select s.shop_id, s.start_at, greatest(1, s.duration_min)
    into v_slot_shop_id, v_slot_start_at, v_slot_duration_min
  from public.slots s
  where s.id = new.slot_id;

  if v_slot_shop_id is null then
    raise exception 'slot not found for reservation.slot_id=%', new.slot_id;
  end if;

  if new.shop_id is distinct from v_reference_shop_id
     or new.shop_id is distinct from v_slot_shop_id
     or v_reference_shop_id is distinct from v_slot_shop_id then
    raise exception 'reservation/shop mismatch (reservation.shop_id=%, reference.shop_id=%, slot.shop_id=%)',
      new.shop_id,
      v_reference_shop_id,
      v_slot_shop_id;
  end if;

  new.slot_start_at := v_slot_start_at;
  new.slot_end_at := v_slot_start_at + make_interval(mins => v_slot_duration_min);

  return new;
end;
$$;

drop trigger if exists trg_validate_reservation_shop_consistency on public.reservations;

create trigger trg_validate_reservation_shop_consistency
before insert or update of shop_id, reference_id, slot_id
on public.reservations
for each row
execute function public.validate_reservation_shop_consistency();

update public.reservations r
set
  slot_start_at = s.start_at,
  slot_end_at = s.start_at + make_interval(mins => greatest(1, s.duration_min))
from public.slots s
where s.id = r.slot_id
  and (
    r.slot_start_at is null
    or r.slot_end_at is null
    or r.slot_end_at <= r.slot_start_at
  );

alter table public.reservations
  alter column slot_start_at set not null,
  alter column slot_end_at set not null;

alter table public.reservations
  drop constraint if exists reservations_slot_interval_check;

alter table public.reservations
  add constraint reservations_slot_interval_check
  check (slot_end_at > slot_start_at);

alter table public.reservations
  drop constraint if exists reservations_no_overlap_per_shop_active;

alter table public.reservations
  add constraint reservations_no_overlap_per_shop_active
  exclude using gist (
    shop_id with =,
    tstzrange(slot_start_at, slot_end_at, '[)') with &&
  )
  where (
    status = any (
      array[
        'PENDING_DEPOSIT'::text,
        'DEPOSIT_PAID'::text,
        'CONFIRMED'::text,
        'SERVICE_CONFIRMED'::text,
        'BALANCE_PAID'::text,
        'COMPLETED'::text
      ]
    )
  );

create index if not exists idx_reservations_shop_slot_interval_active
  on public.reservations (shop_id, slot_start_at, slot_end_at)
  where status = any (
    array[
      'PENDING_DEPOSIT'::text,
      'DEPOSIT_PAID'::text,
      'CONFIRMED'::text,
      'SERVICE_CONFIRMED'::text,
      'BALANCE_PAID'::text,
      'COMPLETED'::text
    ]
  );
