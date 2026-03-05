import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { errorResponse, jsonResponse } from "../_shared/http.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";

type AppRuntimeFlagRow = {
  value: string;
  updated_at: string | null;
};

const SOCIAL_LOGIN_UI_FLAG_KEY = "social_login_ui_variant";
const DEFAULT_VARIANT = "circular";

function normalizeVariant(value: string | null | undefined): "circular" | "official" {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "official") {
    return "official";
  }
  return "circular";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return errorResponse(405, "Method not allowed", "APP_CONFIG_METHOD_NOT_ALLOWED");
  }

  const { data, error } = await supabaseAdmin
    .from("app_runtime_flags")
    .select("value, updated_at")
    .eq("key", SOCIAL_LOGIN_UI_FLAG_KEY)
    .maybeSingle();

  if (error) {
    return errorResponse(500, `app config lookup failed: ${error.message}`, "APP_CONFIG_LOOKUP_FAILED");
  }

  const row = (data as AppRuntimeFlagRow | null) ?? null;
  const socialLoginUIVariant = normalizeVariant(row?.value ?? DEFAULT_VARIANT);

  return jsonResponse(200, {
    social_login_ui_variant: socialLoginUIVariant,
    updated_at: row?.updated_at ?? null,
  });
});
