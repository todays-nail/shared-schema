import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { errorResponse, jsonResponse } from "../_shared/http.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";

type StyleAssetRow = {
  style_key: string;
  image_url: string;
  updated_at: string;
};

const STYLE_KEY_ORDER = [
  "office_minimal",
  "natural",
  "lovely",
  "hip",
  "chic_modern",
  "kitsh_unique",
  "glitter_pearl",
  "french",
  "gradient_ombre",
  "wedding",
  "season_spring",
  "point-art",
] as const;

type StyleKey = (typeof STYLE_KEY_ORDER)[number];

const STYLE_KEY_INDEX = new Map<StyleKey, number>(
  STYLE_KEY_ORDER.map((key, index) => [key, index]),
);

function computeLatestUpdatedAt(rows: StyleAssetRow[]): string | null {
  let latest: string | null = null;
  let latestMs = -1;

  for (const row of rows) {
    const ms = Date.parse(row.updated_at);
    if (!Number.isFinite(ms)) continue;
    if (ms > latestMs) {
      latestMs = ms;
      latest = row.updated_at;
    }
  }

  return latest;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return errorResponse(
      405,
      "Method not allowed",
      "ONBOARDING_STYLES_METHOD_NOT_ALLOWED",
    );
  }

  const { data, error } = await supabaseAdmin
    .from("onboarding_style_assets")
    .select("style_key, image_url, updated_at");

  if (error) {
    return errorResponse(
      500,
      `onboarding style lookup failed: ${error.message}`,
      "ONBOARDING_STYLES_LOOKUP_FAILED",
    );
  }

  const rows = ((data ?? []) as StyleAssetRow[])
    .filter(
      (row): row is StyleAssetRow & { style_key: StyleKey } =>
        STYLE_KEY_INDEX.has(row.style_key as StyleKey),
    )
    .sort((a, b) => {
      const aIndex = STYLE_KEY_INDEX.get(a.style_key) ?? Number.MAX_SAFE_INTEGER;
      const bIndex = STYLE_KEY_INDEX.get(b.style_key) ?? Number.MAX_SAFE_INTEGER;
      return aIndex - bIndex;
    });

  const styles = rows.map((row) => ({
    key: row.style_key,
    image_url: row.image_url,
    updated_at: row.updated_at,
  }));

  return jsonResponse(200, {
    styles,
    updated_at: computeLatestUpdatedAt(rows),
  });
});
