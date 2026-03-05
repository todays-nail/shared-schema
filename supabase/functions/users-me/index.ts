import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  errorResponse,
  getBearerToken,
  jsonResponse,
  readJson,
} from "../_shared/http.ts";
import { computeNeedsOnboarding } from "../_shared/onboarding.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { verifyAccessJwt } from "../_shared/jwt.ts";
import {
  buildRegionLabel,
  buildRegionLookup,
  fetchAllRegions,
  isUuid,
  resolveServiceScopeId,
  type RegionRow,
} from "../_shared/regions.ts";

type PatchBody = {
  nickname?: string;
  phone?: string | null;
  profile_image_url?: string | null;
  default_region_id?: string | null;
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

async function requireUserId(req: Request): Promise<string> {
  const token = getBearerToken(req);
  if (!token) throw new Error("missing bearer token");
  const payload = await verifyAccessJwt(token);
  const sub = payload["sub"];
  if (!sub || typeof sub !== "string") throw new Error("invalid token payload");
  return sub;
}

function normalizeOptionalUuid(raw: string | null | undefined, fieldName: string): string | null {
  if (raw === null) return null;
  if (raw === undefined) return undefined as unknown as null;

  const normalized = raw.trim().toLowerCase();
  if (normalized.length === 0) return null;
  if (!isUuid(normalized)) {
    throw new Error(`${fieldName} must be uuid`);
  }
  return normalized;
}

async function ensureRegionExists(regionId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("regions")
    .select("id")
    .eq("id", regionId)
    .maybeSingle();

  if (error) throw new Error(`regions lookup failed: ${error.message}`);
  if (!data) throw new Error("default_region_id not found");
}

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

async function toSafeUser(userRow: UserRow): Promise<Record<string, unknown>> {
  let regionLookup = new Map<string, RegionRow>();
  try {
    const regions = await fetchAllRegions();
    regionLookup = buildRegionLookup(regions);
  } catch {
    // region_sync 전/초기 환경에서는 라벨 계산 실패를 사용자 조회 실패로 취급하지 않는다.
  }

  const metadata = resolveRegionMetadata(userRow.default_region_id, regionLookup);

  return {
    id: userRow.id,
    nickname: userRow.nickname,
    phone: userRow.phone,
    profile_image_url: userRow.profile_image_url,
    default_region_id: userRow.default_region_id,
    default_region_label: metadata.default_region_label,
    default_service_region_id: metadata.default_service_region_id,
    created_at: userRow.created_at,
    updated_at: userRow.updated_at,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const userId = await requireUserId(req);

    if (req.method === "GET") {
      const { data: user, error } = await supabaseAdmin
        .from("users")
        .select("id, nickname, phone, profile_image_url, default_region_id, created_at, updated_at, deleted_at")
        .eq("id", userId)
        .single();
      if (error) return errorResponse(500, `users lookup failed: ${error.message}`);
      const userRow = user as UserRow;
      if (userRow.deleted_at) return errorResponse(403, "account is deleted");

      const safeUser = await toSafeUser(userRow);
      const needsOnboarding = computeNeedsOnboarding(userRow);
      return jsonResponse(200, { user: safeUser, needsOnboarding });
    }

    if (req.method === "PATCH") {
      const { data: existing, error: existingError } = await supabaseAdmin
        .from("users")
        .select("deleted_at")
        .eq("id", userId)
        .single();
      if (existingError) return errorResponse(500, `users lookup failed: ${existingError.message}`);
      if ((existing as { deleted_at: string | null }).deleted_at) return errorResponse(403, "account is deleted");

      const body = await readJson<PatchBody>(req);
      const nickname = body.nickname?.trim();

      if (nickname !== undefined && nickname.length === 0) {
        return errorResponse(400, "nickname must be non-empty");
      }

      const patch: Record<string, unknown> = {};
      if (nickname !== undefined) patch["nickname"] = nickname;
      if (body.phone !== undefined) patch["phone"] = body.phone;
      if (body.profile_image_url !== undefined) {
        patch["profile_image_url"] = body.profile_image_url;
      }

      if (body.default_region_id !== undefined) {
        const normalizedDefaultRegionId = normalizeOptionalUuid(body.default_region_id, "default_region_id");
        if (normalizedDefaultRegionId) {
          await ensureRegionExists(normalizedDefaultRegionId);
        }
        patch["default_region_id"] = normalizedDefaultRegionId;
      }

      if (Object.keys(patch).length === 0) {
        const { data: untouched, error: untouchedError } = await supabaseAdmin
          .from("users")
          .select("id, nickname, phone, profile_image_url, default_region_id, created_at, updated_at, deleted_at")
          .eq("id", userId)
          .single();
        if (untouchedError) return errorResponse(500, `users lookup failed: ${untouchedError.message}`);
        const userRow = untouched as UserRow;
        if (userRow.deleted_at) return errorResponse(403, "account is deleted");

        const safeUser = await toSafeUser(userRow);
        const needsOnboarding = computeNeedsOnboarding(userRow);
        return jsonResponse(200, { user: safeUser, needsOnboarding });
      }

      const { data: user, error } = await supabaseAdmin
        .from("users")
        .update(patch)
        .eq("id", userId)
        .select("id, nickname, phone, profile_image_url, default_region_id, created_at, updated_at, deleted_at")
        .single();
      if (error) return errorResponse(500, `users update failed: ${error.message}`);
      const userRow = user as UserRow;
      if (userRow.deleted_at) return errorResponse(403, "account is deleted");

      const safeUser = await toSafeUser(userRow);
      const needsOnboarding = computeNeedsOnboarding(userRow);
      return jsonResponse(200, { user: safeUser, needsOnboarding });
    }

    return errorResponse(405, "Method not allowed");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (
      msg.includes("default_region_id") ||
      msg.includes("regions lookup failed")
    ) {
      return errorResponse(400, msg);
    }
    return errorResponse(401, msg);
  }
});
