import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { sha256Hex } from "../_shared/crypto.ts";
import { errorResponse, jsonResponse, readJson } from "../_shared/http.ts";
import { signAccessJwt } from "../_shared/jwt.ts";
import { computeNeedsOnboarding } from "../_shared/onboarding.ts";
import { generateRefreshToken, hashRefreshToken } from "../_shared/refresh.ts";
import {
  buildRegionLabel,
  buildRegionLookup,
  fetchAllRegions,
  type RegionRow,
  resolveServiceScopeId,
} from "../_shared/regions.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";

type ReqBody = {
  accountKey?: string;
  deviceId?: string;
  devSecret?: string;
  nickname?: string;
  profileImageURL?: string | null;
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

type IdentityRow = {
  user_id: string;
};

const ACCESS_TOKEN_TTL_SEC = 15 * 60;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const USER_SELECT =
  "id, nickname, phone, profile_image_url, default_region_id, created_at, updated_at, deleted_at";

function isDevAuthEnabled(): boolean {
  return (Deno.env.get("DEV_AUTH_ENABLED") ?? "").trim().toLowerCase() ===
    "true";
}

function normalizeAccountKey(raw: string | undefined): string {
  const normalized = (raw ?? "default").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._@-]{0,79}$/.test(normalized)) {
    throw new Error(
      "accountKey must be 1-80 lowercase letters, numbers, dot, underscore, at sign, or dash",
    );
  }
  return normalized;
}

function allowedAccountKeys(): Set<string> {
  const raw = Deno.env.get("DEV_AUTH_ALLOWED_ACCOUNTS") ?? "";
  const keys = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);

  return new Set(keys.length > 0 ? keys : ["default"]);
}

function normalizeNickname(
  raw: string | undefined,
  accountKey: string,
): string {
  const configured = Deno.env.get("DEV_AUTH_DEFAULT_NICKNAME")?.trim();
  const normalized = raw?.trim() || configured || `Dev Account ${accountKey}`;
  if (normalized.length > 40) {
    throw new Error("nickname must be 40 characters or fewer");
  }
  return normalized;
}

function normalizeProfileImageURL(
  raw: string | null | undefined,
): string | null {
  if (raw === null) return null;
  const normalized = raw?.trim() ?? "";
  if (!normalized) return null;

  try {
    const url = new URL(normalized);
    if (url.protocol !== "https:") {
      throw new Error("profileImageURL must use https");
    }
    return url.toString();
  } catch {
    throw new Error("profileImageURL must be a valid https URL");
  }
}

async function verifyDevSecret(req: Request, body: ReqBody): Promise<boolean> {
  const expected = Deno.env.get("DEV_AUTH_SECRET")?.trim() ?? "";
  const provided =
    (req.headers.get("X-Dev-Auth-Secret") ?? body.devSecret ?? "").trim();
  if (!expected || !provided) return false;

  return await sha256Hex(expected) === await sha256Hex(provided);
}

function resolveRegionMetadata(
  defaultRegionId: string | null,
  regionLookup: Map<string, RegionRow>,
): {
  default_region_label: string | null;
  default_service_region_id: string | null;
} {
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
    // Region sync can be absent in fresh development environments.
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
    .select(USER_SELECT)
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`users lookup failed: ${error.message}`);
  }

  return (user as UserRow | null) ?? null;
}

async function loadIdentity(accountKey: string): Promise<IdentityRow | null> {
  const { data: identity, error } = await supabaseAdmin
    .from("user_identities")
    .select("user_id")
    .eq("provider", "dev")
    .eq("provider_user_id", accountKey)
    .maybeSingle();

  if (error) {
    throw new Error(`user identity lookup failed: ${error.message}`);
  }

  return (identity as IdentityRow | null) ?? null;
}

async function createDevUser(
  nickname: string,
  profileImageURL: string | null,
): Promise<UserRow> {
  const { data: insertedUser, error } = await supabaseAdmin
    .from("users")
    .insert({
      id: crypto.randomUUID(),
      nickname,
      profile_image_url: profileImageURL,
    })
    .select(USER_SELECT)
    .single();

  if (error) {
    throw new Error(`users insert failed: ${error.message}`);
  }

  return insertedUser as UserRow;
}

async function updateEmptyProfileIfNeeded(
  user: UserRow,
  nickname: string,
  profileImageURL: string | null,
): Promise<UserRow> {
  const patch: Record<string, unknown> = {};
  if (!(user.nickname ?? "").trim()) {
    patch["nickname"] = nickname;
  }
  if (!(user.profile_image_url ?? "").trim() && profileImageURL) {
    patch["profile_image_url"] = profileImageURL;
  }

  if (Object.keys(patch).length === 0) {
    return user;
  }

  const { data: updatedUser, error } = await supabaseAdmin
    .from("users")
    .update(patch)
    .eq("id", user.id)
    .select(USER_SELECT)
    .single();

  if (error) {
    throw new Error(`users update failed: ${error.message}`);
  }

  return updatedUser as UserRow;
}

