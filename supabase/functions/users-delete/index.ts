import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  errorResponse,
  getBearerToken,
  jsonResponse,
  readJson,
} from "../_shared/http.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { verifyAccessJwt } from "../_shared/jwt.ts";

type DeleteBody = {
  reason?: string | null;
};

async function requireUserId(req: Request): Promise<string> {
  const token = getBearerToken(req);
  if (!token) throw new Error("missing bearer token");
  const payload = await verifyAccessJwt(token);
  const sub = payload["sub"];
  if (!sub || typeof sub !== "string") throw new Error("invalid token payload");
  return sub;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return errorResponse(405, "Method not allowed");

  try {
    const userId = await requireUserId(req);
    const body = await readJson<DeleteBody>(req);
    const now = new Date().toISOString();

    const normalizedReason = typeof body.reason === "string"
      ? body.reason.trim() || null
      : null;

    const { data: user, error: userError } = await supabaseAdmin
      .from("users")
      .select("id, deleted_at")
      .eq("id", userId)
      .maybeSingle();

    if (userError) return errorResponse(500, `users lookup failed: ${userError.message}`);
    if (!user) return errorResponse(404, "user not found");

    if (!user.deleted_at) {
      const { error: deleteError } = await supabaseAdmin
        .from("users")
        .update({
          deleted_at: now,
          deleted_reason: normalizedReason,
        })
        .eq("id", userId);
      if (deleteError) return errorResponse(500, `users delete failed: ${deleteError.message}`);
    }

    const { error: revokeError } = await supabaseAdmin
      .from("user_refresh_tokens")
      .update({ revoked_at: now })
      .eq("user_id", userId)
      .is("revoked_at", null);
    if (revokeError) return errorResponse(500, `refresh token revoke failed: ${revokeError.message}`);

    return jsonResponse(200, { ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return errorResponse(401, msg);
  }
});
