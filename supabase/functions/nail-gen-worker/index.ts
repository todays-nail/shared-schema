import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { errorResponse, jsonResponse } from "../_shared/http.ts";
import { requireEnv } from "../_shared/env.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import {
  sendAIGenerationPushToTokens,
  type AIGenerationPushEventType,
  type APNSPushToken,
} from "../_shared/apns.ts";

const INPUT_BUCKET = "nail-inputs-private";
const RESULT_BUCKET = "nail-results-private";
const THUMBNAIL_BUCKET = "nail-results-thumb-public";
const OPENAI_IMAGES_EDITS_URL = "https://api.openai.com/v1/images/edits";
const WORKER_SECRET = requireEnv("NAIL_GEN_WORKER_SECRET");
const OPENAI_API_KEY = requireEnv("OPENAI_API_KEY");
const SUPABASE_URL = requireEnv("SUPABASE_URL").replace(/\/+$/, "");
const MAX_BATCH = 3;
const MAX_OPENAI_ATTEMPTS = 2;
const THUMBNAIL_SIGNED_URL_EXPIRES_SEC = 60;
const THUMBNAIL_MAX_SIDE = 384;
const THUMBNAIL_QUALITY = 78;
const SELF_TRIGGER_TIMEOUT_MS = 1500;
const IMAGE_MODEL: ImageModel = "gpt-image-1.5";
type ImageModel = "gpt-image-1.5";
type EdgeRuntimeLike = {
  waitUntil?: (promise: Promise<unknown>) => void;
};

class WorkerError extends Error {
  code: string;
  retriable: boolean;
  statusCode?: number;
  model?: ImageModel;

  constructor(code: string, message: string, retriable: boolean, statusCode?: number, model?: ImageModel) {
    super(message);
    this.name = "WorkerError";
    this.code = code;
    this.retriable = retriable;
    this.statusCode = statusCode;
    this.model = model;
  }
}

type JobRow = {
  id: string;
  user_id: string;
  shape: "almond" | "square" | "round";
  extension_mode: "NATURAL" | "EXTEND";
  hand_object_path: string;
  reference_object_path: string;
  attempt_count: number;
  model: ImageModel;
};

