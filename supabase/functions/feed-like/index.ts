import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  errorResponse,
  getBearerToken,
  jsonResponse,
  readJson,
} from "../_shared/http.ts";
import { verifyAccessJwt } from "../_shared/jwt.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";

type FeedLikeBody = {
  post_id?: string;
};

type FeedLikeState = {
  is_liked: boolean;
  like_count: number;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
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

async function loadLikeState(userId: string, postId: string): Promise<FeedLikeState | Response> {
  const [{ data: like, error: likeError }, { data: post, error: postError }] = await Promise.all([
    supabaseAdmin
      .from("bookmarks")
      .select("reference_id")
      .eq("user_id", userId)
      .eq("reference_id", postId)
      .maybeSingle(),
    supabaseAdmin
      .from("feed_posts")
      .select("like_count")
      .eq("id", postId)
      .single(),
  ]);

  if (likeError && likeError.code !== "PGRST116") {
    return errorResponse(500, `feed like lookup failed: ${likeError.message}`);
  }

  if (postError) {
    return errorResponse(500, `feed post lookup failed: ${postError.message}`);
  }

  return {
    is_liked: !!like,
    like_count: (post as { like_count?: number } | null)?.like_count ?? 0,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST" && req.method !== "DELETE") {
    return errorResponse(405, "Method not allowed");
  }

  try {
    const userId = await requireUserId(req);
    const body = await readJson<FeedLikeBody>(req);
    const postId = body.post_id?.trim().toLowerCase() ?? "";

    if (!isUuid(postId)) {
      return errorResponse(400, "post_id must be uuid");
    }

    const { data: post, error: postError } = await supabaseAdmin
      .from("feed_posts")
      .select("id")
      .eq("id", postId)
      .eq("status", "active")
      .maybeSingle();

    if (postError) {
      return errorResponse(500, `feed post lookup failed: ${postError.message}`);
    }

    if (!post) {
      return errorResponse(404, "feed post not found");
    }

    if (req.method === "POST") {
      const { data: existingLike, error: existingLikeError } = await supabaseAdmin
        .from("bookmarks")
        .select("reference_id")
        .eq("user_id", userId)
        .eq("reference_id", postId)
        .maybeSingle();

      if (existingLikeError && existingLikeError.code !== "PGRST116") {
        return errorResponse(500, `feed like lookup failed: ${existingLikeError.message}`);
      }

      if (!existingLike) {
        const { error: insertError } = await supabaseAdmin
          .from("bookmarks")
          .insert({
            user_id: userId,
            reference_id: postId,
          });

        if (insertError) {
          return errorResponse(500, `feed like save failed: ${insertError.message}`);
        }
      }
    } else {
      const { error: deleteError } = await supabaseAdmin
        .from("bookmarks")
        .delete()
        .eq("user_id", userId)
        .eq("reference_id", postId);

      if (deleteError) {
        return errorResponse(500, `feed like delete failed: ${deleteError.message}`);
      }
    }

    const likeState = await loadLikeState(userId, postId);
    if (likeState instanceof Response) {
      return likeState;
    }

    return jsonResponse(200, {
      ok: true,
      post_id: postId,
      is_liked: likeState.is_liked,
      like_count: likeState.like_count,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return errorResponse(401, message);
  }
});
