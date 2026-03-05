import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { errorResponse, jsonResponse } from "../_shared/http.ts";
import { parseLimit, requireAuthUserId } from "../_shared/quote.ts";
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

type QuoteTargetRow = {
  id: string;
  quote_request_id: string;
  shop_id: string;
  status: string;
};

type QuoteResponseRow = {
  target_id: string;
};

type ActiveNailGenerationJobRow = {
  id: string;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "GET") return errorResponse(405, "Method not allowed");

  try {
    const userId = await requireAuthUserId(req);
    const url = new URL(req.url);
    const limit = parseLimit(url.searchParams.get("limit"), 20, 1, 100);

    const { data: requestRows, error: requestError } = await supabaseAdmin
      .from("quote_requests")
      .select("id, user_id, ai_generation_job_id, target_mode, region_id, preferred_date, request_note, status, selected_target_id, created_at, updated_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (requestError) {
      return errorResponse(500, `quote request lookup failed: ${requestError.message}`);
    }

    const requests = (requestRows ?? []) as QuoteRequestRow[];
    if (requests.length === 0) {
      return jsonResponse(200, { items: [] });
    }

    const requestJobIds = [...new Set(requests.map((row) => row.ai_generation_job_id))];
    const { data: activeJobRows, error: activeJobError } = await supabaseAdmin
      .from("nail_generation_jobs")
      .select("id")
      .in("id", requestJobIds)
      .is("deleted_at", null);

    if (activeJobError) {
      return errorResponse(500, `nail generation visibility lookup failed: ${activeJobError.message}`);
    }

    const activeJobIDSet = new Set(
      ((activeJobRows ?? []) as ActiveNailGenerationJobRow[]).map((row) => row.id),
    );
    const visibleRequests = requests.filter((row) => activeJobIDSet.has(row.ai_generation_job_id));
    if (visibleRequests.length === 0) {
      return jsonResponse(200, { items: [] });
    }

    const requestIds = visibleRequests.map((row) => row.id);

    const { data: targetRows, error: targetError } = await supabaseAdmin
      .from("quote_request_targets")
      .select("id, quote_request_id, shop_id, status")
      .in("quote_request_id", requestIds);

    if (targetError) {
      return errorResponse(500, `quote target lookup failed: ${targetError.message}`);
    }

    const targets = (targetRows ?? []) as QuoteTargetRow[];
    const targetIds = targets.map((row) => row.id);

    let responses: QuoteResponseRow[] = [];
    if (targetIds.length > 0) {
      const { data: responseRows, error: responseError } = await supabaseAdmin
        .from("quote_responses")
        .select("target_id")
        .in("target_id", targetIds);

      if (responseError) {
        return errorResponse(500, `quote response lookup failed: ${responseError.message}`);
      }

      responses = (responseRows ?? []) as QuoteResponseRow[];
    }

    const responseTargetIdSet = new Set(responses.map((row) => row.target_id));

    const targetMap = new Map<string, QuoteTargetRow[]>();
    for (const target of targets) {
      const current = targetMap.get(target.quote_request_id) ?? [];
      current.push(target);
      targetMap.set(target.quote_request_id, current);
    }

    const items = visibleRequests.map((request) => {
      const requestTargets = targetMap.get(request.id) ?? [];
      const targetCount = requestTargets.length;

      const respondedCount = requestTargets.reduce((count, target) => {
        const hasResponse = responseTargetIdSet.has(target.id);
        const statusResponded = target.status === "RESPONDED" || target.status === "SELECTED";
        return hasResponse || statusResponded ? count + 1 : count;
      }, 0);

      const selectedTarget = request.selected_target_id
        ? requestTargets.find((target) => target.id === request.selected_target_id) ?? null
        : null;

      return {
        id: request.id,
        user_id: request.user_id,
        ai_generation_job_id: request.ai_generation_job_id,
        target_mode: request.target_mode,
        region_id: request.region_id,
        preferred_date: request.preferred_date,
        request_note: request.request_note,
        status: request.status,
        selected_target_id: request.selected_target_id,
        selected_shop_id: selectedTarget?.shop_id ?? null,
        target_count: targetCount,
        responded_count: respondedCount,
        created_at: request.created_at,
        updated_at: request.updated_at,
      };
    });

    return jsonResponse(200, { items });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (message.includes("limit")) {
      return errorResponse(400, message);
    }
    return errorResponse(401, message);
  }
});
