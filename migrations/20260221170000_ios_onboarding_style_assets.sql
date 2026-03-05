-- Onboarding preferred style image metadata
-- - Image binary lives in public storage bucket.
-- - DB table stores style key -> public image URL mapping.

insert into storage.buckets (id, name, public)
values ('onboarding-style-images-public', 'onboarding-style-images-public', true)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public;

create table if not exists public.onboarding_style_assets (
  style_key text primary key,
  image_url text not null,
  updated_at timestamptz not null default now(),
  constraint onboarding_style_assets_style_key_check check (
    style_key in (
      'office_minimal',
      'natural',
      'lovely',
      'hip',
      'chic_modern',
      'kitsh_unique',
      'glitter_pearl',
      'french',
      'gradient_ombre',
      'wedding',
      'season_spring',
      'point-art'
    )
  ),
  constraint onboarding_style_assets_image_url_non_empty check (char_length(btrim(image_url)) > 0)
);

alter table public.onboarding_style_assets enable row level security;

drop policy if exists onboarding_style_assets_select_public on public.onboarding_style_assets;
create policy onboarding_style_assets_select_public
on public.onboarding_style_assets
for select
to anon, authenticated
using (true);

drop trigger if exists trg_onboarding_style_assets_updated_at on public.onboarding_style_assets;
create trigger trg_onboarding_style_assets_updated_at
before update on public.onboarding_style_assets
for each row execute function public.set_updated_at();
