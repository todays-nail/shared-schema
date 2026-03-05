import { requireEnv } from "./env.ts";
import { getBearerToken } from "./http.ts";
import { verifyAccessJwt } from "./jwt.ts";
import { supabaseAdmin } from "./supabase.ts";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const QUOTE_CHANGE_ITEMS = ["EXTENSION", "REMOVAL", "ART_CHANGE", "OTHER"] as const;
export type QuoteChangeItem = typeof QUOTE_CHANGE_ITEMS[number];

export function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export function parseUuid(value: string | undefined | null, name: string): string {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!isUuid(normalized)) {
    throw new Error(`${name} must be uuid`);
  }
  return normalized;
}

export function parseIsoDate(value: string | undefined | null, name: string): string {
  const normalized = value?.trim() ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`${name} must be YYYY-MM-DD`);
  }

  const parsed = Date.parse(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed)) {
    throw new Error(`${name} must be valid date`);
  }

  return normalized;
}

export function parseLimit(
  raw: string | null,
  defaultValue: number,
  min: number,
  max: number,
): number {
  if (!raw) return defaultValue;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`limit must be integer between ${min} and ${max}`);
  }
  return n;
}

export function parseRequiredText(
  value: string | undefined | null,
  name: string,
  maxLength = 1000,
): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    throw new Error(`${name} is required`);
  }
  if (trimmed.length > maxLength) {
    throw new Error(`${name} must be <= ${maxLength} chars`);
  }
  return trimmed;
}

export function parseChangeItems(value: unknown): QuoteChangeItem[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new Error("change_items must be array");
  }

  const normalized = value
    .map((item) => (typeof item === "string" ? item.trim().toUpperCase() : ""))
    .filter((item) => item.length > 0);

  const unique = [...new Set(normalized)];
  for (const item of unique) {
    if (!QUOTE_CHANGE_ITEMS.includes(item as QuoteChangeItem)) {
      throw new Error("change_items contains invalid value");
    }
  }

  return unique as QuoteChangeItem[];
}

export async function requireAuthUserId(req: Request): Promise<string> {
  const token = getBearerToken(req);
  if (!token) throw new Error("missing bearer token");

  const payload = await verifyAccessJwt(token);
  const sub = payload["sub"];
  if (!sub || typeof sub !== "string" || !isUuid(sub)) {
    throw new Error("invalid token payload");
  }

  return sub.toLowerCase();
}

export function absolutizeSignedUrl(signedUrl: string): string {
  if (signedUrl.startsWith("http://") || signedUrl.startsWith("https://")) {
    return signedUrl;
  }

  const supabaseUrl = requireEnv("SUPABASE_URL").replace(/\/+$/, "");
  if (signedUrl.startsWith("/storage/v1/")) return `${supabaseUrl}${signedUrl}`;
  if (signedUrl.startsWith("/object/")) return `${supabaseUrl}/storage/v1${signedUrl}`;
  if (signedUrl.startsWith("/")) return `${supabaseUrl}${signedUrl}`;
  return `${supabaseUrl}/${signedUrl}`;
}

export async function createSignedObjectUrl(
  bucket: string,
  objectPath: string | null | undefined,
  expiresSec = 10 * 60,
): Promise<string | null> {
  const path = objectPath?.trim();
  if (!path) return null;

  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(path, expiresSec);

  if (error || !data?.signedUrl) {
    throw new Error(`createSignedUrl failed: ${error?.message ?? "unknown"}`);
  }

  return absolutizeSignedUrl(data.signedUrl);
}

export async function resolveRegionScopeIds(regionId: string): Promise<string[]> {
  const { data: regionRows, error } = await supabaseAdmin
    .from("regions")
    .select("id, parent_id");

  if (error) {
    throw new Error(`region lookup failed: ${error.message}`);
  }

  const rows = (regionRows ?? []) as Array<{ id: string; parent_id: string | null }>;
  if (!rows.some((row) => row.id === regionId)) {
    throw new Error("region not found");
  }

  const childrenMap = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parent_id) continue;
    const key = row.parent_id;
    const current = childrenMap.get(key) ?? [];
    current.push(row.id);
    childrenMap.set(key, current);
  }

  const result = new Set<string>();
  const stack = [regionId];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    if (result.has(current)) continue;
    result.add(current);

    const children = childrenMap.get(current) ?? [];
    for (const child of children) {
      stack.push(child);
    }
  }

  return [...result];
}

export async function listVerifiedShopIdsByRegionScope(
  regionId: string,
): Promise<string[]> {
  const regionScope = await resolveRegionScopeIds(regionId);

  const { data: shopRows, error } = await supabaseAdmin
    .from("shops")
    .select("id")
    .eq("status", "VERIFIED")
    .in("region_id", regionScope);

  if (error) {
    throw new Error(`shop lookup failed: ${error.message}`);
  }

  return ((shopRows ?? []) as Array<{ id: string }>)
    .map((row) => row.id)
    .filter((id) => isUuid(id));
}

export async function requireShopMembership(
  userId: string,
  shopId: string,
): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("shop_members")
    .select("shop_id")
    .eq("user_id", userId)
    .eq("shop_id", shopId)
    .maybeSingle();

  if (error) {
    throw new Error(`membership lookup failed: ${error.message}`);
  }

  if (!data) {
    throw new Error("forbidden: shop membership required");
  }
}
