-- Ensure parent_job self-reference FK has ON DELETE SET NULL semantics.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'nail_generation_jobs'
      AND c.conname = 'nail_generation_jobs_parent_job_fkey'
      AND pg_get_constraintdef(c.oid) NOT ILIKE '%ON DELETE SET NULL%'
  ) THEN
    ALTER TABLE public.nail_generation_jobs
      DROP CONSTRAINT nail_generation_jobs_parent_job_fkey;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'nail_generation_jobs'
      AND c.conname = 'nail_generation_jobs_parent_job_fkey'
  ) THEN
    ALTER TABLE public.nail_generation_jobs
      ADD CONSTRAINT nail_generation_jobs_parent_job_fkey
      FOREIGN KEY (parent_job_id) REFERENCES public.nail_generation_jobs(id) ON DELETE SET NULL NOT VALID;

    ALTER TABLE public.nail_generation_jobs
      VALIDATE CONSTRAINT nail_generation_jobs_parent_job_fkey;
  END IF;
END $$;
