-- Align constraint/index names for nail_generation_jobs parent_job relation
-- to the canonical names used by current remote schema.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'nail_generation_jobs'
      AND c.conname = 'nail_generation_jobs_parent_job_id_fkey'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname = 'nail_generation_jobs'
        AND c.conname = 'nail_generation_jobs_parent_job_fkey'
    ) THEN
      ALTER TABLE public.nail_generation_jobs
        DROP CONSTRAINT nail_generation_jobs_parent_job_id_fkey;
    ELSE
      ALTER TABLE public.nail_generation_jobs
        RENAME CONSTRAINT nail_generation_jobs_parent_job_id_fkey TO nail_generation_jobs_parent_job_fkey;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class i
    JOIN pg_namespace n ON n.oid = i.relnamespace
    WHERE n.nspname = 'public'
      AND i.relname = 'nail_generation_jobs_parent_job_id_idx'
      AND i.relkind = 'i'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM pg_class i
      JOIN pg_namespace n ON n.oid = i.relnamespace
      WHERE n.nspname = 'public'
        AND i.relname = 'nail_generation_jobs_parent_job_idx'
        AND i.relkind = 'i'
    ) THEN
      DROP INDEX public.nail_generation_jobs_parent_job_id_idx;
    ELSE
      ALTER INDEX public.nail_generation_jobs_parent_job_id_idx
        RENAME TO nail_generation_jobs_parent_job_idx;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class i
    JOIN pg_namespace n ON n.oid = i.relnamespace
    WHERE n.nspname = 'public'
      AND i.relname = 'nail_generation_jobs_parent_job_id_unique_once'
      AND i.relkind = 'i'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM pg_class i
      JOIN pg_namespace n ON n.oid = i.relnamespace
      WHERE n.nspname = 'public'
        AND i.relname = 'nail_generation_jobs_parent_job_once_uniq'
        AND i.relkind = 'i'
    ) THEN
      DROP INDEX public.nail_generation_jobs_parent_job_id_unique_once;
    ELSE
      ALTER INDEX public.nail_generation_jobs_parent_job_id_unique_once
        RENAME TO nail_generation_jobs_parent_job_once_uniq;
    END IF;
  END IF;
END $$;