async function upsertIdentity(
  user: UserRow,
  accountKey: string,
  nickname: string,
  profileImageURL: string | null,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("user_identities")
    .upsert(
      {
        user_id: user.id,
        provider: "dev",
        provider_user_id: accountKey,
        display_name: nickname,
        profile_image_url: profileImageURL,
        last_login_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: "provider,provider_user_id" },
    );

  if (error) {
    throw new Error(`user identity upsert failed: ${error.message}`);
  }
}

async function issueSession(user: UserRow, deviceId: string): Promise<{
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  sessionId: string;
}> {
  const now = Date.now();
  const accessTokenExpiresAt = new Date(now + ACCESS_TOKEN_TTL_SEC * 1000)
    .toISOString();
  const refreshTokenExpiresAt = new Date(now + REFRESH_TOKEN_TTL_MS)
    .toISOString();

  const accessToken = await signAccessJwt({
    userId: user.id,
    role: "USER",
    expiresInSeconds: ACCESS_TOKEN_TTL_SEC,
  });

  const refreshToken = generateRefreshToken();
  const tokenHash = await hashRefreshToken(refreshToken);

  const { error: revokeError } = await supabaseAdmin
    .from("user_refresh_tokens")
    .update({ revoked_at: new Date(now).toISOString() })
    .eq("user_id", user.id)
    .eq("device_id", deviceId)
    .is("revoked_at", null);
  if (revokeError) {
    throw new Error(`refresh token revoke failed: ${revokeError.message}`);
  }

  const { data: insertedToken, error: rtError } = await supabaseAdmin
    .from("user_refresh_tokens")
    .insert({
      user_id: user.id,
      device_id: deviceId,
      token_hash: tokenHash,
      expires_at: refreshTokenExpiresAt,
    })
    .select("id")
    .single();
  if (rtError) {
    throw new Error(`refresh token insert failed: ${rtError.message}`);
  }

  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt,
    refreshTokenExpiresAt,
    sessionId: (insertedToken as { id: string }).id,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse(405, "Method not allowed", "AUTH_METHOD_NOT_ALLOWED");
  }
  if (!isDevAuthEnabled()) {
    return errorResponse(404, "dev auth is disabled", "AUTH_DEV_DISABLED");
  }

  try {
    const body = await readJson<ReqBody>(req);
    if (!await verifyDevSecret(req, body)) {
      return errorResponse(
        401,
        "invalid dev auth secret",
        "AUTH_DEV_SECRET_INVALID",
      );
    }

    const accountKey = normalizeAccountKey(body.accountKey);
    if (!allowedAccountKeys().has(accountKey)) {
      return errorResponse(
        403,
        "dev account is not allowed",
        "AUTH_DEV_ACCOUNT_NOT_ALLOWED",
      );
    }

    const deviceId = body.deviceId?.trim() ?? "";
    if (!deviceId) {
      return errorResponse(
        400,
        "deviceId is required",
        "AUTH_DEVICE_ID_REQUIRED",
      );
    }

    const nickname = normalizeNickname(body.nickname, accountKey);
    const profileImageURL = normalizeProfileImageURL(body.profileImageURL);
    const identity = await loadIdentity(accountKey);

    let userRow: UserRow;
    if (identity) {
      const existingUser = await loadUserRowById(identity.user_id);
      if (!existingUser) {
        return errorResponse(
          500,
          "dev user not found",
          "AUTH_USER_LOOKUP_FAILED",
        );
      }
      userRow = await updateEmptyProfileIfNeeded(
        existingUser,
        nickname,
        profileImageURL,
      );
    } else {
      userRow = await createDevUser(nickname, profileImageURL);
    }

    if (userRow.deleted_at) {
      return errorResponse(403, "account is deleted", "AUTH_ACCOUNT_DELETED");
    }

    await upsertIdentity(userRow, accountKey, nickname, profileImageURL);
    const session = await issueSession(userRow, deviceId);
    const safeUser = await toSafeUser(userRow);
    const needsOnboarding = computeNeedsOnboarding(userRow);

    return jsonResponse(200, {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      access_token_expires_at: session.accessTokenExpiresAt,
      refresh_token_expires_at: session.refreshTokenExpiresAt,
      session_id: session.sessionId,
      user: safeUser,
      needsOnboarding,
      onboarding_prefill: {
        nickname,
        profile_image_url: profileImageURL,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return errorResponse(400, msg, "AUTH_DEV_LOGIN_FAILED");
  }
});
