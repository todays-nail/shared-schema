import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  errorResponse,
  getBearerToken,
  jsonResponse,
} from "../_shared/http.ts";
import { verifyAccessJwt } from "../_shared/jwt.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { requireEnv } from "../_shared/env.ts";

const RESULT_BUCKET = "nail-results-private";
const INPUT_BUCKET = "nail-inputs-private";
const RESULT_URL_EXPIRES_SEC = 10 * 60;
const DISPLAY_IMAGE_MAX_SIDE = 1080;
const DISPLAY_IMAGE_QUALITY = 76;

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
}

function absolutizeSignedUrl(signedUrl: string): string {
  if (signedUrl.startsWith("http://") || signedUrl.startsWith("https://")) {
    return signedUrl;
  }

  const supabaseUrl = requireEnv("SUPABASE_URL").replace(/\/+$/, "");
  if (signedUrl.startsWith("/storage/v1/")) return `${supabaseUrl}${signedUrl}`;
  if (signedUrl.startsWith("/object/")) return `${supabaseUrl}/storage/v1${signedUrl}`;
  if (signedUrl.startsWith("/")) return `${supabaseUrl}${signedUrl}`;
  return `${supabaseUrl}/${signedUrl}`;
}

function parseTimestampMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function diffMs(startMs: number | null, endMs: number | null): number | null {
  if (startMs === null || endMs === null) return null;
  return Math.max(0, Math.round(endMs - startMs));
}

function parseIncludeInputs(raw: string | null): boolean {
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") return true;
  if (normalized === "0" || normalized === "false") return false;
  throw new Error("include_inputs must be boolean");
}

async function createSignedUrlOrNull(
  bucket: string,
  objectPath: string | null | undefined,
): Promise<string | null> {
  if (!objectPath) return null;

  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(objectPath, RESULT_URL_EXPIRES_SEC);

  if (error || !data?.signedUrl) {
    throw new Error(`createSignedUrl failed: ${error?.message ?? "unknown"}`);
  }

  return absolutizeSignedUrl(data.signedUrl);
}