type OpenAICallResult = {
  bytes: Uint8Array;
  model: ImageModel;
  downloadMs: number;
  openaiMs: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runInBackground(task: Promise<void>): void {
  const runtime = (globalThis as typeof globalThis & { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime;
  if (runtime?.waitUntil) {
    runtime.waitUntil(
      task.catch((error) => {
        const message = error instanceof Error ? truncate(error.message, 200) : truncate(String(error), 200);
        console.warn(`[nail-gen-worker] background task failed message=${message}`);
      }),
    );
    return;
  }
  void task.catch((error) => {
    const message = error instanceof Error ? truncate(error.message, 200) : truncate(String(error), 200);
    console.warn(`[nail-gen-worker] background task failed message=${message}`);
  });
}

function truncate(s: string, limit = 500): string {
  if (s.length <= limit) return s;
  return `${s.slice(0, limit)}...(truncated)`;
}

function contentTypeFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "png":
    default:
      return "image/png";
  }
}

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function encodeBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function toDataUrl(bytes: Uint8Array, contentType: string): string {
  return `data:${contentType};base64,${encodeBase64(bytes)}`;
}

function absolutizeSignedUrl(signedUrl: string): string {
  if (signedUrl.startsWith("http://") || signedUrl.startsWith("https://")) {
    return signedUrl;
  }

  if (signedUrl.startsWith("/storage/v1/")) return `${SUPABASE_URL}${signedUrl}`;
  if (signedUrl.startsWith("/object/")) return `${SUPABASE_URL}/storage/v1${signedUrl}`;
  if (signedUrl.startsWith("/")) return `${SUPABASE_URL}${signedUrl}`;
  return `${SUPABASE_URL}/${signedUrl}`;
}

function normalizeError(e: unknown): { code: string; message: string } {
  if (e instanceof WorkerError) {
    return { code: e.code, message: truncate(e.message) };
  }
  if (e instanceof Error) {
    return { code: "INTERNAL_ERROR", message: truncate(e.message) };
  }
  return { code: "INTERNAL_ERROR", message: "Unknown error" };
}

type ExtensionMode = "NATURAL" | "EXTEND";

function buildPrompt(shape: JobRow["shape"], extensionMode: ExtensionMode): string {
  const shapeInstruction = (() => {
    switch (shape) {
      case "square":
        return "Shape enforcement (square): keep straight sidewalls and a flat free edge with crisp near-90-degree corners; avoid oval/almond taper.";
      case "round":
        return "Shape enforcement (round): keep gently curved sidewalls and a rounded free edge; avoid flat/boxy tips.";
      case "almond":
      default:
        return "Shape enforcement (almond): keep soft tapered sidewalls and a smooth rounded tip; avoid flat square tips.";
    }
  })();
  const extensionInstruction = extensionMode === "EXTEND"
    ? "Extension mode EXTEND: lengthen each visible nail within a realistic salon range, maintain anatomical proportion to each finger, and preserve natural perspective."
    : "Extension mode NATURAL: keep each visible nail length as-is from Image 1; do not extend free edges.";

  return [
    "You are a policy-constrained nail design edit engine using TWO input images.",
    "Image 1 = immutable base hand photo (source of truth for pose, finger identity, skin, lighting, shadow, jewelry, camera, background).",
    "Image 2 = style reference source.",
    "",
    "Core objective:",
    "Edit Image 1 nails only and keep all non-nail pixels from Image 1 unchanged.",
    "",
    "Finger identity mapping:",
    "- thumb -> thumb, index -> index, middle -> middle, ring -> ring, pinky -> pinky.",
    "- Never swap design patterns across different fingers.",
    "- Preserve each target finger identity even when reference ambiguity exists.",
    "- If a reference finger is occluded/ambiguous, infer style from adjacent reference fingers only, while keeping target finger identity unchanged.",
    "",
    "Nail-only transfer:",
    "- Detect and edit visible nail regions only.",
    "- Transfer color palette, motif layout, pattern geometry, texture cues, and finish cues from Image 2.",
    "- Keep natural per-finger variation and symmetry for the same hand.",
    "- Never alter skin, finger silhouette, cuticle placement, jewelry, camera, lighting, background, or scene composition.",
    "",
    "Fallback when Image 2 has no valid nail regions:",
    "- If Image 2 does not contain valid nail regions, do not fail.",
    "- Extract Image 2's visual traits (dominant colors, pattern rhythm, texture feel, iconic motifs).",
    "- Reinterpret those traits into a cute nail-art style: soft/pastel leaning palette, rounded motifs, playful but clean composition.",
    "- Keep the result wearable and constrained to nail regions only.",
    "",
    "Extension policy:",
    `- ${extensionInstruction}`,
    `- Target nail shape: ${shape}.`,
    `- ${shapeInstruction}`,
    "",
    "Strict prohibitions:",
    "- Do not add extra fingers, extra nails, text, logo, watermark, or unrelated objects.",
    "- Do not apply global recoloring, global filters, or background style transfer.",
    "- Never copy non-nail objects from Image 2.",
    "- Never modify non-nail regions of Image 1.",
    "",
    "Constraint precedence (apply in order):",
    "1) Keep non-nail areas unchanged.",
    "2) Preserve finger identity mapping and hand realism from Image 1.",
    "3) Apply extension policy and target nail shape constraints.",
    "4) Transfer style from Image 2 nails, or apply non-nail fallback reinterpretation when nails are absent in Image 2.",
  ].join("\n");
}

function jobLog(jobId: string, message: string): void {
  console.log(`[TODAYSNAIL][${jobId}][WORKER] ${message}`);
}

function clampMs(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

async function downloadObject(path: string): Promise<Uint8Array> {
  const { data, error } = await supabaseAdmin.storage.from(INPUT_BUCKET).download(path);
  if (error || !data) {
    throw new WorkerError("INPUT_DOWNLOAD_FAILED", `download failed: ${error?.message ?? "not found"}`, false);
  }
  return new Uint8Array(await data.arrayBuffer());
}

async function callOpenAI(job: JobRow, model: ImageModel): Promise<OpenAICallResult> {
  const downloadStartedAt = performance.now();
  const [handBytes, referenceBytes] = await Promise.all([
    downloadObject(job.hand_object_path),
    downloadObject(job.reference_object_path),
  ]);
  const downloadMs = performance.now() - downloadStartedAt;

  const openaiStartedAt = performance.now();
  const payload = {
    model,
    prompt: buildPrompt(job.shape, job.extension_mode),
    images: [
      {
        image_url: toDataUrl(handBytes, contentTypeFromPath(job.hand_object_path)),
      },
      {
        image_url: toDataUrl(referenceBytes, contentTypeFromPath(job.reference_object_path)),
      },
    ],
    input_fidelity: "high",
    size: "auto",
    quality: "high",
    output_format: "png",
  };

  let response: Response;
  try {
    response = await fetch(OPENAI_IMAGES_EDITS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "network error";
    throw new WorkerError("OPENAI_NETWORK", message, true);
  }

  if (!response.ok) {
    const raw = truncate(await response.text());
    const retriable = response.status === 429 || response.status >= 500;
    const code = response.status === 429
      ? "OPENAI_RATE_LIMIT"
      : response.status >= 500
      ? "OPENAI_SERVER"
      : "OPENAI_HTTP_ERROR";
    throw new WorkerError(code, `openai status=${response.status} body=${raw}`, retriable, response.status, model);
  }

  const json = await response.json() as {
    data?: Array<{
      result?: string;
      b64_json?: string;
      url?: string;
    }>;
  };
  const imageOutput = json.data?.[0];
  const b64 = imageOutput?.result ?? imageOutput?.b64_json;
  if (!b64) {
    if (imageOutput?.url) {
      let downloadResponse: Response;
      try {
        downloadResponse = await fetch(imageOutput.url);
      } catch (e) {
        const message = e instanceof Error ? e.message : "image download error";
        throw new WorkerError("OPENAI_BAD_RESPONSE", `image_url download failed: ${message}`, true, undefined, model);
      }
      if (!downloadResponse.ok) {
        throw new WorkerError(
          "OPENAI_BAD_RESPONSE",
          `image_url download failed status=${downloadResponse.status}`,
          true,
          downloadResponse.status,
          model,
        );
      }
      const openaiMs = performance.now() - openaiStartedAt;
      return {
        bytes: new Uint8Array(await downloadResponse.arrayBuffer()),
        model,
        downloadMs,
        openaiMs,
      };
    }

    throw new WorkerError(
      "OPENAI_BAD_RESPONSE",
      "missing image data in images/edits response",
      false,
    );
  }

  const openaiMs = performance.now() - openaiStartedAt;
  return {
    bytes: decodeBase64(b64),
    model,
    downloadMs,
    openaiMs,
  };
}

async function callOpenAIWithRetry(job: JobRow): Promise<OpenAICallResult> {
  let lastError: unknown = null;
  let lastTriedModel: ImageModel | undefined;

  for (let attempt = 1; attempt <= MAX_OPENAI_ATTEMPTS; attempt++) {
    lastTriedModel = IMAGE_MODEL;
    try {
      return await callOpenAI(job, IMAGE_MODEL);
    } catch (e) {
      lastError = e;
      if (!(e instanceof WorkerError)) {
        throw e;
      }

      if (e.retriable && attempt < MAX_OPENAI_ATTEMPTS) {
        const backoffMs = 800 * attempt;
        jobLog(
          job.id,
          `openai_retry image_api=edits image_model=${IMAGE_MODEL} attempt=${attempt} backoff_ms=${backoffMs}`,
        );
        await sleep(backoffMs);
        continue;
      }

      throw e;
    }
  }

  if (lastError) {
    if (lastError instanceof WorkerError && lastTriedModel && !lastError.model) {
      lastError.model = lastTriedModel;
    }
    throw lastError;
  }
  throw new WorkerError("OPENAI_UNKNOWN", "unexpected retry termination", false);
}

async function triggerWorkerDrainPass(jobIdForLog: string): Promise<void> {
  if (!SUPABASE_URL || !WORKER_SECRET) {
    jobLog(jobIdForLog, "drain_trigger_skipped reason=missing_env");
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SELF_TRIGGER_TIMEOUT_MS);
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/nail-gen-worker`, {
      method: "POST",
      headers: {
        "x-worker-secret": WORKER_SECRET,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      const raw = truncate(await response.text(), 180);
      jobLog(jobIdForLog, `drain_trigger_failed status=${response.status} body=${raw}`);
      return;
    }
    jobLog(jobIdForLog, "drain_triggered reason=batch_full");
  } catch (e) {
    const message = e instanceof Error ? truncate(e.message, 180) : "unknown";
    jobLog(jobIdForLog, `drain_trigger_error message=${message}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function buildThumbnailFromResult(
  resultObjectPath: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const { data: signed, error: signedError } = await supabaseAdmin.storage
    .from(RESULT_BUCKET)
    .createSignedUrl(resultObjectPath, THUMBNAIL_SIGNED_URL_EXPIRES_SEC, {
      transform: {
        width: THUMBNAIL_MAX_SIDE,
        height: THUMBNAIL_MAX_SIDE,
        resize: "cover",
      },
    });

  if (signedError || !signed?.signedUrl) {
    throw new WorkerError(
      "THUMBNAIL_SIGNED_URL_FAILED",
      `createSignedUrl failed: ${signedError?.message ?? "unknown"}`,
      true,
    );
  }

  const baseURL = absolutizeSignedUrl(signed.signedUrl);
  const separator = baseURL.includes("?") ? "&" : "?";
  const thumbnailURL = `${baseURL}${separator}format=jpeg&quality=${THUMBNAIL_QUALITY}`;

  let response: Response;
  try {
    response = await fetch(thumbnailURL);
  } catch (e) {
    const message = e instanceof Error ? e.message : "thumbnail fetch failed";
    throw new WorkerError("THUMBNAIL_FETCH_FAILED", message, true);
  }

  if (!response.ok) {
    throw new WorkerError(
      "THUMBNAIL_FETCH_FAILED",
      `thumbnail fetch status=${response.status}`,
      true,
      response.status,
    );
  }

  const contentType = response.headers.get("content-type")
    ?.split(";")[0]
    ?.trim()
    ?.toLowerCase() || "image/jpeg";

  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType,
  };
}

async function claimJob(job: JobRow): Promise<JobRow | null> {
  const { data, error } = await supabaseAdmin
    .from("nail_generation_jobs")
    .update({
      status: "processing",
      started_at: new Date().toISOString(),
      attempt_count: job.attempt_count + 1,
      error_code: null,
      error_message: null,
    })
    .eq("id", job.id)
    .eq("status", "queued")
    .eq("attempt_count", job.attempt_count)
    .select("id, user_id, shape, extension_mode, hand_object_path, reference_object_path, attempt_count, model")
    .maybeSingle();

  if (error) {
    throw new WorkerError("JOB_CLAIM_FAILED", error.message, false);
  }

  return (data as JobRow | null) ?? null;
}

async function completeJob(
  job: JobRow,
  resultObjectPath: string,
  resultThumbnailObjectPath: string | null,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("nail_generation_jobs")
    .update({
      status: "completed",
      result_object_path: resultObjectPath,
      result_thumbnail_object_path: resultThumbnailObjectPath,
      model: job.model,
      completed_at: new Date().toISOString(),
      error_code: null,
      error_message: null,
    })
    .eq("id", job.id);

  if (error) {
    throw new WorkerError("JOB_COMPLETE_UPDATE_FAILED", error.message, false);
  }
}

async function updateJobThumbnailPath(jobId: string, thumbnailObjectPath: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("nail_generation_jobs")
    .update({
      result_thumbnail_object_path: thumbnailObjectPath,
    })
    .eq("id", jobId)
    .eq("status", "completed");

  if (error) {
    throw new WorkerError("THUMBNAIL_UPDATE_FAILED", error.message, true);
  }
}

async function failJob(jobId: string, code: string, message: string, model?: ImageModel): Promise<void> {
  await supabaseAdmin
    .from("nail_generation_jobs")
    .update({
      status: "failed",
      ...(model ? { model } : {}),
      error_code: code,
      error_message: truncate(message),
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

async function fetchActivePushTokens(userId: string): Promise<APNSPushToken[]> {
  const { data, error } = await supabaseAdmin
    .from("user_push_tokens")
    .select("id, apns_token, apns_env_hint")
    .eq("user_id", userId)
    .eq("platform", "ios")
    .eq("is_active", true);

  if (error) {
    throw new Error(`push token lookup failed: ${error.message}`);
  }

  return (data ?? []) as APNSPushToken[];
}

async function deactivateInvalidPushTokens(tokenIds: string[]): Promise<void> {
  if (tokenIds.length === 0) return;

  const { error } = await supabaseAdmin
    .from("user_push_tokens")
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .in("id", tokenIds);

  if (error) {
    throw new Error(`push token deactivate failed: ${error.message}`);
  }
}

async function sendAIGenerationPush(job: JobRow, eventType: AIGenerationPushEventType): Promise<void> {
  try {
    const tokens = await fetchActivePushTokens(job.user_id);
    if (tokens.length === 0) {
      return;
    }

    const result = await sendAIGenerationPushToTokens({
      tokens,
      eventType,
      jobId: job.id,
    });

    if (result.invalidTokenIds.length > 0) {
      await deactivateInvalidPushTokens(result.invalidTokenIds);
    }

    const skipped = result.skippedReason ? ` skipped_reason=${result.skippedReason}` : "";
    jobLog(
      job.id,
      `push_dispatch event=${eventType} attempted=${result.attempted} sent=${result.sent} failed=${result.failed} invalidated=${result.invalidTokenIds.length}${skipped}`,
    );
  } catch (e) {
    const message = e instanceof Error ? truncate(e.message, 200) : "unknown";
    jobLog(job.id, `push_dispatch_failed event=${eventType} message=${message}`);
  }
}

async function generateAndAttachThumbnail(
  job: JobRow,
  resultObjectPath: string,
  thumbnailObjectPath: string,
): Promise<void> {
  const thumbnailStartedAt = performance.now();
  try {
    const thumbnail = await buildThumbnailFromResult(resultObjectPath);
    const { error: thumbnailUploadError } = await supabaseAdmin.storage
      .from(THUMBNAIL_BUCKET)
      .upload(thumbnailObjectPath, thumbnail.bytes, {
        contentType: thumbnail.contentType || "image/jpeg",
        upsert: true,
      });
    if (thumbnailUploadError) {
      throw new WorkerError("THUMBNAIL_UPLOAD_FAILED", thumbnailUploadError.message, true);
    }

    await updateJobThumbnailPath(job.id, thumbnailObjectPath);
    const thumbnailMs = performance.now() - thumbnailStartedAt;
    jobLog(job.id, `thumbnail_ready thumbnail_ms=${clampMs(thumbnailMs)}`);
  } catch (e) {
    const message = e instanceof Error ? truncate(e.message, 180) : "thumbnail unknown error";
    jobLog(job.id, `thumbnail_skipped reason=${message}`);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return errorResponse(405, "Method not allowed");

  const workerSecret = req.headers.get("x-worker-secret") ?? "";
  if (workerSecret !== WORKER_SECRET) {
    return errorResponse(401, "unauthorized worker call");
  }

  const { data: queuedJobs, error: queueError } = await supabaseAdmin
    .from("nail_generation_jobs")
    .select("id, user_id, shape, extension_mode, hand_object_path, reference_object_path, attempt_count, model")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(MAX_BATCH);

  if (queueError) {
    return errorResponse(500, `queued jobs lookup failed: ${queueError.message}`);
  }

  let claimedCount = 0;
  let completedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (const rawJob of queuedJobs ?? []) {
    const job = rawJob as JobRow;
    let claimed: JobRow | null = null;
    try {
      claimed = await claimJob(job);
      if (!claimed) {
        skippedCount += 1;
        continue;
      }

      claimedCount += 1;
      const jobStartedAt = performance.now();
      const openaiResult = await callOpenAIWithRetry(claimed);
      const resultObjectPath = `${claimed.user_id}/${claimed.id}/result.png`;
      const thumbnailObjectPath = `${claimed.user_id}/${claimed.id}/thumb.jpg`;
      claimed.model = openaiResult.model;

      const uploadStartedAt = performance.now();
      const { error: uploadError } = await supabaseAdmin.storage
        .from(RESULT_BUCKET)
        .upload(resultObjectPath, openaiResult.bytes, {
          contentType: "image/png",
          upsert: true,
        });

      if (uploadError) {
        throw new WorkerError("RESULT_UPLOAD_FAILED", uploadError.message, false);
      }
      const uploadMs = performance.now() - uploadStartedAt;

      await completeJob(claimed, resultObjectPath, null);
      await sendAIGenerationPush(claimed, "ai_generation_completed");
      runInBackground(generateAndAttachThumbnail(claimed, resultObjectPath, thumbnailObjectPath));
      const totalMs = performance.now() - jobStartedAt;
      jobLog(
        claimed.id,
        `image_api=edits image_model=${openaiResult.model} download_ms=${clampMs(openaiResult.downloadMs)} openai_ms=${clampMs(openaiResult.openaiMs)} upload_ms=${clampMs(uploadMs)} total_ms=${clampMs(totalMs)} thumbnail_status=background`,
      );
      completedCount += 1;
    } catch (e) {
      const normalized = normalizeError(e);
      const jobId = claimed?.id ?? job.id;
      const failedModel = e instanceof WorkerError ? e.model : undefined;
      await failJob(jobId, normalized.code, normalized.message, failedModel);
      if (claimed) {
        await sendAIGenerationPush(claimed, "ai_generation_failed");
      }
      jobLog(jobId, `failed code=${normalized.code} message=${truncate(normalized.message, 200)}`);
      failedCount += 1;
    }
  }

  if (claimedCount === MAX_BATCH) {
    // Queue may still be non-empty. Trigger one additional pass to reduce tail latency.
    const queuedJobRows = (queuedJobs ?? []) as JobRow[];
    const logJobId = queuedJobRows.length > 0
      ? queuedJobRows[queuedJobRows.length - 1].id
      : "queue";
    runInBackground(triggerWorkerDrainPass(logJobId));
  }

  return jsonResponse(200, {
    claimed: claimedCount,
    completed: completedCount,
    failed: failedCount,
    skipped: skippedCount,
  });
});
