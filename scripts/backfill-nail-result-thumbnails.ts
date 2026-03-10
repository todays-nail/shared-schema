import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";
import pg from "npm:pg";
import {
  buildJpegThumbnailBytesFromResult,
  defaultThumbnailObjectPath,
  THUMBNAIL_BUCKET,
  THUMBNAIL_CONTENT_TYPE,
  updateThumbnailPath,
  uploadJpegThumbnail,
} from "../supabase/functions/_shared/nail-result-thumbnails.ts";
import { requireEnv } from "../supabase/functions/_shared/env.ts";

type JobRow = {
  id: string;
  user_id: string;
  created_at: string;
  result_object_path: string | null;
  result_thumbnail_object_path: string | null;
};

type StorageObjectRow = {
  name: string;
  mimetype: string | null;
};

const supabaseUrl = requireEnv("SUPABASE_URL");
const dbUrl = requireEnv("SUPABASE_DB_URL");
const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const db = new pg.Client({ connectionString: dbUrl });

type Options = {
  dryRun: boolean;
  limit: number;
  afterId: string | null;
};

function parseArgs(args: string[]): Options {
  let dryRun = false;
  let limit = 50;
  let afterId: string | null = null;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--limit") {
      const value = Number(args[i + 1]);
      if (!Number.isInteger(value) || value < 1 || value > 500) {
        throw new Error("--limit must be an integer between 1 and 500");
      }
      limit = value;
      i += 1;
      continue;
    }
    if (arg === "--after-id") {
      const value = args[i + 1]?.trim();
      if (!value) {
        throw new Error("--after-id requires a job id");
      }
      afterId = value.toLowerCase();
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { dryRun, limit, afterId };
}

async function resolveAnchor(afterId: string): Promise<{ created_at: string; id: string }> {
  const result = await db.query<{ id: string; created_at: string }>(
    "select id::text as id, created_at::text as created_at from public.nail_generation_jobs where id = $1 limit 1",
    [afterId],
  );
  const data = result.rows[0];
  if (!data) {
    throw new Error(`anchor job not found: ${afterId}`);
  }

  return {
    created_at: new Date(data.created_at).toISOString(),
    id: data.id.toLowerCase(),
  };
}

async function fetchScanBatch(limit: number, afterId: string | null): Promise<JobRow[]> {
  const values: (string | number)[] = [];
  let sql = `
    select
      id::text as id,
      user_id::text as user_id,
      created_at::text as created_at,
      result_object_path,
      result_thumbnail_object_path
    from public.nail_generation_jobs
    where status = 'completed'
      and deleted_at is null
      and result_object_path is not null
  `;
  if (afterId) {
    const anchor = await resolveAnchor(afterId);
    values.push(anchor.created_at, anchor.id);
    sql += `
      and (
        created_at < $${values.length - 1}
        or (created_at = $${values.length - 1} and id::text < $${values.length})
      )
    `;
  }
  values.push(limit);
  sql += `
    order by created_at desc, id desc
    limit $${values.length}
  `;

  const result = await db.query<JobRow>(sql, values);
  return result.rows;
}

async function loadThumbnailMetadata(paths: string[]): Promise<Map<string, StorageObjectRow>> {
  if (paths.length === 0) return new Map();

  const result = await db.query<StorageObjectRow>(
    `
      select
        name,
        metadata->>'mimetype' as mimetype
      from storage.objects
      where bucket_id = $1
        and name = any($2::text[])
    `,
    [THUMBNAIL_BUCKET, paths],
  );

  return new Map(result.rows.map((row: StorageObjectRow) => [row.name, row]));
}

function needsRegeneration(job: JobRow, objectRow: StorageObjectRow | undefined): boolean {
  if (!job.result_thumbnail_object_path) return true;
  if (!objectRow) return true;
  return objectRow.mimetype !== THUMBNAIL_CONTENT_TYPE;
}

async function regenerateThumbnail(job: JobRow): Promise<void> {
  const thumbnailObjectPath = job.result_thumbnail_object_path ?? defaultThumbnailObjectPath(job.user_id, job.id);
  const thumbnailBytes = await buildJpegThumbnailBytesFromResult(job.result_object_path!);
  await uploadJpegThumbnail(thumbnailObjectPath, thumbnailBytes);
  await updateThumbnailPath(job.id, thumbnailObjectPath);
}

const options = parseArgs(Deno.args);
await db.connect();
try {
  const scanned = await fetchScanBatch(options.limit, options.afterId);
  const thumbnailPaths = scanned
    .map((row) => row.result_thumbnail_object_path)
    .filter((value): value is string => Boolean(value));
  const metadataByPath = await loadThumbnailMetadata(thumbnailPaths);

  let regeneratedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const targetJobs = scanned.filter((job) => {
    const objectRow = job.result_thumbnail_object_path
      ? metadataByPath.get(job.result_thumbnail_object_path)
      : undefined;
    return needsRegeneration(job, objectRow);
  });

  for (const job of targetJobs) {
    try {
      if (!options.dryRun) {
        await regenerateThumbnail(job);
      }
      regeneratedCount += 1;
    } catch (error) {
      failedCount += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[backfill-nail-result-thumbnails] job=${job.id} failed message=${message}`);
    }
  }

  skippedCount = scanned.length - targetJobs.length;
  const lastProcessedJobId = scanned.length > 0 ? scanned[scanned.length - 1].id : null;

  console.log(JSON.stringify({
    scanned_count: scanned.length,
    regenerated_count: regeneratedCount,
    skipped_count: skippedCount,
    failed_count: failedCount,
    last_processed_job_id: lastProcessedJobId,
    dry_run: options.dryRun,
  }, null, 2));
} finally {
  await db.end();
}
