-- Nail AI generation jobs (MVP)

create table if not exists public.nail_generation_jobs (
  id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  status text not null,
  shape text not null,
  user_prompt text not null,
  hand_object_path text not null,
  reference_object_path text not null,
  result_object_path text,
  model text not null default 'gpt-image-1',
  provider text not null default 'openai',
  attempt_count integer not null default 0,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  constraint nail_generation_jobs_status_check
    check (status in ('queued', 'processing', 'completed', 'failed')),
  constraint nail_generation_jobs_shape_check
    check (shape in ('almond', 'square', 'round')),
  constraint nail_generation_jobs_prompt_len_check
    check (char_length(user_prompt) between 1 and 500)
);
create index if not exists nail_generation_jobs_user_created_idx
  on public.nail_generation_jobs (user_id, created_at desc);
create index if not exists nail_generation_jobs_status_created_idx
  on public.nail_generation_jobs (status, created_at asc);
create or replace function public.nail_generation_jobs_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists nail_generation_jobs_set_updated_at on public.nail_generation_jobs;
create trigger nail_generation_jobs_set_updated_at
before update on public.nail_generation_jobs
for each row
execute function public.nail_generation_jobs_set_updated_at();
insert into storage.buckets (id, name, public)
values
  ('nail-inputs-private', 'nail-inputs-private', false),
  ('nail-results-private', 'nail-results-private', false)
on conflict (id) do update
set public = excluded.public;
