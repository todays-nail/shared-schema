create table if not exists public.nail_generation_likes (
  user_id uuid not null references public.users(id) on delete cascade,
  job_id uuid not null references public.nail_generation_jobs(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint nail_generation_likes_pkey primary key (user_id, job_id)
);

create index if not exists nail_generation_likes_user_created_job_desc_idx
  on public.nail_generation_likes (user_id, created_at desc, job_id desc);

create index if not exists nail_generation_likes_job_idx
  on public.nail_generation_likes (job_id);

alter table public.nail_generation_likes enable row level security;
