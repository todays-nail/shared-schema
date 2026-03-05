import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import { corsHeaders } from "../_shared/cors.ts";
import { errorResponse, jsonResponse, readJson } from "../_shared/http.ts";
import { requireOwnerAuthUserId } from "../_shared/owner-auth.ts";
import { parseUuid, requireShopMembership } from "../_shared/quote.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";

type OwnerNotificationMarkReadBody = {
  notification_id?: string;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return errorResponse(405, "Method not allowed");

  try {
    const userId = await requireOwnerAuthUserId(req);
    const body = await readJson<OwnerNotificationMarkReadBody>(req);
    const notificationId = parseUuid(body.notification_id, "notification_id");

    const { data: notificationRow, error: notificationError } = await supabaseAdmin
      .from("owner_notifications")
      .select("id, shop_id")
      .eq("id", notificationId)
      .maybeSingle();

    if (notificationError) {
      return errorResponse(500, `notification lookup failed: ${notificationError.message}`);
    }
    if (!notificationRow) {
      return errorResponse(404, "notification not found");
    }

    await requireShopMembership(userId, notificationRow.shop_id as string);

    const nowIso = new Date().toISOString();

    const { error: upsertError } = await supabaseAdmin
      .from("owner_notification_reads")
      .upsert(
        {
          notification_id: notificationId,
          user_id: userId,
          read_at: nowIso,
          updated_at: nowIso,
        },
        { onConflict: "notification_id,user_id" },
      );

    if (upsertError) {
      return errorResponse(500, `mark read failed: ${upsertError.message}`);
    }

    return jsonResponse(200, {
      ok: true,
      notification_id: notificationId,
      read_at: nowIso,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (message.includes("notification_id")) {
      return errorResponse(400, message);
    }
    if (message.includes("forbidden")) {
      return errorResponse(403, message);
    }
    return errorResponse(401, message);
  }
});
