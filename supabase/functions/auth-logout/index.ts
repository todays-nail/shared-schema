import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { errorResponse, jsonResponse, readJson } from "../_shared/http.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { hashRefreshToken } from "../_shared/refresh.ts";

type ReqBody = {
  refreshToken?: string;
  deviceId?: string;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse(405, "Method not allowed", "AUTH_METHOD_NOT_ALLOWED");
  }

  try {
    const body = await readJson<ReqBody>(req);
    const refreshToken = body.refreshToken?.trim() ?? "";
    const deviceId = body.deviceId?.trim() ?? "";
    if (!refreshToken) {
      return errorResponse(400, "refreshToken is required", "AUTH_REFRESH_TOKEN_REQUIRED");
    }
    if (!deviceId) return errorResponse(400, "deviceId is required", "AUTH_DEVICE_ID_REQUIRED");

    const tokenHash = await hashRefreshToken(refreshToken);
    const { error } = await supabaseAdmin
      .from("user_refresh_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("token_hash", tokenHash)
      .eq("device_id", deviceId)
      .is("revoked_at", null);

    if (error) return errorResponse(500, `logout failed: ${error.message}`, "AUTH_LOGOUT_FAILED");
    return jsonResponse(200, { ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return errorResponse(400, msg, "AUTH_LOGOUT_BAD_REQUEST");
  }
});
