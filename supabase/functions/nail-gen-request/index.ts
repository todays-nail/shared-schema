import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  errorResponse,
  getBearerToken,
  jsonResponse,
  readJson,
} from "../_shared/http.ts";
import { verifyAccessJwt } from "../_shared/jwt.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";

type NailShape = "almond" | "square" | "round";
type ExtensionMode = "NATURAL" | "EXTEND";
const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
const WORKER_SECRET = Deno.env.get("NAIL_GEN_WORKER_SECRET") ?? "";
const WORKER_TRIGGER_TIMEOUT_MS = 1500;
const ALLOWED_EXTENSION_MODES: ReadonlySet<ExtensionMode> = new Set([
  "NATURAL",
  "EXTEND",
]);

// path format: {user_id}/{job_id}/hand.{ext} or reference_1.{ext}
const INPUT_PATH_REGEX = /^([0-9a-f-]{36})\/([0-9a-f-]{36})\/(hand|reference_1)\.(jpg|jpeg|png|webp)$/i;

type ReqBody = {
  shape?: NailShape;
  extension_mode?: string;
  hand_object_path?: string;
  reference_object_path?: string;
};

type EdgeRuntimeLike = {
  waitUntil?: (promise: Promise<unknown>) => void;
};

function normalizeExtensionMode(value: string | undefined): ExtensionMode | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  if (ALLOWED_EXTENSION_MODES.has(normalized as ExtensionMode)) {
    return normalized as ExtensionMode;
  }
  return null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
}

function parseInputPath(path: string): {
  userId: string;
  jobId: string;
  kind: "hand" | "reference_1";
} | null {
  const normalized = path.trim();
  const m = normalized.match(INPUT_PATH_REGEX);
  if (!m) return null;
  return {
    userId: m[1].toLowerCase(),
    jobId: m[2].toLowerCase(),
    kind: m[3].toLowerCase() as "hand" | "reference_1",
  };
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

async function ensureObjectExists(bucket: string, objectPath: string): Promise<boolean> {
  // Avoid downloading full image bytes during request validation.
  // A short-lived signed URL generation is enough to verify object existence.
  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(objectPath, 60);
  if (error || !data?.signedUrl) return false;
  return true;
}

async function triggerWorkerNow(jobId: string): Promise<void> {
  if (!SUPABASE_URL || !WORKER_SECRET) {
    console.warn(`[nail-gen-request] skip immediate worker trigger: missing env (job_id=${jobId})`);
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WORKER_TRIGGER_TIMEOUT_MS);

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/nail-gen-worker`, {
      method: "POST",
      headers: {
        "x-worker-secret": WORKER_SECRET,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const raw = await response.text();
      console.warn(
        `[nail-gen-request] immediate worker trigger failed status=${response.status} job_id=${jobId} body=${raw.slice(0, 300)}`,
      );
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    console.warn(`[nail-gen-request] immediate worker trigger error job_id=${jobId} message=${message}`);
  } finally {
    clearTimeout(timeout);
  }
}

function runInBackground(task: Promise<void>): void {
  const runtime = (globalThis as typeof globalThis & { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime;
  if (runtime?.waitUntil) {
    runtime.waitUntil(
      task.catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[nail-gen-request] background task failed message=${message}`);
      }),
    );
    return;
  }
  void task.catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[nail-gen-request] background task failed message=${message}`);
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return errorResponse(405, "Method not allowed");

  try {
    const userId = await requireUserId(req);
    const body = await readJson<ReqBody>(req);

    const shape = body.shape;
    const extensionMode = normalizeExtensionMode(body.extension_mode);
    const handObjectPath = body.hand_object_path?.trim() ?? "";
    const referenceObjectPath = body.reference_object_path?.trim() ?? "";

    if (shape !== "almond" && shape !== "square" && shape !== "round") {
      return errorResponse(400, "shape must be one of: almond, square, round");
    }
    if (!extensionMode) {
      return errorResponse(
        400,
        "extension_mode must be NATURAL or EXTEND",
        "INVALID_EXTENSION_MODE",
      );
    }

    const handPath = parseInputPath(handObjectPath);
    const referencePath = parseInputPath(referenceObjectPath);
    if (!handPath || handPath.kind !== "hand") {
      return errorResponse(400, "invalid hand_object_path");
    }
    if (!referencePath || referencePath.kind !== "reference_1") {
      return errorResponse(400, "invalid reference_object_path");
    }

    if (handPath.userId !== userId || referencePath.userId !== userId) {
      return errorResponse(400, "object_path user prefix mismatch");
    }
    if (handPath.jobId !== referencePath.jobId) {
      return errorResponse(400, "hand/reference job_id mismatch");
    }

    const jobId = handPath.jobId;
    if (!isUuid(jobId)) {
      return errorResponse(400, "invalid job id");
    }

    const [handExists, referenceExists] = await Promise.all([
      ensureObjectExists("nail-inputs-private", handObjectPath),
      ensureObjectExists("nail-inputs-private", referenceObjectPath),
    ]);

    if (!handExists || !referenceExists) {
      return errorResponse(400, "input image object not found");
    }

    const { data, error } = await supabaseAdmin
      .from("nail_generation_jobs")
      .insert({
        id: jobId,
        user_id: userId,
        status: "queued",
        shape,
        extension_mode: extensionMode,
        user_prompt: "",
        hand_object_path: handObjectPath,
        reference_object_path: referenceObjectPath,
        model: "gpt-image-1.5",
        provider: "openai",
      })
      .select("id, status")
      .single();

    if (error) {
      if (error.code === "23505") {
        return errorResponse(409, "job already exists");
      }
      return errorResponse(500, `job insert failed: ${error.message}`);
    }

    // Fast-path: trigger worker once immediately so users don't wait for the next scheduler tick.
    // Run in background to avoid delaying response latency.
    // Scheduler still runs as the fallback.
    runInBackground(triggerWorkerNow(data.id));

    return jsonResponse(200, {
      job_id: data.id,
      status: data.status,
      poll_after_ms: 2000,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return errorResponse(401, message);
  }
});
