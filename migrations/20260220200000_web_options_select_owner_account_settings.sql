-- Extend options type to include SELECT and add owner account settings.

alter table if exists public.options
  drop constraint if exists options_type_check;

alter table if exists public.options
  add constraint options_type_check
  check (type = any (array['ADDON'::text, 'QUANTITY'::text, 'SELECT'::text])) not valid;

alter table if exists public.options
  validate constraint options_type_check;

create table if not exists public.owner_account_settings (
  user_id uuid primary key references public.users(id) on delete cascade,
  notify_system_notice boolean not null default true,
  notify_security_notice boolean not null default true,
  notify_marketing boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_owner_account_settings_updated_at on public.owner_account_settings;
create trigger set_owner_account_settings_updated_at
before update on public.owner_account_settings
for each row execute function public.set_updated_at();

alter table public.owner_account_settings enable row level security;

drop policy if exists owner_account_settings_select_self on public.owner_account_settings;
create policy owner_account_settings_select_self
on public.owner_account_settings
for select
using (auth.uid() = user_id);

drop policy if exists owner_account_settings_insert_self on public.owner_account_settings;
create policy owner_account_settings_insert_self
on public.owner_account_settings
for insert
with check (auth.uid() = user_id);

drop policy if exists owner_account_settings_update_self on public.owner_account_settings;
create policy owner_account_settings_update_self
on public.owner_account_settings
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists owner_account_settings_delete_self on public.owner_account_settings;
create policy owner_account_settings_delete_self
on public.owner_account_settings
for delete
using (auth.uid() = user_id);

do $$
declare
  quote_targets_reg regclass := to_regclass('public.quote_request_targets');
  quote_responses_reg regclass := to_regclass('public.quote_responses');
  publication_exists boolean := exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  );
begin
  if publication_exists and quote_targets_reg is not null and not exists (
    select 1
    from pg_publication_rel
    where prpubid = (select oid from pg_publication where pubname = 'supabase_realtime')
      and prrelid = quote_targets_reg
  ) then
    execute 'alter publication supabase_realtime add table public.quote_request_targets';
  end if;

  if publication_exists and quote_responses_reg is not null and not exists (
    select 1
    from pg_publication_rel
    where prpubid = (select oid from pg_publication where pubname = 'supabase_realtime')
      and prrelid = quote_responses_reg
  ) then
    execute 'alter publication supabase_realtime add table public.quote_responses';
  end if;
end $$;
