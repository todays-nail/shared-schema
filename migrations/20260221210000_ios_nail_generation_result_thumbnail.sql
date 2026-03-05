begin;

alter table if exists public.nail_generation_jobs
  add column if not exists result_thumbnail_object_path text;

insert into storage.buckets (id, name, public)
values ('nail-results-thumb-public', 'nail-results-thumb-public', true)
on conflict (id) do update
set public = excluded.public;

commit;