async function createDisplaySignedUrlOrNull(
  bucket: string,
  objectPath: string | null | undefined,
): Promise<string | null> {
  if (!objectPath) return null;

  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(objectPath, RESULT_URL_EXPIRES_SEC, {
      transform: {
        width: DISPLAY_IMAGE_MAX_SIDE,
        height: DISPLAY_IMAGE_MAX_SIDE,
        resize: "contain",
      },
    });

  if (error || !data?.signedUrl) {
    throw new Error(`createSignedUrl failed: ${error?.message ?? "unknown"}`);
  }

  const baseUrl = absolutizeSignedUrl(data.signedUrl);
  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}format=jpeg&quality=${DISPLAY_IMAGE_QUALITY}`;
}

async function requireUserId(req: Request): Promise<string> {
  const token = getBearerToken(req);
  if (!token) throw new Error("missing bearer token");

  const payload = await verifyAccessJwt(token);
  const sub = payload["sub"];
  if (!sub || typeof sub !== "string" || !isUuid(sub)) {
    throw new Error("invalid token payload");
  }

  return sub.toLowerCase();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "GET") return errorResponse(405, "Method not allowed");

  try {
    const userId = await requireUserId(req);
    const url = new URL(req.url);
    const jobId = url.searchParams.get("job_id")?.trim().toLowerCase() ?? "";
    const includeInputs = parseIncludeInputs(url.searchParams.get("include_inputs"));
    if (!isUuid(jobId)) return errorResponse(400, "job_id must be uuid");

    const requestStartedAtMs = Date.now();

    const jobQueryStartedAtMs = Date.now();
    const { data: job, error } = await supabaseAdmin
      .from("nail_generation_jobs")
      .select("id, user_id, status, hand_object_path, reference_object_path, result_object_path, error_code, error_message, created_at, started_at, completed_at, parent_job_id, refinement_turn, shape, extension_mode")
      .eq("id", jobId)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .maybeSingle();
    const jobQueryElapsedMs = Date.now() - jobQueryStartedAtMs;

    if (error) return errorResponse(500, `job lookup failed: ${error.message}`);
    if (!job) return errorResponse(404, "job not found");

    const likeLookupPromise = (async () => {
      const startedAtMs = Date.now();
      const result = await supabaseAdmin
        .from("nail_generation_likes")
        .select("job_id")
        .eq("user_id", userId)
        .eq("job_id", jobId)
        .maybeSingle();
      return { ...result, elapsedMs: Date.now() - startedAtMs };
    })();

    const urlBuildPromise = (async () => {
      const startedAtMs = Date.now();
      const [
        resultImageUrl,
        handImageUrl,
        referenceImageUrl,
        resultDisplayImageUrl,
        handDisplayImageUrl,
        referenceDisplayImageUrl,
      ] = await Promise.all([
        job.status === "completed"
          ? createSignedUrlOrNull(RESULT_BUCKET, job.result_object_path)
          : Promise.resolve(null),
        includeInputs
          ? createSignedUrlOrNull(INPUT_BUCKET, job.hand_object_path)
          : Promise.resolve(null),
        includeInputs
          ? createSignedUrlOrNull(INPUT_BUCKET, job.reference_object_path)
          : Promise.resolve(null),
        job.status === "completed"
          ? createDisplaySignedUrlOrNull(RESULT_BUCKET, job.result_object_path)
          : Promise.resolve(null),
        includeInputs
          ? createDisplaySignedUrlOrNull(INPUT_BUCKET, job.hand_object_path)
          : Promise.resolve(null),
        includeInputs
          ? createDisplaySignedUrlOrNull(INPUT_BUCKET, job.reference_object_path)
          : Promise.resolve(null),
      ]);
      return {
        resultImageUrl,
        handImageUrl,
        referenceImageUrl,
        resultDisplayImageUrl,
        handDisplayImageUrl,
        referenceDisplayImageUrl,
        elapsedMs: Date.now() - startedAtMs,
      };
    })();

    const [
      { data: likeRow, error: likeError, elapsedMs: likeLookupElapsedMs },
      {
        resultImageUrl,
        handImageUrl,
        referenceImageUrl,
        resultDisplayImageUrl,
        handDisplayImageUrl,
        referenceDisplayImageUrl,
        elapsedMs: urlBuildElapsedMs,
      },
    ] = await Promise.all([
      likeLookupPromise,
      urlBuildPromise,
    ]);

    if (likeError) return errorResponse(500, `like lookup failed: ${likeError.message}`);

    const nowMs = Date.now();
    const createdAtMs = parseTimestampMs(job.created_at);
    const startedAtMs = parseTimestampMs(job.started_at);
    const completedAtMs = parseTimestampMs(job.completed_at);
    const queueEndMs = startedAtMs ?? nowMs;
    const processingEndMs = completedAtMs ?? nowMs;
    const totalEndMs = completedAtMs ?? nowMs;

    const response = jsonResponse(200, {
      status: job.status,
      result_image_url: resultImageUrl,
      hand_image_url: handImageUrl,
      reference_image_url: referenceImageUrl,
      result_display_image_url: resultDisplayImageUrl,
      hand_display_image_url: handDisplayImageUrl,
      reference_display_image_url: referenceDisplayImageUrl,
      shape: job.shape,
      extension_mode: job.extension_mode,
      error_code: job.error_code,
      error_message: job.error_message,
      parent_job_id: job.parent_job_id,
      refinement_turn: job.refinement_turn ?? 0,
      is_liked: !!likeRow,
      can_refine: false,
      queue_ms: diffMs(createdAtMs, queueEndMs),
      processing_ms: startedAtMs === null ? null : diffMs(startedAtMs, processingEndMs),
      total_ms: diffMs(createdAtMs, totalEndMs),
    });

    console.log(
      `[nail-gen-status] detail_status_db_query_ms=${jobQueryElapsedMs} detail_status_like_lookup_ms=${likeLookupElapsedMs} detail_status_url_build_ms=${urlBuildElapsedMs} detail_status_total_ms=${Date.now() - requestStartedAtMs} include_inputs=${includeInputs}`,
    );

    return response;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (message.includes("include_inputs")) return errorResponse(400, message);
    return errorResponse(401, message);
  }
});
