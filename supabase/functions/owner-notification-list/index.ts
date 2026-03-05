import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import { corsHeaders } from "../_shared/cors.ts";
import { errorResponse, jsonResponse } from "../_shared/http.ts";
import { requireOwnerAuthUserId } from "../_shared/owner-auth.ts";
import { parseLimit } from "../_shared/quote.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";

type OwnerNotificationRow = {
  id: string;
  shop_id: string;
  type: string;
  title: string;
  description: string;
  source_table: string;
  source_id: string;
  source_event: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

function toUiType(type: string): "booking" | "quote" | "payment" | "system" {
  switch (type) {
    case "BOOKING_CREATED":
      return "booking";
    case "QUOTE_REQUEST_CREATED":
      return "quote";
    case "PAYMENT_RECORDED":
      return "payment";
    default:
      return "system";
  }
}

function toHref(type: string): string | undefined {
  switch (type) {
    case "BOOKING_CREATED":
    case "PAYMENT_RECORDED":
      return "/bookings";
    case "QUOTE_REQUEST_CREATED":
      return "/chat";
    default:
      return undefined;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "GET") return errorResponse(405, "Method not allowed");

  try {
    const userId = await requireOwnerAuthUserId(req);
    const url = new URL(req.url);
    const limit = parseLimit(url.searchParams.get("limit"), 40, 1, 100);
    const unreadOnly = (url.searchParams.get("unread_only") ?? "false").toLowerCase() === "true";

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
      return jsonResponse(200, { items: [], unread_count: 0 });
    }

    const fetchLimit = Math.max(limit * 3, 120);
    const { data: notificationRows, error: notificationError } = await supabaseAdmin
      .from("owner_notifications")
      .select("id, shop_id, type, title, description, source_table, source_id, source_event, metadata, created_at")
      .in("shop_id", shopIds)
      .order("created_at", { ascending: false })
      .limit(fetchLimit);

    if (notificationError) {
      return errorResponse(500, `notification lookup failed: ${notificationError.message}`);
    }

    const notifications = (notificationRows ?? []) as OwnerNotificationRow[];
    if (notifications.length === 0) {
      return jsonResponse(200, { items: [], unread_count: 0 });
    }

    const ids = notifications.map((item) => item.id);
    const { data: readRows, error: readError } = await supabaseAdmin
      .from("owner_notification_reads")
      .select("notification_id")
      .eq("user_id", userId)
      .in("notification_id", ids);

    if (readError) {
      return errorResponse(500, `notification read lookup failed: ${readError.message}`);
    }

    const readIds = new Set(
      ((readRows ?? []) as Array<{ notification_id: string }>).map((row) => row.notification_id),
    );

    const mapped = notifications.map((item) => ({
      id: item.id,
      type: toUiType(item.type),
      title: item.title,
      description: item.description,
      created_at: item.created_at,
      is_read: readIds.has(item.id),
      href: toHref(item.type),
      source_table: item.source_table,
      source_id: item.source_id,
      source_event: item.source_event,
      metadata: item.metadata ?? {},
    }));

    const filtered = unreadOnly ? mapped.filter((item) => !item.is_read) : mapped;
    const limited = filtered.slice(0, limit);
    const unreadCount = mapped.filter((item) => !item.is_read).length;

    return jsonResponse(200, {
      items: limited,
      unread_count: unreadCount,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (message.includes("limit")) {
      return errorResponse(400, message);
    }
    return errorResponse(401, message);
  }
});
