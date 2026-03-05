import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  errorResponse,
  jsonResponse,
} from "../_shared/http.ts";
import {
  parseLimit,
  parseUuid,
  requireAuthUserId,
  resolveRegionScopeIds,
} from "../_shared/quote.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";

type ShopRow = {
  id: string;
  name: string;
  address: string;
  region_id: string | null;
};

function parseQuery(raw: string | null): string {
  const value = raw?.trim() ?? "";
  if (value.length === 0) throw new Error("q is required");
  return value;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "GET") return errorResponse(405, "Method not allowed");

  try {
    await requireAuthUserId(req);

    const url = new URL(req.url);
    const query = parseQuery(url.searchParams.get("q"));
    const limit = parseLimit(url.searchParams.get("limit"), 20, 1, 20);

    const rawRegionId = url.searchParams.get("region_id")?.trim();
    const regionId = rawRegionId ? parseUuid(rawRegionId, "region_id") : null;

    let queryBuilder = supabaseAdmin
      .from("shops")
      .select("id, name, address, region_id")
      .eq("status", "VERIFIED")
      .ilike("name", `%${query}%`)
      .order("name", { ascending: true })
      .limit(limit);

    if (regionId) {
      const scopeIds = await resolveRegionScopeIds(regionId);
      queryBuilder = queryBuilder.in("region_id", scopeIds);
    }

    const { data, error } = await queryBuilder;

    if (error) return errorResponse(500, `shop search failed: ${error.message}`);

    const items = ((data ?? []) as ShopRow[]).map((shop) => ({
      id: shop.id,
      name: shop.name,
      address: shop.address,
      region_id: shop.region_id,
    }));

    return jsonResponse(200, { items });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (message.includes("q") || message.includes("limit") || message.includes("region_id")) {
      return errorResponse(400, message);
    }
    return errorResponse(401, message);
  }
});
