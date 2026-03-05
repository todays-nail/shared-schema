import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { errorResponse, jsonResponse } from "../_shared/http.ts";
import {
  createSignedObjectUrl,
  parseUuid,
  requireAuthUserId,
} from "../_shared/quote.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";

type QuoteRequestRow = {
  id: string;
  user_id: string;
  ai_generation_job_id: string;
  target_mode: string;
  region_id: string;
  preferred_date: string;
  request_note: string;
  status: string;
  selected_target_id: string | null;
  created_at: string;
  updated_at: string;
};

type ShopRow = {
  id: string;
  name: string;
  address: string;
};

type QuoteResponseRow = {
  id: string;
  target_id: string;
  final_price: number;
  change_items: string[];
  memo: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type QuoteTargetJoinedRow = {
  id: string;
  quote_request_id: string;
  shop_id: string;
  status: string;
  sent_at: string;
  responded_at: string | null;
  selected_at: string | null;
  shops: unknown;
  quote_responses: unknown;
};

type NailGenerationAssetRow = {
  hand_object_path: string | null;
  reference_object_path: string | null;
  result_object_path: string | null;
};

function firstObject<T>(value: unknown): T | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    return (value[0] as T | undefined) ?? null;
  }
  return value as T;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "GET") return errorResponse(405, "Method not allowed");

  try {
    const userId = await requireAuthUserId(req);
    const url = new URL(req.url);
    const quoteRequestId = parseUuid(url.searchParams.get("quote_request_id"), "quote_request_id");

    const { data: requestRow, error: requestError } = await supabaseAdmin
      .from("quote_requests")
      .select("id, user_id, ai_generation_job_id, target_mode, region_id, preferred_date, request_note, status, selected_target_id, created_at, updated_at")
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

    const { data: targetRows, error: targetError } = await supabaseAdmin
      .from("quote_request_targets")
      .select(
        "id, quote_request_id, shop_id, status, sent_at, responded_at, selected_at, shops(id, name, address), quote_responses(id, target_id, final_price, change_items, memo, created_by, created_at, updated_at)",
      )
      .eq("quote_request_id", quoteRequestId)
      .order("sent_at", { ascending: true });

    if (targetError) {
      return errorResponse(500, `quote target lookup failed: ${targetError.message}`);
    }

    const { data: assetRow, error: assetError } = await supabaseAdmin
      .from("nail_generation_jobs")
      .select("hand_object_path, reference_object_path, result_object_path")
      .eq("id", request.ai_generation_job_id)
      .is("deleted_at", null)
      .maybeSingle();

    if (assetError) {
      return errorResponse(500, `nail generation asset lookup failed: ${assetError.message}`);
    }
    if (!assetRow) {
      return errorResponse(404, "quote request not found");
    }

    const assets = assetRow as NailGenerationAssetRow;

    const userHandImage = await createSignedObjectUrl("nail-inputs-private", assets.hand_object_path);
    const aiInputHandImage = await createSignedObjectUrl("nail-inputs-private", assets.hand_object_path);
    const aiResultImage = await createSignedObjectUrl("nail-results-private", assets.result_object_path);
    const aiReferenceImage = await createSignedObjectUrl("nail-inputs-private", assets.reference_object_path);

    const items = ((targetRows ?? []) as QuoteTargetJoinedRow[]).map((row) => {
      const shop = firstObject<ShopRow>(row.shops);
      const response = firstObject<QuoteResponseRow>(row.quote_responses);

      return {
        target_id: row.id,
        target_status: row.status,
        sent_at: row.sent_at,
        responded_at: row.responded_at,
        selected_at: row.selected_at,
        shop: shop
          ? {
            id: shop.id,
            name: shop.name,
            address: shop.address,
          }
          : null,
        response: response
          ? {
            id: response.id,
            target_id: response.target_id,
            final_price: response.final_price,
            change_items: response.change_items ?? [],
            memo: response.memo,
            created_by: response.created_by,
            created_at: response.created_at,
            updated_at: response.updated_at,
          }
          : null,
      };
    });

    return jsonResponse(200, {
      quote_request: request,
      images: {
        user_hand_image: userHandImage,
        ai_input_hand_image: aiInputHandImage,
        ai_result_image: aiResultImage,
        ai_reference_image: aiReferenceImage,
      },
      responses: items,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (message.includes("quote_request_id")) {
      return errorResponse(400, message);
    }
    return errorResponse(401, message);
  }
});
