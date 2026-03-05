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
  address_detail: string | null;
  phone: string | null;
  status: string;
};

type ShopSettingRow = {
  intro: string | null;
  open_time: string | null;
  close_time: string | null;
  closed_weekdays: string[] | null;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
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
  if (req.method !== "GET") return errorResponse(405, "Method not allowed");

  try {
    await requireUserId(req);

    const url = new URL(req.url);
    const shopId = url.searchParams.get("shop_id")?.trim().toLowerCase() ?? "";
    if (!isUuid(shopId)) return errorResponse(400, "shop_id must be uuid");

    const { data: shop, error: shopError } = await supabaseAdmin
      .from("shops")
      .select("id, name, address, address_detail, phone, status")
      .eq("id", shopId)
      .maybeSingle();

    if (shopError) return errorResponse(500, `shop lookup failed: ${shopError.message}`);
    if (!shop) return errorResponse(404, "shop not found");

    const { data: setting, error: settingError } = await supabaseAdmin
      .from("shop_settings")
      .select("intro, open_time, close_time, closed_weekdays")
      .eq("shop_id", shopId)
      .maybeSingle();

    if (settingError && settingError.code !== "PGRST116") {
      return errorResponse(500, `shop settings lookup failed: ${settingError.message}`);
    }

    const shopData = shop as ShopRow;
    const settingData = setting as ShopSettingRow | null;

    return jsonResponse(200, {
      shop: {
        id: shopData.id,
        name: shopData.name,
        address: shopData.address,
        address_detail: shopData.address_detail,
        phone: shopData.phone,
        status: shopData.status,
        intro: settingData?.intro ?? null,
        open_time: settingData?.open_time ?? null,
        close_time: settingData?.close_time ?? null,
        closed_weekdays: settingData?.closed_weekdays ?? [],
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return errorResponse(401, message);
  }
});
