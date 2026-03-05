import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  errorResponse,
  getBearerToken,
  jsonResponse,
} from "../_shared/http.ts";
import { verifyAccessJwt } from "../_shared/jwt.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";

type RegionRow = {
  id: string;
  name: string;
  parent_id: string | null;
  level: number | null;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
}

function compareKoName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, "ko");
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

    const { data, error } = await supabaseAdmin
      .from("regions")
      .select("id, name, parent_id, level")
      .limit(5000);

    if (error) {
      return errorResponse(500, `regions lookup failed: ${error.message}`);
    }

    const rows = (data ?? []) as RegionRow[];
    const districtsByParent = new Map<string, RegionRow[]>();

    for (const row of rows) {
      if (!row.parent_id) continue;
      const list = districtsByParent.get(row.parent_id) ?? [];
      list.push(row);
      districtsByParent.set(row.parent_id, list);
    }

    const cities = rows
      .filter((row) => row.parent_id === null)
      .sort(compareKoName)
      .map((city) => {
        const districts = (districtsByParent.get(city.id) ?? [])
          .sort(compareKoName)
          .map((district) => ({
            id: district.id,
            name: district.name,
            parent_id: district.parent_id,
            level: district.level,
          }));

        return {
          id: city.id,
          name: city.name,
          parent_id: city.parent_id,
          level: city.level,
          districts,
        };
      });

    return jsonResponse(200, { cities });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (
      message.includes("missing bearer token") ||
      message.includes("invalid token payload")
    ) {
      return errorResponse(401, message);
    }
    return errorResponse(500, message);
  }
});
