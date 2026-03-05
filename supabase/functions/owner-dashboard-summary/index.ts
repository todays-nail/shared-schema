import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import { corsHeaders } from "../_shared/cors.ts";
import { errorResponse, jsonResponse } from "../_shared/http.ts";
import { requireOwnerAuthUserId } from "../_shared/owner-auth.ts";
import { parseIsoDate } from "../_shared/quote.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";

type ReservationRow = {
  id: string;
  user_id: string;
  status: string;
  slot_start_at: string;
  slots: unknown;
  references: unknown;
  users: unknown;
};

type SlotRow = {
  start_at: string;
  duration_min: number;
};

type ReferenceRow = {
  title: string | null;
};

type UserRow = {
  nickname: string | null;
};

function firstObject<T>(value: unknown): T | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    return (value[0] as T | undefined) ?? null;
  }
  return value as T;
}

function toSeoulDateKey(baseDate: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(baseDate);

  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function seoulRangeFromDateKey(dateKey: string): { startIso: string; endIso: string } {
  const start = new Date(`${dateKey}T00:00:00+09:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

function formatSeoulDateLabel(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00+09:00`);
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function formatSeoulTimeRange(startIso: string, durationMin: number): string {
  const startDate = new Date(startIso);
  const endDate = new Date(startDate.getTime() + Math.max(1, durationMin) * 60 * 1000);
  const formatter = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${formatter.format(startDate)} - ${formatter.format(endDate)}`;
}

const HIDDEN_SCHEDULE_STATUSES = new Set(["USER_CANCELLED", "SHOP_CANCELLED", "EXPIRED"]);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "GET") return errorResponse(405, "Method not allowed");

  try {
    const userId = await requireOwnerAuthUserId(req);
    const url = new URL(req.url);
    const dateParam = url.searchParams.get("date");
    const dateKey = dateParam
      ? parseIsoDate(dateParam, "date")
      : toSeoulDateKey(new Date());

    const { startIso, endIso } = seoulRangeFromDateKey(dateKey);

    const { data: membershipRows, error: membershipError } = await supabaseAdmin
      .from("shop_members")
      .select("shop_id")
      .eq("user_id", userId);

    if (membershipError) {
      return errorResponse(500, `membership lookup failed: ${membershipError.message}`);
    }

    const shopIds = ((membershipRows ?? []) as Array<{ shop_id: string }>)
      .map((row) => row.shop_id)
      .filter((id) => typeof id === "string" && id.length > 0);

    if (shopIds.length === 0) {
      return jsonResponse(200, {
        summary: {
          date: dateKey,
          date_label: formatSeoulDateLabel(dateKey),
          timezone: "Asia/Seoul",
          today_revenue: 0,
          new_bookings_count: 0,
        },
        schedule_items: [],
      });
    }

    const [
      revenueResult,
      bookingCountResult,
      scheduleResult,
    ] = await Promise.all([
      supabaseAdmin
        .from("reservation_payment_ledgers")
        .select("amount")
        .in("shop_id", shopIds)
        .gte("paid_at", startIso)
        .lt("paid_at", endIso),
      supabaseAdmin
        .from("reservations")
        .select("id", { count: "exact", head: true })
        .in("shop_id", shopIds)
        .gte("created_at", startIso)
        .lt("created_at", endIso),
      supabaseAdmin
        .from("reservations")
        .select(
          "id,user_id,status,slot_start_at,slots!inner(start_at,duration_min),references!reservations_reference_id_fkey(title),users!reservations_user_id_fkey(nickname)",
        )
        .in("shop_id", shopIds)
        .gte("slot_start_at", startIso)
        .lt("slot_start_at", endIso)
        .order("slot_start_at", { ascending: true })
        .limit(200),
    ]);

    if (revenueResult.error) {
      return errorResponse(500, `revenue lookup failed: ${revenueResult.error.message}`);
    }
    if (bookingCountResult.error) {
      return errorResponse(500, `booking count lookup failed: ${bookingCountResult.error.message}`);
    }
    if (scheduleResult.error) {
      return errorResponse(500, `schedule lookup failed: ${scheduleResult.error.message}`);
    }

    const revenueRows = (revenueResult.data ?? []) as Array<{ amount: number }>;
    const todayRevenue = revenueRows.reduce((sum, row) => sum + Math.max(0, row.amount ?? 0), 0);

    const scheduleRows = (scheduleResult.data ?? []) as ReservationRow[];
    const scheduleItems = scheduleRows
      .filter((row) => !HIDDEN_SCHEDULE_STATUSES.has(row.status))
      .map((row) => {
        const slot = firstObject<SlotRow>(row.slots);
        const reference = firstObject<ReferenceRow>(row.references);
        const user = firstObject<UserRow>(row.users);
        const slotStartAt = slot?.start_at ?? row.slot_start_at;
        const durationMin = slot?.duration_min ?? 60;

        return {
          reservation_id: row.id,
          slot_start_at: slotStartAt,
          time_range: formatSeoulTimeRange(slotStartAt, durationMin),
          customer_name: user?.nickname?.trim() || `고객 ${row.user_id.slice(0, 8)}`,
          service_name: reference?.title?.trim() || "시술",
          reservation_status: row.status,
        };
      });

    return jsonResponse(200, {
      summary: {
        date: dateKey,
        date_label: formatSeoulDateLabel(dateKey),
        timezone: "Asia/Seoul",
        today_revenue: todayRevenue,
        new_bookings_count: bookingCountResult.count ?? 0,
      },
      schedule_items: scheduleItems,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (message.includes("date")) {
      return errorResponse(400, message);
    }
    return errorResponse(401, message);
  }
});
