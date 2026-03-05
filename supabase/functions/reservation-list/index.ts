import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  errorResponse,
  getBearerToken,
  jsonResponse,
} from "../_shared/http.ts";
import { verifyAccessJwt } from "../_shared/jwt.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";

type ReservationSegment = "upcoming" | "past";

type CursorPayload = {
  slot_start_at: string;
  id: string;
};

type JoinedReservationRow = {
  id: string;
  status: string;
  selected_options_snapshot: Record<string, unknown> | null;
  attached_image_url: string | null;
  ai_generation_id: string | null;
  created_at: string;
  references: unknown;
  shops: unknown;
  slots: unknown;
};

type ReferenceRow = {
  id: string;
  title: string;
};

type ShopRow = {
  id: string;
  name: string;
  address: string;
};

type SlotRow = {
  id: string;
  start_at: string;
  duration_min: number;
  status: string;
};

const LISTABLE_STATUSES = [
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

function parseSegment(raw: string | null): ReservationSegment {
  if (!raw || raw.trim().length === 0) return "upcoming";
  if (raw === "upcoming" || raw === "past") return raw;
  throw new Error("segment must be upcoming or past");
}

function parseLimit(raw: string | null): number {
  if (!raw) return 20;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 50) {
    throw new Error("limit must be integer between 1 and 50");
  }
  return n;
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

  const slotStartAt = (parsed as Record<string, unknown>)["slot_start_at"];
  const id = (parsed as Record<string, unknown>)["id"];

  if (
    typeof slotStartAt !== "string" ||
    Number.isNaN(Date.parse(slotStartAt)) ||
    typeof id !== "string" ||
    !isUuid(id)
  ) {
    throw new Error("cursor is invalid");
  }

  return {
    slot_start_at: slotStartAt,
    id: id.toLowerCase(),
  };
}

function encodeCursor(payload: CursorPayload): string {
  return btoa(JSON.stringify(payload));
}

function firstObject<T>(value: unknown): T | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    const first = value[0];
    return first ? first as T : null;
  }
  return value as T;
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

    const segment = parseSegment(url.searchParams.get("segment"));
    const limit = parseLimit(url.searchParams.get("limit"));
    const cursor = decodeCursor(url.searchParams.get("cursor"));

    let query = supabaseAdmin
      .from("reservations")
      .select(
        "id, status, selected_options_snapshot, attached_image_url, ai_generation_id, created_at, references!reservations_reference_id_fkey(id, title), shops!reservations_shop_id_fkey(id, name, address), slots!inner(id, start_at, duration_min, status)",
      )
      .eq("user_id", userId)
      .in("status", LISTABLE_STATUSES);

    const nowISO = new Date().toISOString();
    if (segment === "upcoming") {
      query = query.gte("slots.start_at", nowISO);
    } else {
      query = query.lt("slots.start_at", nowISO);
    }

    const fetchLimit = Math.min(200, limit + 40);
    const ascending = segment === "upcoming";

    const { data, error } = await query
      .order("start_at", { ascending, foreignTable: "slots" })
      .order("id", { ascending })
      .limit(fetchLimit);

    if (error) return errorResponse(500, `reservation list lookup failed: ${error.message}`);

    const sourceRows = (data ?? []) as JoinedReservationRow[];

    const rows = sourceRows.filter((row) => {
      const slot = firstObject<SlotRow>(row.slots);
      if (!slot) return false;

      if (!cursor) return true;

      const cmpTime = slot.start_at.localeCompare(cursor.slot_start_at);
      if (segment === "upcoming") {
        if (cmpTime > 0) return true;
        if (cmpTime < 0) return false;
        return row.id.toLowerCase() > cursor.id;
      }

      if (cmpTime < 0) return true;
      if (cmpTime > 0) return false;
      return row.id.toLowerCase() < cursor.id;
    });

    const pageRows = rows.slice(0, limit);

    const items = pageRows.flatMap((row) => {
      const reference = firstObject<ReferenceRow>(row.references);
      const shop = firstObject<ShopRow>(row.shops);
      const slot = firstObject<SlotRow>(row.slots);
      if (!reference || !shop || !slot) {
        return [];
      }

      return [{
        id: row.id,
        status: row.status,
        shop_id: shop.id,
        shop_name: shop.name,
        shop_address: shop.address,
        reference_id: reference.id,
        reference_title: reference.title,
        slot_id: slot.id,
        slot_start_at: slot.start_at,
        slot_duration_min: slot.duration_min,
        attached_image_url: row.attached_image_url,
        ai_generation_id: row.ai_generation_id,
        selected_options_snapshot: row.selected_options_snapshot ?? {},
        created_at: row.created_at,
      }];
    });

    const nextCursor = pageRows.length === limit
      ? (() => {
        const last = pageRows[pageRows.length - 1];
        const lastSlot = firstObject<SlotRow>(last.slots);
        if (!lastSlot) return null;
        return encodeCursor({
          slot_start_at: lastSlot.start_at,
          id: last.id,
        });
      })()
      : null;

    return jsonResponse(200, {
      items,
      next_cursor: nextCursor,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (message.includes("segment") || message.includes("limit") || message.includes("cursor")) {
      return errorResponse(400, message);
    }
    return errorResponse(401, message);
  }
});
