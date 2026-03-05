import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  errorResponse,
  getBearerToken,
  jsonResponse,
} from "../_shared/http.ts";
import { verifyAccessJwt } from "../_shared/jwt.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";

type CursorPayload = {
  created_at: string;
  id: string;
};

type FeedCategory = "all" | "style" | "reservable";

type FeedRow = {
  id: string;
  thumbnail_url: string;
  like_count: number;
  is_reservable: boolean;
  style_tags: string[] | null;
  created_at: string;
};

type BookmarkRow = {
  reference_id: string;
  created_at: string;
};

type ReservationWindow = {
  start_at: string;
  end_at: string;
};

type ReferenceMetaRow = {
  id: string;
  shop_id: string;
  service_duration_min: number;
};

type SlotAvailabilityRow = {
  id: string;
  shop_id: string;
  start_at: string;
  duration_min: number;
};

type ReservedIntervalRow = {
  shop_id: string;
  slot_start_at: string;
  slot_end_at: string;
};

type ShopBookingSettingRow = {
  shop_id: string;
  booking_enabled: boolean;
};

type RegionRow = {
  id: string;
  parent_id: string | null;
};

const ACTIVE_RESERVATION_STATUSES = [
  "PENDING_DEPOSIT",
  "DEPOSIT_PAID",
  "CONFIRMED",
  "SERVICE_CONFIRMED",
  "BALANCE_PAID",
  "COMPLETED",
];

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
}

function parseLimit(raw: string | null): number {
  if (!raw) return 20;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 50) {
    throw new Error("limit must be integer between 1 and 50");
  }
  return n;
}

function parseCategory(raw: string | null): FeedCategory {
  if (!raw || raw.trim().length === 0) return "all";
  if (raw === "all" || raw === "style" || raw === "reservable") return raw;
  throw new Error("category must be one of: all, style, reservable");
}

function parseStyles(raw: string | null): string[] {
  if (!raw) return [];
  const styles = raw
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);

  const unique = Array.from(new Set(styles));
  if (unique.length > 3) {
    throw new Error("styles supports up to 3 values");
  }
  return unique;
}

function parseLikedOnly(raw: string | null): boolean {
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  if (normalized.length === 0) return false;
  if (["1", "true", "t", "yes", "y"].includes(normalized)) return true;
  if (["0", "false", "f", "no", "n"].includes(normalized)) return false;
  throw new Error("liked_only must be boolean-ish (true/false/1/0)");
}

function parseRegionId(raw: string | null): string | null {
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase();
  if (normalized.length === 0) return null;
  if (!isUuid(normalized)) {
    throw new Error("region_id must be uuid");
  }
  return normalized;
}

function parseIncludeDescendants(raw: string | null): boolean {
  if (!raw) return true;
  const normalized = raw.trim().toLowerCase();
  if (normalized.length === 0) return true;
  if (["1", "true", "t", "yes", "y"].includes(normalized)) return true;
  if (["0", "false", "f", "no", "n"].includes(normalized)) return false;
  throw new Error("include_descendants must be boolean-ish (true/false/1/0)");
}

function decodeCursor(raw: string | null): CursorPayload | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(atob(raw));
  } catch {
    throw new Error("cursor is invalid");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("cursor is invalid");
  }

  const createdAt = (parsed as Record<string, unknown>)["created_at"];
  const id = (parsed as Record<string, unknown>)["id"];
  if (
    typeof createdAt !== "string" ||
    Number.isNaN(Date.parse(createdAt)) ||
    typeof id !== "string" ||
    !isUuid(id)
  ) {
    throw new Error("cursor is invalid");
  }

  return { created_at: createdAt, id: id.toLowerCase() };
}

function encodeCursor(payload: CursorPayload): string {
  return btoa(JSON.stringify(payload));
}

function parseReservationWindow(url: URL): ReservationWindow | null {
  const reservationDate = url.searchParams.get("reservation_date")?.trim() ?? "";
  const startTime = url.searchParams.get("start_time")?.trim() ?? "";
  const endTime = url.searchParams.get("end_time")?.trim() ?? "";

  const hasAny = reservationDate.length > 0 || startTime.length > 0 || endTime.length > 0;
  if (!hasAny) return null;

  if (!reservationDate || !startTime || !endTime) {
    throw new Error("reservation_date, start_time, end_time are required together");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(reservationDate)) {
    throw new Error("reservation_date must be yyyy-mm-dd");
  }
  if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
    throw new Error("start_time/end_time must be HH:mm");
  }

  const startAt = new Date(`${reservationDate}T${startTime}:00.000Z`);
  const endAt = new Date(`${reservationDate}T${endTime}:00.000Z`);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    throw new Error("reservation_date/start_time/end_time are invalid");
  }
  if (endAt <= startAt) {
    throw new Error("end_time must be later than start_time");
  }

  return {
    start_at: startAt.toISOString(),
    end_at: endAt.toISOString(),
  };
}

