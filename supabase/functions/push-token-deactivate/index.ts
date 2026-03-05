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

type PushTokenDeactivateBody = {
  device_id?: string;
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return errorResponse(405, "Method not allowed");

  try {
    const userId = await requireUserId(req);
    const body = await readJson<PushTokenDeactivateBody>(req);
    const deviceId = parseDeviceId(body.device_id);

    const { error } = await supabaseAdmin
      .from("user_push_tokens")
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("device_id", deviceId)
      .eq("platform", "ios");

    if (error) {
      return errorResponse(500, `push token deactivate failed: ${error.message}`);
    }

    return jsonResponse(200, { ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (message.includes("required") || message.includes("too long")) {
      return errorResponse(400, message);
    }
    return errorResponse(401, message);
  }
});
