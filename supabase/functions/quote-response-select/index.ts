import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { errorResponse, jsonResponse, readJson } from "../_shared/http.ts";
import { parseUuid, requireAuthUserId } from "../_shared/quote.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";

type QuoteResponseSelectBody = {
  quote_request_id?: string;
  target_id?: string;
};

type QuoteRequestRow = {
  id: string;
  user_id: string;
  status: string;
  selected_target_id: string | null;
};

type QuoteTargetRow = {
  id: string;
  quote_request_id: string;
  shop_id: string;
  status: string;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return errorResponse(405, "Method not allowed");

  try {
    const userId = await requireAuthUserId(req);
    const body = await readJson<QuoteResponseSelectBody>(req);

    const quoteRequestId = parseUuid(body.quote_request_id, "quote_request_id");
    const targetId = parseUuid(body.target_id, "target_id");

    const { data: requestRow, error: requestError } = await supabaseAdmin
      .from("quote_requests")
      .select("id, user_id, status, selected_target_id")
      .eq("id", quoteRequestId)
      .eq("user_id", userId)
      .maybeSingle();

    if (requestError) {
      return errorResponse(500, `quote request lookup failed: ${requestError.message}`);
    }
    if (!requestRow) {
      return errorResponse(404, "quote request not found");
    }

    const request = requestRow as QuoteRequestRow;
    if (request.status === "SELECTED" && request.selected_target_id) {
      return errorResponse(409, "quote request is already selected");
    }

    const { data: targetRow, error: targetError } = await supabaseAdmin
      .from("quote_request_targets")
      .select("id, quote_request_id, shop_id, status")
      .eq("id", targetId)
      .eq("quote_request_id", quoteRequestId)
      .maybeSingle();

    if (targetError) {
      return errorResponse(500, `quote target lookup failed: ${targetError.message}`);
    }
    if (!targetRow) {
      return errorResponse(404, "quote target not found");
    }

    const target = targetRow as QuoteTargetRow;

    const { data: existingResponse, error: responseError } = await supabaseAdmin
      .from("quote_responses")
      .select("id")
      .eq("target_id", target.id)
      .maybeSingle();

    if (responseError) {
      return errorResponse(500, `quote response lookup failed: ${responseError.message}`);
    }
    if (!existingResponse) {
      return errorResponse(400, "selected target does not have owner response yet");
    }

    const nowIso = new Date().toISOString();

    const { data: updatedRequest, error: updateRequestError } = await supabaseAdmin
      .from("quote_requests")
      .update({
        status: "SELECTED",
        selected_target_id: target.id,
        updated_at: nowIso,
      })
      .eq("id", quoteRequestId)
      .eq("user_id", userId)
      .neq("status", "SELECTED")
      .select("id, user_id, ai_generation_job_id, target_mode, region_id, preferred_date, request_note, status, selected_target_id, created_at, updated_at")
      .maybeSingle();

    if (updateRequestError) {
      return errorResponse(500, `quote request update failed: ${updateRequestError.message}`);
    }
    if (!updatedRequest) {
      return errorResponse(409, "quote request selection conflict");
    }

    const { error: closeOthersError } = await supabaseAdmin
      .from("quote_request_targets")
      .update({
        status: "CLOSED",
        updated_at: nowIso,
      })
      .eq("quote_request_id", quoteRequestId)
      .neq("id", target.id)
      .in("status", ["REQUESTED", "RESPONDED"]);

    if (closeOthersError) {
      return errorResponse(500, `quote target close failed: ${closeOthersError.message}`);
    }

    const { data: selectedTarget, error: selectTargetError } = await supabaseAdmin
      .from("quote_request_targets")
      .update({
        status: "SELECTED",
        selected_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", target.id)
      .eq("quote_request_id", quoteRequestId)
      .select("id, quote_request_id, shop_id, status, sent_at, responded_at, selected_at, created_at, updated_at")
      .single();

    if (selectTargetError) {
      return errorResponse(500, `quote target select failed: ${selectTargetError.message}`);
    }

    return jsonResponse(200, {
      ok: true,
      quote_request: updatedRequest,
      selected_target: selectedTarget,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (message.includes("_id")) {
      return errorResponse(400, message);
    }
    return errorResponse(401, message);
  }
});
