alter table public.nail_generation_jobs
  add column if not exists deleted_at timestamptz;

create index if not exists nail_generation_jobs_active_user_created_idx
  on public.nail_generation_jobs (user_id, created_at desc)
  where deleted_at is null;
