-- Non-chat quote MVP v2
-- - Request sheet + multi-target + owner response structure
-- - Existing quote_requests data can be reset in development

-- Reset previous quote schema (development data only)
drop table if exists public.quote_responses cascade;
drop table if exists public.quote_request_targets cascade;
drop table if exists public.quote_requests cascade;

create table if not exists public.quote_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  ai_generation_job_id uuid not null references public.nail_generation_jobs(id) on delete cascade,
  target_mode text not null,
  region_id uuid not null references public.regions(id) on delete restrict,
  preferred_date date not null,
  request_note text not null,
  status text not null default 'OPEN',
  selected_target_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quote_requests_target_mode_check
    check (target_mode in ('REGION_ALL', 'SELECTED_SHOPS')),
  constraint quote_requests_status_check
    check (status in ('OPEN', 'SELECTED', 'CLOSED')),
  constraint quote_requests_note_len_check
    check (char_length(request_note) between 1 and 1000),
  constraint quote_requests_selected_required_when_selected
    check (status <> 'SELECTED' or selected_target_id is not null),
  constraint quote_requests_selected_allowed_status
    check (selected_target_id is null or status in ('SELECTED', 'CLOSED'))
);

create index if not exists quote_requests_user_created_idx
  on public.quote_requests (user_id, created_at desc);

create index if not exists quote_requests_ai_generation_created_idx
  on public.quote_requests (ai_generation_job_id, created_at desc);

create index if not exists quote_requests_status_created_idx
  on public.quote_requests (status, created_at desc);

