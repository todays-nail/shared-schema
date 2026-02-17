-- Allow empty user_prompt for nail generation jobs.

alter table if exists public.nail_generation_jobs
  drop constraint if exists nail_generation_jobs_prompt_len_check;
alter table if exists public.nail_generation_jobs
  add constraint nail_generation_jobs_prompt_len_check
  check (char_length(user_prompt) between 0 and 500);
