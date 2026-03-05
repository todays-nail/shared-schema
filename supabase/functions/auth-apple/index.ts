import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { errorResponse, jsonResponse, readJson } from "../_shared/http.ts";
import { AppleConfigError, verifyAppleIdToken } from "../_shared/apple.ts";
import { computeNeedsOnboarding } from "../_shared/onboarding.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { signAccessJwt } from "../_shared/jwt.ts";
import { generateRefreshToken, hashRefreshToken } from "../_shared/refresh.ts";
import {
  buildRegionLabel,
  buildRegionLookup,
  fetchAllRegions,
  resolveServiceScopeId,
  type RegionRow,
} from "../_shared/regions.ts";

type ReqBody = {
  idToken?: string;
  deviceId?: string;
};

type UserRow = {
  id: string;
  nickname: string | null;
  phone: string | null;
  profile_image_url: string | null;
  default_region_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

const ACCESS_TOKEN_TTL_SEC = 15 * 60;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function resolveRegionMetadata(
  defaultRegionId: string | null,
  regionLookup: Map<string, RegionRow>,
): { default_region_label: string | null; default_service_region_id: string | null } {
  if (!defaultRegionId) {
    return {
      default_region_label: null,
      default_service_region_id: null,
    };
  }

  const normalized = defaultRegionId.toLowerCase();
  const row = regionLookup.get(normalized);
  if (!row) {
    return {
      default_region_label: null,
      default_service_region_id: null,
    };
  }

  return {
    default_region_label: buildRegionLabel(normalized, regionLookup),
    default_service_region_id: resolveServiceScopeId(row),
  };
}

async function toSafeUser(user: UserRow): Promise<Record<string, unknown>> {
  let regionLookup = new Map<string, RegionRow>();
  try {
    const regions = await fetchAllRegions();
    regionLookup = buildRegionLookup(regions);
  } catch {
    // region sync 이전 초기 환경에서는 라벨 계산 실패를 무시한다.
  }

  const metadata = resolveRegionMetadata(user.default_region_id, regionLookup);

  return {
    id: user.id,
    nickname: user.nickname,
    phone: user.phone,
    profile_image_url: user.profile_image_url,
    default_region_id: user.default_region_id,
    default_region_label: metadata.default_region_label,
    default_service_region_id: metadata.default_service_region_id,
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}

async function loadUserRowById(userId: string): Promise<UserRow | null> {
  const { data: user, error } = await supabaseAdmin
    .from("users")
    .select("id, nickname, phone, profile_image_url, default_region_id, created_at, updated_at, deleted_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`users lookup failed: ${error.message}`);
  }

  return (user as UserRow | null) ?? null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse(405, "Method not allowed", "AUTH_METHOD_NOT_ALLOWED");
  }

  try {
    const body = await readJson<ReqBody>(req);
    const idToken = body.idToken?.trim() ?? "";
    const deviceId = body.deviceId?.trim() ?? "";

    if (!idToken) {
      return errorResponse(400, "idToken is required", "AUTH_APPLE_TOKEN_REQUIRED");
    }
    if (!deviceId) {
      return errorResponse(400, "deviceId is required", "AUTH_DEVICE_ID_REQUIRED");
    }

    const appleProfile = await verifyAppleIdToken(idToken);

    const { data: identity, error: identityError } = await supabaseAdmin
      .from("user_identities")
      .select("user_id")
      .eq("provider", "apple")
      .eq("provider_user_id", appleProfile.sub)
      .maybeSingle();

    if (identityError) {
      return errorResponse(
        500,
        `user identity lookup failed: ${identityError.message}`,
        "AUTH_IDENTITY_LOOKUP_FAILED",
      );
    }

    let userRow: UserRow | null = null;
    if (identity?.user_id) {
      userRow = await loadUserRowById(identity.user_id);
    }

    if (!userRow) {
      const { data: insertedUser, error: insertUserError } = await supabaseAdmin
        .from("users")
        .insert({})
        .select("id, nickname, phone, profile_image_url, default_region_id, created_at, updated_at, deleted_at")
        .single();

      if (insertUserError) {
        return errorResponse(500, `users insert failed: ${insertUserError.message}`, "AUTH_USER_INSERT_FAILED");
      }

      userRow = insertedUser as UserRow;
    }

    if (userRow.deleted_at) {
      return errorResponse(403, "account is deleted", "AUTH_ACCOUNT_DELETED");
    }

    const nowIso = new Date().toISOString();
    const { error: identityUpsertError } = await supabaseAdmin
      .from("user_identities")
      .upsert(
        {
          user_id: userRow.id,
          provider: "apple",
          provider_user_id: appleProfile.sub,
          email: appleProfile.email,
          email_verified: appleProfile.emailVerified,
          display_name: appleProfile.name,
          profile_image_url: appleProfile.picture,
          last_login_at: nowIso,
          updated_at: nowIso,
        },
        { onConflict: "provider,provider_user_id" },
      );

    if (identityUpsertError) {
      return errorResponse(
        500,
        `user identity upsert failed: ${identityUpsertError.message}`,
        "AUTH_IDENTITY_UPSERT_FAILED",
      );
    }

    const now = Date.now();
    const accessTokenExpiresAt = new Date(now + ACCESS_TOKEN_TTL_SEC * 1000).toISOString();
    const refreshTokenExpiresAt = new Date(now + REFRESH_TOKEN_TTL_MS).toISOString();

    const accessToken = await signAccessJwt({
      userId: userRow.id,
      role: "USER",
      expiresInSeconds: ACCESS_TOKEN_TTL_SEC,
    });

    const refreshToken = generateRefreshToken();
    const tokenHash = await hashRefreshToken(refreshToken);

    // Device policy: keep a single active refresh token per user/device.
    const { error: revokeError } = await supabaseAdmin
      .from("user_refresh_tokens")
      .update({ revoked_at: new Date(now).toISOString() })
      .eq("user_id", userRow.id)
      .eq("device_id", deviceId)
      .is("revoked_at", null);
    if (revokeError) {
      return errorResponse(500, `refresh token revoke failed: ${revokeError.message}`, "AUTH_REFRESH_REVOKE_FAILED");
    }

    const { data: insertedToken, error: rtError } = await supabaseAdmin
      .from("user_refresh_tokens")
      .insert({
        user_id: userRow.id,
        device_id: deviceId,
        token_hash: tokenHash,
        expires_at: refreshTokenExpiresAt,
      })
      .select("id")
      .single();
    if (rtError) {
      return errorResponse(500, `refresh token insert failed: ${rtError.message}`, "AUTH_REFRESH_INSERT_FAILED");
    }

    const safeUser = await toSafeUser(userRow);
    const needsOnboarding = computeNeedsOnboarding(userRow);

    return jsonResponse(200, {
      accessToken,
      refreshToken,
      access_token_expires_at: accessTokenExpiresAt,
      refresh_token_expires_at: refreshTokenExpiresAt,
      session_id: insertedToken.id,
      user: safeUser,
      needsOnboarding,
      onboarding_prefill: {
        nickname: appleProfile.name,
        profile_image_url: appleProfile.picture,
      },
    });
  } catch (error) {
    if (error instanceof AppleConfigError) {
      return errorResponse(500, error.message, "AUTH_APPLE_CONFIG_MISSING");
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResponse(401, message, "AUTH_APPLE_VERIFY_FAILED");
  }
});
