import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import { corsHeaders } from "../_shared/cors.ts";
import { errorResponse, jsonResponse } from "../_shared/http.ts";
import { requireOwnerAuthUserId } from "../_shared/owner-auth.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return errorResponse(405, "Method not allowed");

  try {
    const userId = await requireOwnerAuthUserId(req);

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
      return jsonResponse(200, { ok: true, marked_count: 0 });
    }

    const { data: notificationRows, error: notificationError } = await supabaseAdmin
      .from("owner_notifications")
      .select("id")
      .in("shop_id", shopIds)
      .order("created_at", { ascending: false })
      .limit(1000);

    if (notificationError) {
      return errorResponse(500, `notification lookup failed: ${notificationError.message}`);
    }

    const notificationIds = ((notificationRows ?? []) as Array<{ id: string }>).map((row) => row.id);

    if (notificationIds.length === 0) {
      return jsonResponse(200, { ok: true, marked_count: 0 });
    }

    const nowIso = new Date().toISOString();
    const payload = notificationIds.map((notificationId) => ({
      notification_id: notificationId,
      user_id: userId,
      read_at: nowIso,
      updated_at: nowIso,
    }));

    const { error: upsertError } = await supabaseAdmin
      .from("owner_notification_reads")
      .upsert(payload, { onConflict: "notification_id,user_id" });

    if (upsertError) {
      return errorResponse(500, `mark all read failed: ${upsertError.message}`);
    }

    return jsonResponse(200, {
      ok: true,
      marked_count: payload.length,
      read_at: nowIso,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return errorResponse(401, message);
  }
});
