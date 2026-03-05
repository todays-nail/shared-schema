import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  errorResponse,
  getBearerToken,
  jsonResponse,
} from "../_shared/http.ts";
import { verifyAccessJwt } from "../_shared/jwt.ts";
import {
  buildRegionTree,
  fetchAllRegions,
  fetchLatestRegionSyncMeta,
  isUuid,
} from "../_shared/regions.ts";

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

  if (req.method !== "GET") {
    return errorResponse(405, "Method not allowed");
  }

  try {
    await requireUserId(req);

    const [rows, latestSyncMeta] = await Promise.all([
      fetchAllRegions(),
      fetchLatestRegionSyncMeta(),
    ]);

    const roots = buildRegionTree(rows);

    return jsonResponse(200, {
      roots,
      version: latestSyncMeta?.source_version ?? "unknown",
      synced_at: latestSyncMeta?.synced_at ?? null,
    });
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
