import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import { corsHeaders } from "../_shared/cors.ts";
import { errorResponse, jsonResponse, readJson } from "../_shared/http.ts";
import { requireOwnerAuthUserId } from "../_shared/owner-auth.ts";
import {
  parseRequiredText,
  parseUuid,
  requireShopMembership,
} from "../_shared/quote.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";

type PaymentStage = "DEPOSIT" | "BALANCE";

type OwnerPaymentLedgerUpsertBody = {
  reservation_id?: string;
  payment_stage?: string;
  amount?: number;
  paid_at?: string;
  memo?: string;
};

type ReservationRow = {
  id: string;
  shop_id: string;
  status: string;
};

function parsePaymentStage(value: string | undefined): PaymentStage {
  const normalized = value?.trim().toUpperCase() ?? "";
  if (normalized !== "DEPOSIT" && normalized !== "BALANCE") {
    throw new Error("payment_stage must be DEPOSIT or BALANCE");
  }
  return normalized as PaymentStage;
}

function parseAmount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("amount must be number");
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("amount must be non-negative integer");
  }
  return value;
}

function parsePaidAt(value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    return new Date().toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("paid_at must be valid ISO datetime");
  }
  return parsed.toISOString();
}

const STATUS_BLOCKLIST = new Set(["USER_CANCELLED", "SHOP_CANCELLED", "EXPIRED"]);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return errorResponse(405, "Method not allowed");

  try {
    const userId = await requireOwnerAuthUserId(req);
    const body = await readJson<OwnerPaymentLedgerUpsertBody>(req);

    const reservationId = parseUuid(body.reservation_id, "reservation_id");
    const paymentStage = parsePaymentStage(body.payment_stage);
    const amount = parseAmount(body.amount);
    const paidAt = parsePaidAt(body.paid_at);
    const memo = body.memo
      ? parseRequiredText(body.memo, "memo", 1000)
      : "";

    const { data: reservationRow, error: reservationError } = await supabaseAdmin
      .from("reservations")
      .select("id, shop_id, status")
      .eq("id", reservationId)
      .maybeSingle();

    if (reservationError) {
      return errorResponse(500, `reservation lookup failed: ${reservationError.message}`);
    }
    if (!reservationRow) {
      return errorResponse(404, "reservation not found");
    }

    const reservation = reservationRow as ReservationRow;

    await requireShopMembership(userId, reservation.shop_id);

    const nowIso = new Date().toISOString();

    const { data: ledgerRow, error: upsertError } = await supabaseAdmin
      .from("reservation_payment_ledgers")
      .upsert(
        {
          reservation_id: reservation.id,
          shop_id: reservation.shop_id,
          payment_stage: paymentStage,
          amount,
          paid_at: paidAt,
          memo,
          recorded_by: userId,
          updated_at: nowIso,
        },
        { onConflict: "reservation_id,payment_stage" },
      )
      .select("id, reservation_id, shop_id, payment_stage, amount, paid_at, memo, recorded_by, created_at, updated_at")
      .single();

    if (upsertError) {
      return errorResponse(500, `payment ledger upsert failed: ${upsertError.message}`);
    }

    let nextStatus = reservation.status;
    if (!STATUS_BLOCKLIST.has(reservation.status)) {
      nextStatus = paymentStage === "DEPOSIT" ? "DEPOSIT_PAID" : "BALANCE_PAID";

      if (nextStatus !== reservation.status) {
        const { error: statusError } = await supabaseAdmin
          .from("reservations")
          .update({ status: nextStatus, updated_at: nowIso })
          .eq("id", reservation.id);

        if (statusError) {
          return errorResponse(500, `reservation status update failed: ${statusError.message}`);
        }
      }
    }

    return jsonResponse(200, {
      ok: true,
      reservation_id: reservation.id,
      previous_status: reservation.status,
      next_status: nextStatus,
      ledger: ledgerRow,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (
      message.includes("reservation_id") ||
      message.includes("payment_stage") ||
      message.includes("amount") ||
      message.includes("paid_at") ||
      message.includes("memo")
    ) {
      return errorResponse(400, message);
    }
    if (message.includes("forbidden")) {
      return errorResponse(403, message);
    }
    return errorResponse(401, message);
  }
});
