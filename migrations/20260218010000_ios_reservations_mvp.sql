-- Reservations MVP hardening
-- - Extend status enum for cancellation/expiration
-- - Make slot uniqueness apply only to active reservations
-- - Enforce reservation/reference/slot shop consistency

alter table public.reservations
  drop constraint if exists reservations_status_check;

alter table public.reservations
  add constraint reservations_status_check
  check (
    status = any (
      array[
        'PENDING_DEPOSIT'::text,
        'DEPOSIT_PAID'::text,
        'CONFIRMED'::text,
        'SERVICE_CONFIRMED'::text,
        'BALANCE_PAID'::text,
        'COMPLETED'::text,
        'USER_CANCELLED'::text,
        'SHOP_CANCELLED'::text,
        'EXPIRED'::text
      ]
    )
  );

drop index if exists public.uq_reservations_slot;

create unique index if not exists uq_reservations_slot_active
  on public.reservations (slot_id)
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

create index if not exists idx_reservations_slot_status
  on public.reservations (slot_id, status, created_at desc);

create or replace function public.validate_reservation_shop_consistency()
returns trigger
language plpgsql
as $$
declare
  v_reference_shop_id uuid;
  v_slot_shop_id uuid;
begin
  select r.shop_id
    into v_reference_shop_id
  from public.references r
  where r.id = new.reference_id;

  if v_reference_shop_id is null then
    raise exception 'reference not found for reservation.reference_id=%', new.reference_id;
  end if;

  select s.shop_id
    into v_slot_shop_id
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

  return new;
end;
$$;

drop trigger if exists trg_validate_reservation_shop_consistency on public.reservations;

create trigger trg_validate_reservation_shop_consistency
before insert or update of shop_id, reference_id, slot_id
on public.reservations
for each row
execute function public.validate_reservation_shop_consistency();
