import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { errorResponse, jsonResponse, readJson } from "../_shared/http.ts";
import { requireOwnerAuthUserId } from "../_shared/owner-auth.ts";
import {
  parseChangeItems,
  parseRequiredText,
  parseUuid,
  requireShopMembership,
} from "../_shared/quote.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";

type OwnerQuoteResponseUpsertBody = {
  target_id?: string;
  final_price?: number;
  change_items?: unknown;
  memo?: string;
};

type TargetRow = {
  id: string;
  quote_request_id: string;
  shop_id: string;
  status: string;
};

type RequestRow = {
  id: string;
  status: string;
  selected_target_id: string | null;
};

function parseFinalPrice(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("final_price must be number");
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("final_price must be non-negative integer");
  }
  return value;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return errorResponse(405, "Method not allowed");

  try {
    const userId = await requireOwnerAuthUserId(req);
    const body = await readJson<OwnerQuoteResponseUpsertBody>(req);

    const targetId = parseUuid(body.target_id, "target_id");
    const finalPrice = parseFinalPrice(body.final_price);
    const changeItems = parseChangeItems(body.change_items);
    const memo = parseRequiredText(body.memo, "memo", 1000);

    const { data: targetRow, error: targetError } = await supabaseAdmin
      .from("quote_request_targets")
      .select("id, quote_request_id, shop_id, status")
      .eq("id", targetId)
      .maybeSingle();

    if (targetError) {
      return errorResponse(500, `target lookup failed: ${targetError.message}`);
    }
    if (!targetRow) {
      return errorResponse(404, "quote target not found");
    }

    const target = targetRow as TargetRow;

    await requireShopMembership(userId, target.shop_id);

    const { data: requestRow, error: requestError } = await supabaseAdmin
      .from("quote_requests")
      .select("id, status, selected_target_id")
      .eq("id", target.quote_request_id)
      .maybeSingle();

    if (requestError) {
      return errorResponse(500, `request lookup failed: ${requestError.message}`);
    }
    if (!requestRow) {
      return errorResponse(404, "quote request not found");
    }

    const request = requestRow as RequestRow;

    if (request.status === "SELECTED" && request.selected_target_id !== target.id) {
      return errorResponse(409, "quote request already selected with another shop");
    }

    if (target.status === "CLOSED") {
      return errorResponse(409, "target is closed");
    }

    const nowIso = new Date().toISOString();

    const { data: responseRow, error: upsertError } = await supabaseAdmin
      .from("quote_responses")
      .upsert(
        {
          target_id: target.id,
          final_price: finalPrice,
          change_items: changeItems,
          memo,
          created_by: userId,
          updated_at: nowIso,
        },
        {
          onConflict: "target_id",
        },
      )
      .select("id, target_id, final_price, change_items, memo, created_by, created_at, updated_at")
      .single();

    if (upsertError) {
      return errorResponse(500, `quote response upsert failed: ${upsertError.message}`);
    }

    let nextTargetStatus = target.status;
    if (target.status === "REQUESTED") {
      const { data: updatedTarget, error: targetUpdateError } = await supabaseAdmin
        .from("quote_request_targets")
        .update({
          status: "RESPONDED",
          responded_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", target.id)
        .eq("status", "REQUESTED")
        .select("status")
        .maybeSingle();

      if (targetUpdateError) {
        return errorResponse(500, `target status update failed: ${targetUpdateError.message}`);
      }

      if (updatedTarget && typeof updatedTarget.status === "string") {
        nextTargetStatus = updatedTarget.status;
      }
    }

    return jsonResponse(200, {
      ok: true,
      target_id: target.id,
      target_status: nextTargetStatus,
      response: responseRow,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (
      message.includes("target_id") ||
      message.includes("final_price") ||
      message.includes("change_items") ||
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
