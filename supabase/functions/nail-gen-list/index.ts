import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  errorResponse,
  getBearerToken,
  jsonResponse,
} from "../_shared/http.ts";
import { verifyAccessJwt } from "../_shared/jwt.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { requireEnv } from "../_shared/env.ts";

const RESULT_BUCKET = "nail-results-private";
const THUMBNAIL_BUCKET = "nail-results-thumb-public";
const RESULT_URL_EXPIRES_SEC = 10 * 60;

type CursorPayload = {
  created_at: string;
  id: string;
};

type NailGenerationRow = {
  id: string;
  result_object_path: string | null;
  result_thumbnail_object_path: string | null;
  shape: string | null;
  extension_mode: string | null;
  created_at: string;
  parent_job_id: string | null;
  refinement_turn: number | null;
};

type NailGenerationLikeRow = {
  job_id: string;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
}

function parseLimit(raw: string | null): number {
  if (!raw) return 20;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 50) {
    throw new Error("limit must be integer between 1 and 50");
  }
  return n;
}

function parseLikedOnly(raw: string | null): boolean {
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") return true;
  if (normalized === "0" || normalized === "false") return false;
  throw new Error("liked_only must be boolean");
}

function decodeCursor(raw: string | null): CursorPayload | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(atob(raw));
  } catch {
    throw new Error("cursor is invalid");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("cursor is invalid");
  }

  const createdAt = (parsed as Record<string, unknown>)["created_at"];
  const id = (parsed as Record<string, unknown>)["id"];
  if (
    typeof createdAt !== "string" ||
    Number.isNaN(Date.parse(createdAt)) ||
    typeof id !== "string" ||
    !isUuid(id)
  ) {
    throw new Error("cursor is invalid");
  }

  return {
    created_at: createdAt,
    id: id.toLowerCase(),
  };
}

function encodeCursor(payload: CursorPayload): string {
  return btoa(JSON.stringify(payload));
}

function absolutizeSignedUrl(signedUrl: string): string {
  if (signedUrl.startsWith("http://") || signedUrl.startsWith("https://")) {
    return signedUrl;
  }

  const supabaseUrl = requireEnv("SUPABASE_URL").replace(/\/+$/, "");
  if (signedUrl.startsWith("/storage/v1/")) return `${supabaseUrl}${signedUrl}`;
  if (signedUrl.startsWith("/object/")) return `${supabaseUrl}/storage/v1${signedUrl}`;
  if (signedUrl.startsWith("/")) return `${supabaseUrl}${signedUrl}`;
  return `${supabaseUrl}/${signedUrl}`;
}

function publicObjectUrl(bucket: string, objectPath: string): string {
  const supabaseUrl = requireEnv("SUPABASE_URL").replace(/\/+$/, "");
  const encodedPath = objectPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${encodedPath}`;
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
    const userId = await requireUserId(req);
    const url = new URL(req.url);
    const limit = parseLimit(url.searchParams.get("limit"));
    const likedOnly = parseLikedOnly(url.searchParams.get("liked_only"));
    const cursor = decodeCursor(url.searchParams.get("cursor"));
    const fetchLimit = Math.min(200, limit + 40);

    const { data: likeRows, error: likeError } = await supabaseAdmin
      .from("nail_generation_likes")
      .select("job_id")
      .eq("user_id", userId);
    if (likeError) return errorResponse(500, `liked lookup failed: ${likeError.message}`);

    const likedJobIDs = new Set(
      ((likeRows ?? []) as NailGenerationLikeRow[])
        .map((row) => row.job_id.toLowerCase()),
    );
    if (likedOnly && likedJobIDs.size === 0) {
      return jsonResponse(200, { items: [], next_cursor: null });
    }

    let query = supabaseAdmin
      .from("nail_generation_jobs")
      .select(
        "id, result_object_path, result_thumbnail_object_path, shape, extension_mode, created_at, parent_job_id, refinement_turn",
      )
      .eq("user_id", userId)
      .eq("status", "completed")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(fetchLimit);

    if (likedOnly) {
      query = query.in("id", Array.from(likedJobIDs));
    }

    const { data, error } = await query;
    if (error) return errorResponse(500, `job list lookup failed: ${error.message}`);

    const sourceRows = (data ?? []) as NailGenerationRow[];
    const filteredRows = sourceRows.filter((row) => {
      if (!cursor) return true;

      const cmpTime = row.created_at.localeCompare(cursor.created_at);
      if (cmpTime < 0) return true;
      if (cmpTime > 0) return false;
      return row.id.toLowerCase() < cursor.id;
    });
    const pageRows = filteredRows.slice(0, limit);

    const items = await Promise.all(pageRows.map(async (row) => {
      const thumbnailImageUrl = row.result_thumbnail_object_path
        ? publicObjectUrl(THUMBNAIL_BUCKET, row.result_thumbnail_object_path)
        : null;

      if (!row.result_object_path) {
        return {
          job_id: row.id,
          result_image_url: null,
          thumbnail_image_url: thumbnailImageUrl,
          shape: row.shape,
          extension_mode: row.extension_mode,
          created_at: row.created_at,
          parent_job_id: row.parent_job_id,
          refinement_turn: row.refinement_turn ?? 0,
          is_liked: likedJobIDs.has(row.id.toLowerCase()),
        };
      }

      const { data: signed, error: signedError } = await supabaseAdmin.storage
        .from(RESULT_BUCKET)
        .createSignedUrl(row.result_object_path, RESULT_URL_EXPIRES_SEC);
      if (signedError || !signed?.signedUrl) {
        throw new Error(`createSignedUrl failed: ${signedError?.message ?? "unknown"}`);
      }

      return {
        job_id: row.id,
        result_image_url: absolutizeSignedUrl(signed.signedUrl),
        thumbnail_image_url: thumbnailImageUrl ?? absolutizeSignedUrl(signed.signedUrl),
        shape: row.shape,
        extension_mode: row.extension_mode,
        created_at: row.created_at,
        parent_job_id: row.parent_job_id,
        refinement_turn: row.refinement_turn ?? 0,
        is_liked: likedJobIDs.has(row.id.toLowerCase()),
      };
    }));

    const nextCursor = pageRows.length === limit
      ? (() => {
        const last = pageRows[pageRows.length - 1];
        return encodeCursor({
          created_at: last.created_at,
          id: last.id.toLowerCase(),
        });
      })()
      : null;

    return jsonResponse(200, {
      items,
      next_cursor: nextCursor,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (
      message.includes("limit") ||
      message.includes("cursor") ||
      message.includes("liked_only")
    ) {
      return errorResponse(400, message);
    }
    if (message.includes("createSignedUrl failed")) {
      return errorResponse(500, message);
    }
    return errorResponse(401, message);
  }
});