create table if not exists public.quote_request_targets (
  id uuid primary key default gen_random_uuid(),
  quote_request_id uuid not null references public.quote_requests(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  status text not null default 'REQUESTED',
  sent_at timestamptz not null default now(),
  responded_at timestamptz,
  selected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quote_request_targets_status_check
    check (status in ('REQUESTED', 'RESPONDED', 'SELECTED', 'CLOSED')),
  constraint quote_request_targets_quote_request_shop_unique
    unique (quote_request_id, shop_id)
);

create index if not exists quote_request_targets_request_status_idx
  on public.quote_request_targets (quote_request_id, status);

create index if not exists quote_request_targets_shop_status_idx
  on public.quote_request_targets (shop_id, status);

create table if not exists public.quote_responses (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null unique references public.quote_request_targets(id) on delete cascade,
  final_price integer not null,
  change_items text[] not null default '{}'::text[],
  memo text not null default '',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quote_responses_final_price_check
    check (final_price >= 0),
  constraint quote_responses_change_items_check
    check (change_items <@ array['EXTENSION', 'REMOVAL', 'ART_CHANGE', 'OTHER']::text[])
);

create index if not exists quote_responses_created_by_idx
  on public.quote_responses (created_by, created_at desc);

create index if not exists quote_responses_updated_at_idx
  on public.quote_responses (updated_at desc);

alter table public.quote_requests
  add constraint quote_requests_selected_target_fkey
  foreign key (selected_target_id)
  references public.quote_request_targets(id)
  on delete set null;

create or replace function public.quote_requests_validate_selected_target()
returns trigger
language plpgsql
as $$
declare
  selected_request_id uuid;
begin
  if new.selected_target_id is null then
    return new;
  end if;

  select t.quote_request_id
    into selected_request_id
  from public.quote_request_targets t
  where t.id = new.selected_target_id;

  if selected_request_id is null then
    raise exception 'selected_target_id not found';
  end if;

  if selected_request_id <> new.id then
    raise exception 'selected_target_id does not belong to quote request';
  end if;

  return new;
end;
$$;

drop trigger if exists quote_requests_validate_selected_target_trg on public.quote_requests;
create trigger quote_requests_validate_selected_target_trg
before insert or update of selected_target_id
on public.quote_requests
for each row
execute function public.quote_requests_validate_selected_target();

drop trigger if exists set_quote_requests_updated_at on public.quote_requests;
create trigger set_quote_requests_updated_at
before update on public.quote_requests
for each row execute function public.set_updated_at();

drop trigger if exists set_quote_request_targets_updated_at on public.quote_request_targets;
create trigger set_quote_request_targets_updated_at
before update on public.quote_request_targets
for each row execute function public.set_updated_at();

drop trigger if exists set_quote_responses_updated_at on public.quote_responses;
create trigger set_quote_responses_updated_at
before update on public.quote_responses
for each row execute function public.set_updated_at();

alter table public.quote_requests enable row level security;
alter table public.quote_request_targets enable row level security;
alter table public.quote_responses enable row level security;

-- quote_requests policies

drop policy if exists quote_requests_select_by_user on public.quote_requests;
create policy quote_requests_select_by_user
on public.quote_requests
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists quote_requests_insert_by_user on public.quote_requests;
create policy quote_requests_insert_by_user
on public.quote_requests
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists quote_requests_update_by_user on public.quote_requests;
create policy quote_requests_update_by_user
on public.quote_requests
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists quote_requests_select_by_shop_membership on public.quote_requests;
create policy quote_requests_select_by_shop_membership
on public.quote_requests
for select
to authenticated
using (
  exists (
    select 1
    from public.quote_request_targets t
    join public.shop_members sm on sm.shop_id = t.shop_id
    where t.quote_request_id = quote_requests.id
      and sm.user_id = auth.uid()
  )
);

-- quote_request_targets policies

drop policy if exists quote_request_targets_select_by_user_or_shop on public.quote_request_targets;
create policy quote_request_targets_select_by_user_or_shop
on public.quote_request_targets
for select
to authenticated
using (
  exists (
    select 1
    from public.quote_requests qr
    where qr.id = quote_request_targets.quote_request_id
      and qr.user_id = auth.uid()
  )
  or exists (
    select 1
    from public.shop_members sm
    where sm.shop_id = quote_request_targets.shop_id
      and sm.user_id = auth.uid()
  )
);

drop policy if exists quote_request_targets_insert_by_user on public.quote_request_targets;
create policy quote_request_targets_insert_by_user
on public.quote_request_targets
for insert
to authenticated
with check (
  exists (
    select 1
    from public.quote_requests qr
    where qr.id = quote_request_targets.quote_request_id
      and qr.user_id = auth.uid()
  )
);

drop policy if exists quote_request_targets_update_by_user_or_shop on public.quote_request_targets;
create policy quote_request_targets_update_by_user_or_shop
on public.quote_request_targets
for update
to authenticated
using (
  exists (
    select 1
    from public.quote_requests qr
    where qr.id = quote_request_targets.quote_request_id
      and qr.user_id = auth.uid()
  )
  or exists (
    select 1
    from public.shop_members sm
    where sm.shop_id = quote_request_targets.shop_id
      and sm.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.quote_requests qr
    where qr.id = quote_request_targets.quote_request_id
      and qr.user_id = auth.uid()
  )
  or exists (
    select 1
    from public.shop_members sm
    where sm.shop_id = quote_request_targets.shop_id
      and sm.user_id = auth.uid()
  )
);

-- quote_responses policies

drop policy if exists quote_responses_select_by_user_or_shop on public.quote_responses;
create policy quote_responses_select_by_user_or_shop
on public.quote_responses
for select
to authenticated
using (
  exists (
    select 1
    from public.quote_request_targets t
    join public.quote_requests qr on qr.id = t.quote_request_id
    where t.id = quote_responses.target_id
      and qr.user_id = auth.uid()
  )
  or exists (
    select 1
    from public.quote_request_targets t
    join public.shop_members sm on sm.shop_id = t.shop_id
    where t.id = quote_responses.target_id
      and sm.user_id = auth.uid()
  )
);

drop policy if exists quote_responses_insert_by_shop_member on public.quote_responses;
create policy quote_responses_insert_by_shop_member
on public.quote_responses
for insert
to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1
    from public.quote_request_targets t
    join public.shop_members sm on sm.shop_id = t.shop_id
    where t.id = quote_responses.target_id
      and sm.user_id = auth.uid()
  )
);

drop policy if exists quote_responses_update_by_shop_member on public.quote_responses;
create policy quote_responses_update_by_shop_member
on public.quote_responses
for update
to authenticated
using (
  exists (
    select 1
    from public.quote_request_targets t
    join public.shop_members sm on sm.shop_id = t.shop_id
    where t.id = quote_responses.target_id
      and sm.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.quote_request_targets t
    join public.shop_members sm on sm.shop_id = t.shop_id
    where t.id = quote_responses.target_id
      and sm.user_id = auth.uid()
  )
);
