-- owner dashboard + notifications
-- - add payment ledger for reservation deposit/balance tracking
-- - add owner notification inbox + read states
-- - add automatic notification triggers (reservation/quote/payment)

create table if not exists public.reservation_payment_ledgers (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  payment_stage text not null,
  amount integer not null,
  paid_at timestamp with time zone not null default now(),
  memo text not null default '',
  recorded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint reservation_payment_ledgers_stage_check
    check (payment_stage in ('DEPOSIT', 'BALANCE')),
  constraint reservation_payment_ledgers_amount_check
    check (amount >= 0),
  constraint reservation_payment_ledgers_memo_len_check
    check (char_length(memo) <= 1000),
  constraint reservation_payment_ledgers_unique
    unique (reservation_id, payment_stage)
);

create index if not exists reservation_payment_ledgers_shop_paid_idx
  on public.reservation_payment_ledgers (shop_id, paid_at desc);

create index if not exists reservation_payment_ledgers_reservation_paid_idx
  on public.reservation_payment_ledgers (reservation_id, paid_at desc);

create or replace function public.reservation_payment_ledgers_fill_shop_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop_id uuid;
begin
  select r.shop_id
    into v_shop_id
  from public.reservations r
  where r.id = new.reservation_id;

  if v_shop_id is null then
    raise exception 'reservation not found for ledger.reservation_id=%', new.reservation_id;
  end if;

  new.shop_id := v_shop_id;
  return new;
end;
$$;

drop trigger if exists reservation_payment_ledgers_fill_shop_id_trg on public.reservation_payment_ledgers;
create trigger reservation_payment_ledgers_fill_shop_id_trg
before insert or update of reservation_id
on public.reservation_payment_ledgers
for each row execute function public.reservation_payment_ledgers_fill_shop_id();

drop trigger if exists set_reservation_payment_ledgers_updated_at on public.reservation_payment_ledgers;
create trigger set_reservation_payment_ledgers_updated_at
before update on public.reservation_payment_ledgers
for each row execute function public.set_updated_at();

alter table public.reservation_payment_ledgers enable row level security;

drop policy if exists reservation_payment_ledgers_select_by_user on public.reservation_payment_ledgers;
create policy reservation_payment_ledgers_select_by_user
on public.reservation_payment_ledgers
for select
using (
  exists (
    select 1
    from public.reservations r
    where r.id = reservation_payment_ledgers.reservation_id
      and r.user_id = auth.uid()
  )
  or exists (
    select 1
    from public.shop_members sm
    where sm.shop_id = reservation_payment_ledgers.shop_id
      and sm.user_id = auth.uid()
  )
);

drop policy if exists reservation_payment_ledgers_insert_by_shop_membership on public.reservation_payment_ledgers;
create policy reservation_payment_ledgers_insert_by_shop_membership
on public.reservation_payment_ledgers
for insert
with check (
  recorded_by = auth.uid()
  and exists (
    select 1
    from public.shop_members sm
    where sm.shop_id = reservation_payment_ledgers.shop_id
      and sm.user_id = auth.uid()
  )
);

drop policy if exists reservation_payment_ledgers_update_by_shop_membership on public.reservation_payment_ledgers;
create policy reservation_payment_ledgers_update_by_shop_membership
on public.reservation_payment_ledgers
for update
using (
  exists (
    select 1
    from public.shop_members sm
    where sm.shop_id = reservation_payment_ledgers.shop_id
      and sm.user_id = auth.uid()
  )
)
with check (
  recorded_by = auth.uid()
  and exists (
    select 1
    from public.shop_members sm
    where sm.shop_id = reservation_payment_ledgers.shop_id
      and sm.user_id = auth.uid()
  )
);

create table if not exists public.owner_notifications (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  type text not null,
  title text not null,
  description text not null,
  source_table text not null,
  source_id uuid not null,
  source_event text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  constraint owner_notifications_type_check
    check (type in ('BOOKING_CREATED', 'QUOTE_REQUEST_CREATED', 'PAYMENT_RECORDED', 'SYSTEM')),
  constraint owner_notifications_title_len_check
    check (char_length(title) <= 120),
  constraint owner_notifications_description_len_check
    check (char_length(description) <= 500),
  constraint owner_notifications_source_unique
    unique (shop_id, source_table, source_id, source_event)
);

create index if not exists owner_notifications_shop_created_idx
  on public.owner_notifications (shop_id, created_at desc);

alter table public.owner_notifications enable row level security;

drop policy if exists owner_notifications_select_by_shop_membership on public.owner_notifications;
create policy owner_notifications_select_by_shop_membership
on public.owner_notifications
for select
using (
  exists (
    select 1
    from public.shop_members sm
    where sm.shop_id = owner_notifications.shop_id
      and sm.user_id = auth.uid()
  )
);

create table if not exists public.owner_notification_reads (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.owner_notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint owner_notification_reads_unique
    unique (notification_id, user_id)
);

create index if not exists owner_notification_reads_user_read_at_idx
  on public.owner_notification_reads (user_id, read_at desc);

