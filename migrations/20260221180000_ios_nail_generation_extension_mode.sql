-- Move nail extension option to a structured column.

alter table if exists public.nail_generation_jobs
  add column if not exists extension_mode text;

update public.nail_generation_jobs
set extension_mode = case
  when upper(trim(coalesce(user_prompt, ''))) = 'EXT_MODE=EXTEND' then 'EXTEND'
  else 'NATURAL'
end
where extension_mode is null;

alter table if exists public.nail_generation_jobs
  alter column extension_mode set default 'NATURAL';

alter table if exists public.nail_generation_jobs
  alter column extension_mode set not null;

alter table if exists public.nail_generation_jobs
  drop constraint if exists nail_generation_jobs_extension_mode_check;

alter table if exists public.nail_generation_jobs
  add constraint nail_generation_jobs_extension_mode_check
  check (extension_mode in ('NATURAL', 'EXTEND'));
