-- Runtime UI switch for social login buttons.
-- Default is circular icon UI, with server-side rollback to official wide buttons.

create table if not exists public.app_runtime_flags (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now(),
  constraint app_runtime_flags_key_check
    check (key in ('social_login_ui_variant')),
  constraint app_runtime_flags_value_check
    check (
      key <> 'social_login_ui_variant'
      or value in ('circular', 'official')
    )
);

drop trigger if exists set_app_runtime_flags_updated_at on public.app_runtime_flags;
create trigger set_app_runtime_flags_updated_at
before update on public.app_runtime_flags
for each row execute function public.set_updated_at();

alter table public.app_runtime_flags enable row level security;

insert into public.app_runtime_flags (key, value)
values ('social_login_ui_variant', 'circular')
on conflict (key) do update
set value = excluded.value,
    updated_at = now();
