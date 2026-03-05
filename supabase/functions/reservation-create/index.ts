import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  errorResponse,
  getBearerToken,
  jsonResponse,
  readJson,
} from "../_shared/http.ts";
import { verifyAccessJwt } from "../_shared/jwt.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";

type ReservationCreateBody = {
  reference_id?: string;
  slot_id?: string;
  selected_options_snapshot?: Record<string, unknown>;
  attached_image_url?: string | null;
  ai_generation_id?: string | null;
};

type ReferenceRow = {
  id: string;
  shop_id: string;
  is_active: boolean;
  service_duration_min: number;
};

type ShopSettingRow = {
  shop_id: string;
  booking_enabled: boolean;
};

type SlotRow = {
  id: string;
  shop_id: string;
  start_at: string;
  duration_min: number;
  status: string;
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

function parseUuid(value: string | undefined, name: string): string {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!isUuid(normalized)) {
    throw new Error(`${name} must be uuid`);
  }
  return normalized;
}

function slotEndAtISO(startAtISO: string, durationMin: number): string {
  const startMs = Date.parse(startAtISO);
  const safeDurationMin = Math.max(1, durationMin || 1);
  return new Date(startMs + safeDurationMin * 60 * 1000).toISOString();
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
  if (req.method !== "POST") return errorResponse(405, "Method not allowed");

  try {
    const userId = await requireUserId(req);
    const body = await readJson<ReservationCreateBody>(req);

    const referenceId = parseUuid(body.reference_id, "reference_id");
    const slotId = parseUuid(body.slot_id, "slot_id");

    const selectedOptionsSnapshot = body.selected_options_snapshot && typeof body.selected_options_snapshot === "object"
      ? body.selected_options_snapshot
      : {};

    const attachedImageURL = (body.attached_image_url ?? "").trim();
    const aiGenerationIdRaw = body.ai_generation_id?.trim().toLowerCase() ?? "";
    if (aiGenerationIdRaw && !isUuid(aiGenerationIdRaw)) {
      return errorResponse(400, "ai_generation_id must be uuid");
    }

    const [{ data: reference, error: referenceError }, { data: slot, error: slotError }] = await Promise.all([
      supabaseAdmin
        .from("references")
        .select("id, shop_id, is_active, service_duration_min")
        .eq("id", referenceId)
        .maybeSingle(),
      supabaseAdmin
        .from("slots")
        .select("id, shop_id, start_at, duration_min, status")
        .eq("id", slotId)
        .maybeSingle(),
    ]);

    if (referenceError) return errorResponse(500, `reference lookup failed: ${referenceError.message}`);
    if (slotError) return errorResponse(500, `slot lookup failed: ${slotError.message}`);
    if (!reference) return errorResponse(404, "reference not found");
    if (!slot) return errorResponse(404, "slot not found");

    const referenceData = reference as ReferenceRow;
    const slotData = slot as SlotRow;

    if (!referenceData.is_active) {
      return errorResponse(400, "reference is inactive");
    }

    const { data: shopSetting, error: shopSettingError } = await supabaseAdmin
      .from("shop_settings")
      .select("shop_id, booking_enabled")
      .eq("shop_id", referenceData.shop_id)
      .maybeSingle();

    if (shopSettingError && shopSettingError.code !== "PGRST116") {
      return errorResponse(500, `shop settings lookup failed: ${shopSettingError.message}`);
    }

    const bookingEnabled = (shopSetting as ShopSettingRow | null)?.booking_enabled ?? false;
    if (!bookingEnabled) {
      return errorResponse(400, "shop booking is disabled");
    }

    if (slotData.status !== "OPEN") {
      return errorResponse(409, "slot is not open");
    }

    if (referenceData.shop_id !== slotData.shop_id) {
      return errorResponse(400, "reference and slot shop mismatch");
    }

    if (slotData.duration_min < Math.max(1, referenceData.service_duration_min || 1)) {
      return errorResponse(400, "slot duration is shorter than required service duration");
    }

    if (Date.parse(slotData.start_at) < Date.now()) {
      return errorResponse(400, "cannot create reservation on past slot");
    }

    const slotEndAt = slotEndAtISO(slotData.start_at, slotData.duration_min);

    const { data: existingReservation, error: existingReservationError } = await supabaseAdmin
      .from("reservations")
      .select("id")
      .eq("slot_id", slotId)
      .in("status", ACTIVE_RESERVATION_STATUSES)
      .maybeSingle();

    if (existingReservationError && existingReservationError.code !== "PGRST116") {
      return errorResponse(500, `existing reservation lookup failed: ${existingReservationError.message}`);
    }

    if (existingReservation) {
      return errorResponse(409, "slot already reserved");
    }

    const { data: overlappingReservation, error: overlappingReservationError } = await supabaseAdmin
      .from("reservations")
      .select("id")
      .eq("shop_id", referenceData.shop_id)
      .in("status", ACTIVE_RESERVATION_STATUSES)
      .lt("slot_start_at", slotEndAt)
      .gt("slot_end_at", slotData.start_at)
      .limit(1)
      .maybeSingle();

    if (overlappingReservationError && overlappingReservationError.code !== "PGRST116") {
      return errorResponse(500, `overlap reservation lookup failed: ${overlappingReservationError.message}`);
    }

    if (overlappingReservation) {
      return errorResponse(409, "time window already reserved");
    }

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("reservations")
      .insert({
        user_id: userId,
        shop_id: referenceData.shop_id,
        reference_id: referenceId,
        slot_id: slotId,
        status: "CONFIRMED",
        selected_options_snapshot: selectedOptionsSnapshot,
        attached_image_url: attachedImageURL || null,
        ai_generation_id: aiGenerationIdRaw || null,
      })
      .select("id, user_id, shop_id, reference_id, slot_id, status, selected_options_snapshot, attached_image_url, ai_generation_id, slot_start_at, slot_end_at, created_at, updated_at")
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        return errorResponse(409, "slot already reserved");
      }
      if (insertError.code === "23P01") {
        return errorResponse(409, "time window already reserved");
      }
      return errorResponse(500, `reservation insert failed: ${insertError.message}`);
    }

    return jsonResponse(200, {
      ok: true,
      reservation: {
        ...inserted,
        slot_start_at: slotData.start_at,
        slot_duration_min: slotData.duration_min,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (
      message.includes("reference_id") ||
      message.includes("slot_id") ||
      message.includes("ai_generation_id")
    ) {
      return errorResponse(400, message);
    }
    return errorResponse(401, message);
  }
});
