import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { errorResponse, jsonResponse, readJson } from "../_shared/http.ts";
import { getKakaoProfileFromAccessToken } from "../_shared/kakao.ts";
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
  kakaoAccessToken?: string;
  deviceId?: string;
};

type UserRow = {
  id: string;
  kakao_user_id: string | null;
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
    .select("id, kakao_user_id, nickname, phone, profile_image_url, default_region_id, created_at, updated_at, deleted_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`users lookup failed: ${error.message}`);
  }

  return (user as UserRow | null) ?? null;
}

async function loadUserRowByKakaoUserId(kakaoUserId: string): Promise<UserRow | null> {
  const { data: user, error } = await supabaseAdmin
    .from("users")
    .select("id, kakao_user_id, nickname, phone, profile_image_url, default_region_id, created_at, updated_at, deleted_at")
    .eq("kakao_user_id", kakaoUserId)
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
    const kakaoAccessToken = body.kakaoAccessToken?.trim() ?? "";
    const deviceId = body.deviceId?.trim() ?? "";
    if (!kakaoAccessToken) {
      return errorResponse(400, "kakaoAccessToken is required", "AUTH_KAKAO_TOKEN_REQUIRED");
    }
    if (!deviceId) return errorResponse(400, "deviceId is required", "AUTH_DEVICE_ID_REQUIRED");

    const kakaoProfile = await getKakaoProfileFromAccessToken(kakaoAccessToken);
    const kakaoUserId = kakaoProfile.id;

    const { data: identity, error: identityError } = await supabaseAdmin
      .from("user_identities")
      .select("user_id")
      .eq("provider", "kakao")
      .eq("provider_user_id", kakaoUserId)
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
    } else {
      userRow = await loadUserRowByKakaoUserId(kakaoUserId);
      if (!userRow) {
        const { data: insertedUser, error: insertUserError } = await supabaseAdmin
          .from("users")
          .insert({ kakao_user_id: kakaoUserId })
          .select("id, kakao_user_id, nickname, phone, profile_image_url, default_region_id, created_at, updated_at, deleted_at")
          .single();

        if (insertUserError) {
          return errorResponse(500, `users upsert failed: ${insertUserError.message}`, "AUTH_USER_UPSERT_FAILED");
        }

        userRow = insertedUser as UserRow;
      }
    }

    if (!userRow) {
      return errorResponse(500, "user not found", "AUTH_USER_LOOKUP_FAILED");
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
          provider: "kakao",
          provider_user_id: kakaoUserId,
          display_name: kakaoProfile.nickname,
          profile_image_url: kakaoProfile.profileImageURL,
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

    const currentKakaoUserId = userRow.kakao_user_id?.trim() ?? "";
    if (currentKakaoUserId !== kakaoUserId) {
      const { error: syncUserError } = await supabaseAdmin
        .from("users")
        .update({ kakao_user_id: kakaoUserId })
        .eq("id", userRow.id);
      if (syncUserError) {
        return errorResponse(500, `users update failed: ${syncUserError.message}`, "AUTH_USER_UPDATE_FAILED");
      }

      userRow = {
        ...userRow,
        kakao_user_id: kakaoUserId,
      };
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
        nickname: kakaoProfile.nickname,
        profile_image_url: kakaoProfile.profileImageURL,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return errorResponse(401, msg, "AUTH_KAKAO_VERIFY_FAILED");
  }
});
