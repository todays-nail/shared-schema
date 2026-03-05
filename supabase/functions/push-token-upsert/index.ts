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

type PushTokenUpsertBody = {
  device_id?: string;
  apns_token?: string;
  apns_env_hint?: "production" | "sandbox";
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
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

function parseDeviceId(value: string | undefined): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) throw new Error("device_id is required");
  if (normalized.length > 128) throw new Error("device_id too long");
  return normalized;
}

function parseAPNSToken(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized) throw new Error("apns_token is required");
  if (!/^[0-9a-f]{64,512}$/i.test(normalized)) {
    throw new Error("apns_token must be a hex string");
  }
  return normalized;
}

function parseAPNSEnvHint(value: string | undefined): "production" | "sandbox" {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "sandbox") return "sandbox";
  return "production";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return errorResponse(405, "Method not allowed");

  try {
    const userId = await requireUserId(req);
    const body = await readJson<PushTokenUpsertBody>(req);

    const deviceId = parseDeviceId(body.device_id);
    const apnsToken = parseAPNSToken(body.apns_token);
    const apnsEnvHint = parseAPNSEnvHint(body.apns_env_hint);
    const now = new Date().toISOString();

    const { error } = await supabaseAdmin
      .from("user_push_tokens")
      .upsert(
        {
          user_id: userId,
          device_id: deviceId,
          platform: "ios",
          apns_token: apnsToken,
          apns_env_hint: apnsEnvHint,
          is_active: true,
          last_registered_at: now,
          updated_at: now,
        },
        {
          onConflict: "user_id,device_id,platform",
          ignoreDuplicates: false,
        },
      );

    if (error) {
      return errorResponse(500, `push token upsert failed: ${error.message}`);
    }

    return jsonResponse(200, { ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (message.includes("required") || message.includes("hex string") || message.includes("too long")) {
      return errorResponse(400, message);
    }
    return errorResponse(401, message);
  }
});