function buildDefaultReservationWindow(days = 7): ReservationWindow {
  const now = new Date();
  const startAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const endAt = new Date(startAt.getTime() + days * 24 * 60 * 60 * 1000);

  return {
    start_at: startAt.toISOString(),
    end_at: endAt.toISOString(),
  };
}

function slotEndAtISO(startAtISO: string, durationMin: number): string {
  const startMs = Date.parse(startAtISO);
  const safeDurationMin = Math.max(1, durationMin || 1);
  return new Date(startMs + safeDurationMin * 60 * 1000).toISOString();
}

function hasOverlap(startAtISO: string, endAtISO: string, intervals: ReservedIntervalRow[]): boolean {
  const startMs = Date.parse(startAtISO);
  const endMs = Date.parse(endAtISO);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return true;

  return intervals.some((interval) => {
    const reservedStartMs = Date.parse(interval.slot_start_at);
    const reservedEndMs = Date.parse(interval.slot_end_at);
    if (Number.isNaN(reservedStartMs) || Number.isNaN(reservedEndMs)) return false;
    return startMs < reservedEndMs && endMs > reservedStartMs;
  });
}

async function resolveRegionFilterIDs(
  regionID: string,
  includeDescendants: boolean,
): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("regions")
    .select("id, parent_id")
    .limit(5000);

  if (error) {
    throw new Error(`regions lookup failed: ${error.message}`);
  }

  const regions = (data ?? []) as RegionRow[];
  const regionIds = new Set(regions.map((row) => row.id.toLowerCase()));
  if (!regionIds.has(regionID)) {
    throw new Error("region_id not found");
  }

  if (!includeDescendants) {
    return [regionID];
  }

  const childrenByParent = new Map<string, string[]>();
  for (const row of regions) {
    if (!row.parent_id) continue;
    const parentID = row.parent_id.toLowerCase();
    const list = childrenByParent.get(parentID) ?? [];
    list.push(row.id.toLowerCase());
    childrenByParent.set(parentID, list);
  }

  const visited = new Set<string>();
  const queue: string[] = [regionID];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const childID of childrenByParent.get(current) ?? []) {
      if (!visited.has(childID)) {
        queue.push(childID);
      }
    }
  }

  return Array.from(visited);
}

