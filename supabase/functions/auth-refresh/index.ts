import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { errorResponse, jsonResponse, readJson } from "../_shared/http.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { generateRefreshToken, hashRefreshToken } from "../_shared/refresh.ts";
import { signAccessJwt } from "../_shared/jwt.ts";

type ReqBody = {
  refreshToken?: string;
  deviceId?: string;
};

const ACCESS_TOKEN_TTL_SEC = 15 * 60;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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
    const { data: row, error: rowError } = await supabaseAdmin
      .from("user_refresh_tokens")
      .select("id, user_id, expires_at, revoked_at")
      .eq("token_hash", tokenHash)
      .eq("device_id", deviceId)
      .maybeSingle();

    if (rowError) {
      return errorResponse(500, `refresh token lookup failed: ${rowError.message}`, "AUTH_REFRESH_LOOKUP_FAILED");
    }
    if (!row) return errorResponse(401, "invalid refresh token", "AUTH_INVALID_REFRESH_TOKEN");
    if (row.revoked_at) return errorResponse(401, "refresh token revoked", "AUTH_REFRESH_REVOKED");
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      return errorResponse(401, "refresh token expired", "AUTH_REFRESH_EXPIRED");
    }

    // NOTE: do not read `role` to avoid hard dependency on the column.
    const { data: user, error: userError } = await supabaseAdmin
      .from("users")
      .select("id, deleted_at")
      .eq("id", row.user_id)
      .single();
    if (userError) return errorResponse(500, `user lookup failed: ${userError.message}`, "AUTH_USER_LOOKUP_FAILED");
    if (user.deleted_at) {
      const now = new Date().toISOString();
      await supabaseAdmin
        .from("user_refresh_tokens")
        .update({ revoked_at: now })
        .eq("user_id", row.user_id)
        .is("revoked_at", null);
      return errorResponse(403, "account is deleted", "AUTH_ACCOUNT_DELETED");
    }

    // Rotation: revoke old, mint new.
    const now = Date.now();
    const accessTokenExpiresAt = new Date(now + ACCESS_TOKEN_TTL_SEC * 1000).toISOString();
    const refreshTokenExpiresAt = new Date(now + REFRESH_TOKEN_TTL_MS).toISOString();
    const newRefreshToken = generateRefreshToken();
    const newHash = await hashRefreshToken(newRefreshToken);

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("user_refresh_tokens")
      .insert({
        user_id: row.user_id,
        device_id: deviceId,
        token_hash: newHash,
        expires_at: refreshTokenExpiresAt,
      })
      .select("id")
      .single();
    if (insertError) {
      return errorResponse(500, `refresh token insert failed: ${insertError.message}`, "AUTH_REFRESH_INSERT_FAILED");
    }

    const { error: revokeError } = await supabaseAdmin
      .from("user_refresh_tokens")
      .update({ revoked_at: new Date().toISOString(), replaced_by: inserted.id })
      .eq("id", row.id);
    if (revokeError) return errorResponse(500, `refresh token revoke failed: ${revokeError.message}`, "AUTH_REFRESH_REVOKE_FAILED");

    // Enforce single active refresh token per user/device.
    const { error: revokeOthersError } = await supabaseAdmin
      .from("user_refresh_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("user_id", row.user_id)
      .eq("device_id", deviceId)
      .is("revoked_at", null)
      .neq("id", inserted.id);
    if (revokeOthersError) {
      return errorResponse(
        500,
        `refresh token revoke(others) failed: ${revokeOthersError.message}`,
        "AUTH_REFRESH_REVOKE_FAILED",
      );
    }

    const accessToken = await signAccessJwt({
      userId: user.id,
      role: "USER",
      expiresInSeconds: ACCESS_TOKEN_TTL_SEC,
    });

    return jsonResponse(200, {
      accessToken,
      refreshToken: newRefreshToken,
      access_token_expires_at: accessTokenExpiresAt,
      refresh_token_expires_at: refreshTokenExpiresAt,
      session_id: inserted.id,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return errorResponse(401, msg, "AUTH_REFRESH_FAILED");
  }
});