drop trigger if exists set_owner_notification_reads_updated_at on public.owner_notification_reads;
create trigger set_owner_notification_reads_updated_at
before update on public.owner_notification_reads
for each row execute function public.set_updated_at();

alter table public.owner_notification_reads enable row level security;

drop policy if exists owner_notification_reads_select_own on public.owner_notification_reads;
create policy owner_notification_reads_select_own
on public.owner_notification_reads
for select
using (
  user_id = auth.uid()
  and exists (
    select 1
    from public.owner_notifications n
    join public.shop_members sm on sm.shop_id = n.shop_id
    where n.id = owner_notification_reads.notification_id
      and sm.user_id = auth.uid()
  )
);

drop policy if exists owner_notification_reads_insert_own on public.owner_notification_reads;
create policy owner_notification_reads_insert_own
on public.owner_notification_reads
for insert
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.owner_notifications n
    join public.shop_members sm on sm.shop_id = n.shop_id
    where n.id = owner_notification_reads.notification_id
      and sm.user_id = auth.uid()
  )
);

drop policy if exists owner_notification_reads_update_own on public.owner_notification_reads;
create policy owner_notification_reads_update_own
on public.owner_notification_reads
for update
using (
  user_id = auth.uid()
)
with check (
  user_id = auth.uid()
);

create or replace function public.owner_notifications_on_reservation_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer text;
  v_service text;
  v_description text;
begin
  select coalesce(u.nickname, '고객 ' || left(new.user_id::text, 8)),
         coalesce(r.title, '시술')
    into v_customer, v_service
  from public.users u
  left join public.references r on r.id = new.reference_id
  where u.id = new.user_id;

  v_description := format('%s님이 %s 예약을 생성했습니다.', v_customer, v_service);

  insert into public.owner_notifications (
    shop_id,
    type,
    title,
    description,
    source_table,
    source_id,
    source_event,
    metadata
  ) values (
    new.shop_id,
    'BOOKING_CREATED',
    '새 예약 접수',
    v_description,
    'reservations',
    new.id,
    'CREATED',
    jsonb_build_object('reservation_status', new.status)
  )
  on conflict (shop_id, source_table, source_id, source_event) do nothing;

  return new;
end;
$$;

drop trigger if exists owner_notifications_on_reservation_created_trg on public.reservations;
create trigger owner_notifications_on_reservation_created_trg
after insert on public.reservations
for each row execute function public.owner_notifications_on_reservation_created();

create or replace function public.owner_notifications_on_quote_target_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer text;
  v_note text;
  v_description text;
begin
  select coalesce(u.nickname, '고객 ' || left(qr.user_id::text, 8)),
         coalesce(nullif(trim(qr.request_note), ''), '요청 메모 없음')
    into v_customer, v_note
  from public.quote_requests qr
  left join public.users u on u.id = qr.user_id
  where qr.id = new.quote_request_id;

  v_description := format('%s님의 요청서가 도착했습니다. %s', v_customer, left(v_note, 120));

  insert into public.owner_notifications (
    shop_id,
    type,
    title,
    description,
    source_table,
    source_id,
    source_event,
    metadata
  ) values (
    new.shop_id,
    'QUOTE_REQUEST_CREATED',
    '새 견적 요청서 도착',
    v_description,
    'quote_request_targets',
    new.id,
    'CREATED',
    jsonb_build_object('target_status', new.status)
  )
  on conflict (shop_id, source_table, source_id, source_event) do nothing;

  return new;
end;
$$;

drop trigger if exists owner_notifications_on_quote_target_created_trg on public.quote_request_targets;
create trigger owner_notifications_on_quote_target_created_trg
after insert on public.quote_request_targets
for each row execute function public.owner_notifications_on_quote_target_created();

create or replace function public.owner_notifications_on_payment_recorded()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_description text;
begin
  v_title := case new.payment_stage
    when 'DEPOSIT' then '예약금 결제 기록'
    when 'BALANCE' then '잔금 결제 기록'
    else '결제 기록'
  end;

  v_description := format('%s %s원이 기록되었습니다.', v_title, to_char(new.amount, 'FM999,999,999,990'));

  insert into public.owner_notifications (
    shop_id,
    type,
    title,
    description,
    source_table,
    source_id,
    source_event,
    metadata
  ) values (
    new.shop_id,
    'PAYMENT_RECORDED',
    v_title,
    v_description,
    'reservation_payment_ledgers',
    new.id,
    new.payment_stage,
    jsonb_build_object(
      'reservation_id', new.reservation_id,
      'payment_stage', new.payment_stage,
      'amount', new.amount
    )
  )
  on conflict (shop_id, source_table, source_id, source_event) do nothing;

  return new;
end;
$$;

drop trigger if exists owner_notifications_on_payment_recorded_trg on public.reservation_payment_ledgers;
create trigger owner_notifications_on_payment_recorded_trg
after insert on public.reservation_payment_ledgers
for each row execute function public.owner_notifications_on_payment_recorded();
