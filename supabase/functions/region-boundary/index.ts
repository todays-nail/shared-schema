import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  errorResponse,
  getBearerToken,
  jsonResponse,
} from "../_shared/http.ts";
import { verifyAccessJwt } from "../_shared/jwt.ts";
import {
  buildRegionLookup,
  fetchAllRegions,
  fetchBoundariesByRegionIds,
  isUuid,
  resolveBoundaryWithParentFallback,
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

function parseRegionId(req: Request): string {
  const url = new URL(req.url);
  const raw = url.searchParams.get("region_id")?.trim().toLowerCase() ?? "";
  if (!isUuid(raw)) {
    throw new Error("region_id must be uuid");
  }
  return raw;
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

    const requestedRegionId = parseRegionId(req);
    const regions = await fetchAllRegions();
    const lookup = buildRegionLookup(regions);

    if (!lookup.has(requestedRegionId)) {
      return errorResponse(404, "region not found");
    }

    const chainIds: string[] = [];
    const guard = new Set<string>();
    let cursor: string | null = requestedRegionId;

    while (cursor) {
      if (guard.has(cursor)) break;
      guard.add(cursor);
      chainIds.push(cursor);
      cursor = lookup.get(cursor)?.parent_id ?? null;
    }

    const boundaryRows = await fetchBoundariesByRegionIds(chainIds);
    const boundaryByRegionId = new Map(boundaryRows.map((row) => [row.region_id, row]));
    const resolved = resolveBoundaryWithParentFallback(
      requestedRegionId,
      lookup,
      boundaryByRegionId,
    );

    if (!resolved) {
      return errorResponse(404, "region boundary not found");
    }

    return jsonResponse(200, {
      region_id: requestedRegionId,
      resolved_region_id: resolved.region_id,
      bbox: resolved.bbox,
      center: resolved.center,
      geometry: resolved.geometry,
      source: resolved.source,
      source_version: resolved.source_version,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (
      message.includes("missing bearer token") ||
      message.includes("invalid token payload")
    ) {
      return errorResponse(401, message);
    }
    if (message.includes("region_id")) {
      return errorResponse(400, message);
    }

    return errorResponse(500, message);
  }
});
