import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { errorResponse, jsonResponse } from "../_shared/http.ts";
import { requireOwnerAuthUserId } from "../_shared/owner-auth.ts";
import {
  createSignedObjectUrl,
  parseLimit,
} from "../_shared/quote.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";

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

type QuoteTargetJoinedRow = {
  id: string;
  quote_request_id: string;
  shop_id: string;
  status: string;
  sent_at: string;
  responded_at: string | null;
  selected_at: string | null;
  quote_requests: unknown;
  quote_responses: unknown;
  shops: unknown;
};

type NailGenerationAssetRow = {
  id: string;
  hand_object_path: string | null;
  reference_object_path: string | null;
  result_object_path: string | null;
};

type UserRow = {
  id: string;
  nickname: string | null;
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
    const userId = await requireOwnerAuthUserId(req);
    const url = new URL(req.url);
    const limit = parseLimit(url.searchParams.get("limit"), 30, 1, 100);

    const { data: membershipRows, error: membershipError } = await supabaseAdmin
      .from("shop_members")
      .select("shop_id")
      .eq("user_id", userId);

    if (membershipError) {
      return errorResponse(500, `membership lookup failed: ${membershipError.message}`);
    }

    const shopIds = ((membershipRows ?? []) as Array<{ shop_id: string }>)
      .map((row) => row.shop_id)
      .filter(Boolean);

    if (shopIds.length === 0) {
      return jsonResponse(200, { items: [] });
    }

    const { data: targetRows, error: targetError } = await supabaseAdmin
      .from("quote_request_targets")
      .select(
        "id, quote_request_id, shop_id, status, sent_at, responded_at, selected_at, quote_requests!quote_request_targets_quote_request_id_fkey(id, user_id, ai_generation_job_id, target_mode, region_id, preferred_date, request_note, status, selected_target_id, created_at, updated_at), quote_responses(id, target_id, final_price, change_items, memo, created_by, created_at, updated_at), shops(id, name, address)",
      )
      .in("shop_id", shopIds)
      .order("sent_at", { ascending: false })
      .limit(limit);

    if (targetError) {
      return errorResponse(500, `quote target lookup failed: ${targetError.message}`);
    }

    const targets = (targetRows ?? []) as QuoteTargetJoinedRow[];
    if (targets.length === 0) {
      return jsonResponse(200, { items: [] });
    }

    const requestRows = targets
      .map((row) => firstObject<QuoteRequestRow>(row.quote_requests))
      .filter((row): row is QuoteRequestRow => row !== null);

    const uniqueJobIds = [...new Set(requestRows.map((row) => row.ai_generation_job_id))];
    const uniqueUserIds = [...new Set(requestRows.map((row) => row.user_id))];

    const jobAssetById = new Map<string, NailGenerationAssetRow>();
    if (uniqueJobIds.length > 0) {
      const { data: jobRows, error: jobError } = await supabaseAdmin
        .from("nail_generation_jobs")
        .select("id, hand_object_path, reference_object_path, result_object_path")
        .in("id", uniqueJobIds);

      if (jobError) {
        return errorResponse(500, `nail generation asset lookup failed: ${jobError.message}`);
      }

      for (const row of (jobRows ?? []) as NailGenerationAssetRow[]) {
        jobAssetById.set(row.id, row);
      }
    }

    const userNicknameById = new Map<string, string>();
    if (uniqueUserIds.length > 0) {
      const { data: userRows, error: userError } = await supabaseAdmin
        .from("users")
        .select("id, nickname")
        .in("id", uniqueUserIds);

      if (userError) {
        return errorResponse(500, `user lookup failed: ${userError.message}`);
      }

      for (const row of (userRows ?? []) as UserRow[]) {
        userNicknameById.set(row.id, row.nickname?.trim() || `고객 ${row.id.slice(0, 8)}`);
      }
    }

    const items = [];
    for (const target of targets) {
      const request = firstObject<QuoteRequestRow>(target.quote_requests);
      const response = firstObject<QuoteResponseRow>(target.quote_responses);
      const shop = firstObject<ShopRow>(target.shops);
      if (!request || !shop) continue;

      const assets = jobAssetById.get(request.ai_generation_job_id);
      const userHandImage = await createSignedObjectUrl("nail-inputs-private", assets?.hand_object_path ?? null);
      const aiInputHandImage = await createSignedObjectUrl("nail-inputs-private", assets?.hand_object_path ?? null);
      const aiResultImage = await createSignedObjectUrl("nail-results-private", assets?.result_object_path ?? null);
      const aiReferenceImage = await createSignedObjectUrl("nail-inputs-private", assets?.reference_object_path ?? null);

      items.push({
        target_id: target.id,
        target_status: target.status,
        sent_at: target.sent_at,
        responded_at: target.responded_at,
        selected_at: target.selected_at,
        shop: {
          id: shop.id,
          name: shop.name,
          address: shop.address,
        },
        request: {
          id: request.id,
          user_id: request.user_id,
          user_nickname: userNicknameById.get(request.user_id) ?? `고객 ${request.user_id.slice(0, 8)}`,
          ai_generation_job_id: request.ai_generation_job_id,
          target_mode: request.target_mode,
          region_id: request.region_id,
          preferred_date: request.preferred_date,
          request_note: request.request_note,
          status: request.status,
          selected_target_id: request.selected_target_id,
          created_at: request.created_at,
          updated_at: request.updated_at,
        },
        images: {
          user_hand_image: userHandImage,
          ai_input_hand_image: aiInputHandImage,
          ai_result_image: aiResultImage,
          ai_reference_image: aiReferenceImage,
        },
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
      });
    }

    return jsonResponse(200, { items });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (message.includes("limit")) {
      return errorResponse(400, message);
    }
    return errorResponse(401, message);
  }
});
