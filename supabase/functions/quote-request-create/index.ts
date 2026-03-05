import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { errorResponse, jsonResponse, readJson } from "../_shared/http.ts";
import {
  listVerifiedShopIdsByRegionScope,
  parseIsoDate,
  parseRequiredText,
  parseUuid,
  requireAuthUserId,
  resolveRegionScopeIds,
} from "../_shared/quote.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";

type QuoteRequestCreateBody = {
  job_id?: string;
  target_mode?: string;
  region_id?: string;
  selected_shop_ids?: string[];
  preferred_date?: string;
  request_note?: string;
};

type NailGenerationRow = {
  id: string;
  user_id: string;
  status: string;
};

type ShopRow = {
  id: string;
  region_id: string | null;
  status: string;
};

function parseTargetMode(raw: string | undefined): "REGION_ALL" | "SELECTED_SHOPS" {
  const value = raw?.trim().toUpperCase() ?? "";
  if (value === "REGION_ALL" || value === "SELECTED_SHOPS") {
    return value;
  }
  throw new Error("target_mode must be REGION_ALL or SELECTED_SHOPS");
}

function parseSelectedShopIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    throw new Error("selected_shop_ids must be array");
  }

  const normalized = raw
    .map((item) => {
      if (typeof item !== "string") return "";
      return item.trim().toLowerCase();
    })
    .filter((item) => item.length > 0)
    .map((item) => parseUuid(item, "selected_shop_ids[]"));

  return [...new Set(normalized)];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return errorResponse(405, "Method not allowed");

  try {
    const userId = await requireAuthUserId(req);
    const body = await readJson<QuoteRequestCreateBody>(req);

    const jobId = parseUuid(body.job_id, "job_id");
    const targetMode = parseTargetMode(body.target_mode);
    const regionId = parseUuid(body.region_id, "region_id");
    const preferredDate = parseIsoDate(body.preferred_date, "preferred_date");
    const requestNote = parseRequiredText(body.request_note, "request_note", 1000);

    const { data: jobRow, error: jobError } = await supabaseAdmin
      .from("nail_generation_jobs")
      .select("id, user_id, status")
      .eq("id", jobId)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .maybeSingle();

    if (jobError) return errorResponse(500, `job lookup failed: ${jobError.message}`);
    if (!jobRow) return errorResponse(404, "job not found");

    const job = jobRow as NailGenerationRow;
    if (job.status !== "completed") {
      return errorResponse(400, "job is not completed");
    }

    const regionScopeIds = await resolveRegionScopeIds(regionId);

    let targetShopIds: string[] = [];
    if (targetMode === "REGION_ALL") {
      targetShopIds = await listVerifiedShopIdsByRegionScope(regionId);
      if (targetShopIds.length === 0) {
        return errorResponse(404, "no target shop found in region scope");
      }
    } else {
      const selectedShopIds = parseSelectedShopIds(body.selected_shop_ids);
      if (selectedShopIds.length === 0) {
        return errorResponse(400, "selected_shop_ids is required for SELECTED_SHOPS");
      }
      if (selectedShopIds.length > 50) {
        return errorResponse(400, "selected_shop_ids length must be <= 50");
      }

      const { data: shopRows, error: shopError } = await supabaseAdmin
        .from("shops")
        .select("id, region_id, status")
        .in("id", selectedShopIds);

      if (shopError) {
        return errorResponse(500, `shop lookup failed: ${shopError.message}`);
      }

      const rows = (shopRows ?? []) as ShopRow[];
      if (rows.length !== selectedShopIds.length) {
        return errorResponse(404, "some selected shops not found");
      }

      const outOfRegion = rows.some((row) => !row.region_id || !regionScopeIds.includes(row.region_id));
      if (outOfRegion) {
        return errorResponse(400, "selected shops must belong to selected region scope");
      }

      const inactive = rows.some((row) => row.status !== "VERIFIED");
      if (inactive) {
        return errorResponse(400, "selected shops must be verified");
      }

      targetShopIds = rows.map((row) => row.id);
    }

    const { data: insertedRequest, error: requestInsertError } = await supabaseAdmin
      .from("quote_requests")
      .insert({
        user_id: userId,
        ai_generation_job_id: jobId,
        target_mode: targetMode,
        region_id: regionId,
        preferred_date: preferredDate,
        request_note: requestNote,
        status: "OPEN",
      })
      .select("id, user_id, ai_generation_job_id, target_mode, region_id, preferred_date, request_note, status, selected_target_id, created_at, updated_at")
      .single();

    if (requestInsertError || !insertedRequest) {
      return errorResponse(500, `quote request insert failed: ${requestInsertError?.message ?? "unknown"}`);
    }

    const requestId = (insertedRequest as { id: string }).id;

    const targetRows = targetShopIds.map((shopId) => ({
      quote_request_id: requestId,
      shop_id: shopId,
      status: "REQUESTED",
    }));

    const { data: insertedTargets, error: targetInsertError } = await supabaseAdmin
      .from("quote_request_targets")
      .insert(targetRows)
      .select("id, quote_request_id, shop_id, status, sent_at, responded_at, selected_at");

    if (targetInsertError) {
      await supabaseAdmin.from("quote_requests").delete().eq("id", requestId);
      return errorResponse(500, `quote request target insert failed: ${targetInsertError.message}`);
    }

    return jsonResponse(200, {
      ok: true,
      quote_request: insertedRequest,
      targets: insertedTargets ?? [],
      target_count: (insertedTargets ?? []).length,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (
      message.includes("target_mode") ||
      message.includes("region") ||
      message.includes("preferred_date") ||
      message.includes("request_note") ||
      message.includes("selected_shop_ids") ||
      message.includes("job_id")
    ) {
      return errorResponse(400, message);
    }
    if (message.includes("not found")) {
      return errorResponse(404, message);
    }
    return errorResponse(401, message);
  }
});