async function filterRowsByReservationAvailability(
  rows: FeedRow[],
  window: ReservationWindow,
): Promise<FeedRow[]> {
  if (rows.length === 0) return [];

  const referenceIds = rows.map((row) => row.id);

  const { data: references, error: referencesError } = await supabaseAdmin
    .from("references")
    .select("id, shop_id, service_duration_min")
    .in("id", referenceIds);

  if (referencesError) {
    throw new Error(`reservation reference lookup failed: ${referencesError.message}`);
  }

  const referenceMeta = new Map<string, ReferenceMetaRow>();
  for (const row of (references ?? []) as ReferenceMetaRow[]) {
    referenceMeta.set(row.id, row);
  }

  const shopIds = Array.from(new Set((references ?? []).map((row) => (row as { shop_id: string }).shop_id)));
  if (shopIds.length === 0) return [];

  const { data: shopSettings, error: shopSettingsError } = await supabaseAdmin
    .from("shop_settings")
    .select("shop_id, booking_enabled")
    .in("shop_id", shopIds)
    .eq("booking_enabled", true);

  if (shopSettingsError) {
    throw new Error(`reservation shop-settings lookup failed: ${shopSettingsError.message}`);
  }

  const bookingEnabledShopIds = new Set<string>(
    ((shopSettings ?? []) as ShopBookingSettingRow[]).map((row) => row.shop_id),
  );

  if (bookingEnabledShopIds.size === 0) return [];

  const enabledShopIds = shopIds.filter((shopId) => bookingEnabledShopIds.has(shopId));
  if (enabledShopIds.length === 0) return [];

  const { data: slots, error: slotsError } = await supabaseAdmin
    .from("slots")
    .select("id, shop_id, start_at, duration_min")
    .in("shop_id", enabledShopIds)
    .eq("status", "OPEN")
    .gte("start_at", window.start_at)
    .lt("start_at", window.end_at);

  if (slotsError) {
    throw new Error(`reservation slot lookup failed: ${slotsError.message}`);
  }

  const slotRows = (slots ?? []) as SlotAvailabilityRow[];
  if (slotRows.length === 0) return [];

  const { data: reservedRows, error: reservedError } = await supabaseAdmin
    .from("reservations")
    .select("shop_id, slot_start_at, slot_end_at")
    .in("shop_id", enabledShopIds)
    .in("status", ACTIVE_RESERVATION_STATUSES)
    .lt("slot_start_at", window.end_at)
    .gt("slot_end_at", window.start_at);

  if (reservedError) {
    throw new Error(`reservation occupied-slot lookup failed: ${reservedError.message}`);
  }

  const reservedIntervalsByShop = new Map<string, ReservedIntervalRow[]>();
  for (const row of (reservedRows ?? []) as ReservedIntervalRow[]) {
    const shopId = row.shop_id;
    if (!shopId || !row.slot_start_at || !row.slot_end_at) continue;
    const list = reservedIntervalsByShop.get(shopId) ?? [];
    list.push(row);
    reservedIntervalsByShop.set(shopId, list);
  }

  const availableSlotsByShop = new Map<string, SlotAvailabilityRow[]>();
  for (const slot of slotRows) {
    const reservedIntervals = reservedIntervalsByShop.get(slot.shop_id) ?? [];
    const endAt = slotEndAtISO(slot.start_at, slot.duration_min);
    if (hasOverlap(slot.start_at, endAt, reservedIntervals)) continue;
    const list = availableSlotsByShop.get(slot.shop_id) ?? [];
    list.push(slot);
    availableSlotsByShop.set(slot.shop_id, list);
  }

  return rows.filter((row) => {
    const meta = referenceMeta.get(row.id);
    if (!meta) return false;
    if (!bookingEnabledShopIds.has(meta.shop_id)) return false;
    const shopSlots = availableSlotsByShop.get(meta.shop_id) ?? [];
    const requiredDuration = Math.max(1, meta.service_duration_min || 1);
    return shopSlots.some((slot) => slot.duration_min >= requiredDuration);
  });
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "GET") return errorResponse(405, "Method not allowed");

  try {
    const userId = await requireUserId(req);
    const url = new URL(req.url);

    const limit = parseLimit(url.searchParams.get("limit"));
    const likedOnly = parseLikedOnly(url.searchParams.get("liked_only"));
    const category = likedOnly ? "all" : parseCategory(url.searchParams.get("category"));
    const styles = likedOnly ? [] : parseStyles(url.searchParams.get("styles"));
    const regionID = parseRegionId(url.searchParams.get("region_id"));
    const includeDescendants = parseIncludeDescendants(url.searchParams.get("include_descendants"));
    const cursor = decodeCursor(url.searchParams.get("cursor"));
    const reservationWindow = likedOnly ? null : parseReservationWindow(url);
    const shouldApplyReservationAvailability = !likedOnly &&
      (reservationWindow !== null || category === "reservable");
    const effectiveReservationWindow = shouldApplyReservationAvailability
      ? (reservationWindow ?? buildDefaultReservationWindow())
      : null;
    const regionFilterIDs = regionID
      ? await resolveRegionFilterIDs(regionID, includeDescendants)
      : null;

    if (likedOnly) {
      let bookmarksQuery = supabaseAdmin
        .from("bookmarks")
        .select("reference_id, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .order("reference_id", { ascending: false });

      if (cursor) {
        bookmarksQuery = bookmarksQuery.lte("created_at", cursor.created_at);
      }

      const fetchLimit = Math.min(200, limit + 80);
      const { data: bookmarks, error: bookmarksError } = await bookmarksQuery.limit(fetchLimit);
      if (bookmarksError) {
        return errorResponse(500, `liked feed bookmarks lookup failed: ${bookmarksError.message}`);
      }

      const sourceRows = (bookmarks ?? []) as BookmarkRow[];
      const rows = cursor
        ? sourceRows.filter((row) => {
          if (row.created_at < cursor.created_at) return true;
          if (row.created_at > cursor.created_at) return false;
          return row.reference_id.toLowerCase() < cursor.id;
        })
        : sourceRows;

      const pageRows = rows.slice(0, limit);
      const referenceIds = pageRows.map((row) => row.reference_id);

      const postRowsById = new Map<string, FeedRow>();
      if (referenceIds.length > 0) {
        let postsQuery = supabaseAdmin
          .from("feed_posts")
          .select("id, thumbnail_url, like_count, is_reservable, style_tags, created_at")
          .eq("status", "active")
          .in("id", referenceIds);
        if (regionFilterIDs && regionFilterIDs.length > 0) {
          postsQuery = postsQuery.in("region_id", regionFilterIDs);
        }
        const { data: posts, error: postsError } = await postsQuery;

        if (postsError) {
          return errorResponse(500, `liked feed posts lookup failed: ${postsError.message}`);
        }

        for (const post of (posts ?? []) as FeedRow[]) {
          postRowsById.set(post.id, post);
        }
      }

      const items = pageRows
        .map((bookmark) => {
          const post = postRowsById.get(bookmark.reference_id);
          if (!post) return null;
          return {
            id: post.id,
            thumbnail_url: post.thumbnail_url,
            like_count: post.like_count,
            is_reservable: post.is_reservable,
            is_liked: true,
            style_tags: post.style_tags ?? [],
            created_at: post.created_at,
          };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null);

      const nextCursor = pageRows.length === limit
        ? encodeCursor({
          created_at: pageRows[pageRows.length - 1].created_at,
          id: pageRows[pageRows.length - 1].reference_id,
        })
        : null;

      return jsonResponse(200, {
        items,
        next_cursor: nextCursor,
      });
    }

    let query = supabaseAdmin
      .from("feed_posts")
      .select("id, thumbnail_url, like_count, is_reservable, style_tags, created_at")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    if (regionFilterIDs && regionFilterIDs.length > 0) {
      query = query.in("region_id", regionFilterIDs);
    }

    if (category === "reservable") {
      query = query.eq("is_reservable", true);
    }

    if (styles.length > 0) {
      query = query.overlaps("style_tags", styles);
    }

    if (cursor) {
      query = query.lte("created_at", cursor.created_at);
    }

    const fetchLimit = Math.min(200, limit + 50);
    const { data, error } = await query.limit(fetchLimit);
    if (error) return errorResponse(500, `feed list lookup failed: ${error.message}`);

    const sourceRows = (data ?? []) as FeedRow[];
    const reservableRows = effectiveReservationWindow
      ? await filterRowsByReservationAvailability(sourceRows, effectiveReservationWindow)
      : sourceRows;

    const rows = cursor
      ? reservableRows.filter((row) => {
        if (row.created_at < cursor.created_at) return true;
        if (row.created_at > cursor.created_at) return false;
        return row.id.toLowerCase() < cursor.id;
      })
      : reservableRows;

    const pageRows = rows.slice(0, limit);
    const postIds = pageRows.map((row) => row.id);

    const likedIds = new Set<string>();
    if (postIds.length > 0) {
      const { data: likes, error: likesError } = await supabaseAdmin
        .from("bookmarks")
        .select("reference_id")
        .eq("user_id", userId)
        .in("reference_id", postIds);

      if (likesError) {
        return errorResponse(500, `feed likes lookup failed: ${likesError.message}`);
      }

      for (const like of likes ?? []) {
        const postId = (like as { reference_id?: string }).reference_id;
        if (postId) likedIds.add(postId);
      }
    }

    const items = pageRows.map((row) => ({
      id: row.id,
      thumbnail_url: row.thumbnail_url,
      like_count: row.like_count,
      is_reservable: row.is_reservable,
      is_liked: likedIds.has(row.id),
      style_tags: row.style_tags ?? [],
      created_at: row.created_at,
    }));

    const nextCursor = pageRows.length == limit
      ? encodeCursor({
        created_at: pageRows[pageRows.length - 1].created_at,
        id: pageRows[pageRows.length - 1].id,
      })
      : null;

    return jsonResponse(200, {
      items,
      next_cursor: nextCursor,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (
      message.includes("limit") ||
      message.includes("liked_only") ||
      message.includes("category") ||
      message.includes("styles") ||
      message.includes("cursor") ||
      message.includes("region_id") ||
      message.includes("include_descendants") ||
      message.includes("reservation_date") ||
      message.includes("start_time") ||
      message.includes("end_time")
    ) {
      return errorResponse(400, message);
    }
    return errorResponse(401, message);
  }
});
