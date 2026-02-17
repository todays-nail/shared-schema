alter table public.nail_generation_jobs
    add column if not exists parent_job_id uuid,
    add column if not exists refinement_turn integer not null default 0;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'nail_generation_jobs_parent_job_id_fkey'
    ) then
        alter table public.nail_generation_jobs
            add constraint nail_generation_jobs_parent_job_id_fkey
            foreign key (parent_job_id) references public.nail_generation_jobs(id);
    end if;
end
$$;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'nail_generation_jobs_refinement_turn_check'
    ) then
        alter table public.nail_generation_jobs
            add constraint nail_generation_jobs_refinement_turn_check
            check (refinement_turn in (0, 1));
    end if;
end
$$;

create index if not exists nail_generation_jobs_parent_job_id_idx
    on public.nail_generation_jobs (parent_job_id);

create unique index if not exists nail_generation_jobs_parent_job_id_unique_once
    on public.nail_generation_jobs (parent_job_id)
    where parent_job_id is not null;
