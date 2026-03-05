import { requireEnv } from "./env.ts";
import { getBearerToken } from "./http.ts";
import { verifyAccessJwt } from "./jwt.ts";
import { supabaseAdmin } from "./supabase.ts";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUPABASE_ISSUER = `${requireEnv("SUPABASE_URL").replace(/\/+$/, "")}/auth/v1`;

type JwtHeader = {
  alg?: unknown;
};

type JwtPayload = {
  sub?: unknown;
  iss?: unknown;
  aud?: unknown;
};

function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return atob(padded);
}

function parseJwtPartsUnsafe(token: string): { header: JwtHeader; payload: JwtPayload } {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("invalid token format");
  }

  try {
    const header = JSON.parse(base64UrlDecode(parts[0])) as JwtHeader;
    const payload = JSON.parse(base64UrlDecode(parts[1])) as JwtPayload;
    return { header, payload };
  } catch {
    throw new Error("invalid token format");
  }
}

function isAuthenticatedAudience(aud: unknown): boolean {
  if (typeof aud === "string") {
    return aud === "authenticated";
  }
  if (Array.isArray(aud)) {
    return aud.some((item) => typeof item === "string" && item === "authenticated");
  }
  return false;
}

function normalizeIssuer(issuer: string): string {
  return issuer.replace(/\/+$/, "");
}

async function verifySupabaseSessionUserId(token: string): Promise<string> {
  const { header, payload } = parseJwtPartsUnsafe(token);

  if (header.alg !== "ES256") {
    throw new Error("unsupported token algorithm");
  }
  if (typeof payload.iss !== "string" || normalizeIssuer(payload.iss) !== SUPABASE_ISSUER) {
    throw new Error("invalid token issuer");
  }
  if (!isAuthenticatedAudience(payload.aud)) {
    throw new Error("invalid token audience");
  }
  if (typeof payload.sub !== "string" || !isUuid(payload.sub)) {
    throw new Error("invalid token payload");
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user?.id || !isUuid(data.user.id)) {
    throw new Error("invalid supabase session token");
  }

  const userId = data.user.id.toLowerCase();
  const tokenSub = payload.sub.toLowerCase();
  if (userId !== tokenSub) {
    throw new Error("token subject mismatch");
  }

  return userId;
}

export async function requireOwnerAuthUserId(req: Request): Promise<string> {
  const token = getBearerToken(req);
  if (!token) {
    throw new Error("missing bearer token");
  }

  try {
    const payload = await verifyAccessJwt(token);
    const sub = payload["sub"];
    if (!sub || typeof sub !== "string" || !isUuid(sub)) {
      throw new Error("invalid token payload");
    }
    return sub.toLowerCase();
  } catch {
    return await verifySupabaseSessionUserId(token);
  }
}
