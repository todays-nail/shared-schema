import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  errorResponse,
  getBearerToken,
  jsonResponse,
} from "../_shared/http.ts";
import { verifyAccessJwt } from "../_shared/jwt.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";

type ShopRow = {
  id: string;
  name: string;
  address: string;
};

type ReferenceRow = {
  id: string;
  shop_id: string;
};

type BookmarkRow = {
  reference_id: string;
};

type RankedShop = {
  id: string;
  name: string;
  address: string;
  like_count: number;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
}

function parseLimit(raw: string | null): number {
  if (!raw) return 3;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 10) {
    throw new Error("limit must be integer between 1 and 10");
  }
  return n;
}

function parseRegion(raw: string | null): string | null {
  const value = raw?.trim() ?? "";
  return value.length > 0 ? value : null;
}

function composeRegionLabel(sido: string | null, sigungu: string | null): string | null {
  if (sido && sigungu) return `${sido} ${sigungu}`;
  if (sido) return sido;
  if (sigungu) return sigungu;
  return null;
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

async function fetchCandidateShops(sido: string | null, sigungu: string | null): Promise<ShopRow[]> {
  let query = supabaseAdmin
    .from("shops")
    .select("id, name, address")
    .order("name", { ascending: true })
    .limit(5000);

  if (sido) {
    query = query.ilike("address", `%${sido}%`);
  }
  if (sigungu) {
    query = query.ilike("address", `%${sigungu}%`);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`shops lookup failed: ${error.message}`);
  }

  return (data ?? []) as ShopRow[];
}

async function rankShops(shops: ShopRow[], limit: number): Promise<RankedShop[]> {
  if (shops.length === 0) return [];

  const shopIds = shops.map((shop) => shop.id);
  const { data: references, error: referencesError } = await supabaseAdmin
    .from("references")
    .select("id, shop_id")
    .in("shop_id", shopIds)
    .limit(10000);

  if (referencesError) {
    throw new Error(`references lookup failed: ${referencesError.message}`);
  }

  const referenceRows = (references ?? []) as ReferenceRow[];
  const referenceToShop = new Map<string, string>();
  for (const row of referenceRows) {
    referenceToShop.set(row.id, row.shop_id);
  }

  const likeCountByShop = new Map<string, number>();

  if (referenceRows.length > 0) {
    const referenceIds = referenceRows.map((row) => row.id);
    const { data: bookmarks, error: bookmarksError } = await supabaseAdmin
      .from("bookmarks")
      .select("reference_id")
      .in("reference_id", referenceIds)
      .limit(50000);

    if (bookmarksError) {
      throw new Error(`bookmarks lookup failed: ${bookmarksError.message}`);
    }

    for (const bookmark of (bookmarks ?? []) as BookmarkRow[]) {
      const shopId = referenceToShop.get(bookmark.reference_id);
      if (!shopId) continue;
      likeCountByShop.set(shopId, (likeCountByShop.get(shopId) ?? 0) + 1);
    }
  }

  return shops
    .map((shop) => ({
      id: shop.id,
      name: shop.name,
      address: shop.address,
      like_count: likeCountByShop.get(shop.id) ?? 0,
    }))
    .sort((a, b) => {
      if (b.like_count !== a.like_count) {
        return b.like_count - a.like_count;
      }
      return a.name.localeCompare(b.name, "ko");
    })
    .slice(0, limit);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "GET") return errorResponse(405, "Method not allowed");

  try {
    await requireUserId(req);

    const url = new URL(req.url);
    const limit = parseLimit(url.searchParams.get("limit"));
    const sido = parseRegion(url.searchParams.get("sido"));
    const sigungu = parseRegion(url.searchParams.get("sigungu"));

    const regionLabel = composeRegionLabel(sido, sigungu);

    if (regionLabel) {
      const regionalShops = await fetchCandidateShops(sido, sigungu);
      const regionalRanked = await rankShops(regionalShops, limit);
      if (regionalRanked.length > 0) {
        return jsonResponse(200, {
          scope: "region",
          region_label: regionLabel,
          items: regionalRanked,
        });
      }
    }

    const nationwideShops = await fetchCandidateShops(null, null);
    const nationwideRanked = await rankShops(nationwideShops, limit);

    return jsonResponse(200, {
      scope: "nationwide",
      region_label: null,
      items: nationwideRanked,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (message.includes("limit")) {
      return errorResponse(400, message);
    }
    if (message.includes("missing bearer token") || message.includes("invalid token payload")) {
      return errorResponse(401, message);
    }
    return errorResponse(500, message);
  }
});
