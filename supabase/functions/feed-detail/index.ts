import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  errorResponse,
  getBearerToken,
  jsonResponse,
} from "../_shared/http.ts";
import { verifyAccessJwt } from "../_shared/jwt.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";

type FeedPost = {
  id: string;
  title: string;
  thumbnail_url: string;
  shop_id: string | null;
  like_count: number;
  is_reservable: boolean;
  style_tags: string[] | null;
  studio_name: string;
  location_text: string;
  distance_km: number | null;
  original_price: number;
  discounted_price: number;
  duration_min: number;
  description: string;
  review_count: number;
  rating_avg: number;
  created_at: string;
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "GET") return errorResponse(405, "Method not allowed");

  try {
    const userId = await requireUserId(req);
    const url = new URL(req.url);
    const postId = url.searchParams.get("post_id")?.trim().toLowerCase() ?? "";
    if (!isUuid(postId)) return errorResponse(400, "post_id must be uuid");

    const { data: post, error: postError } = await supabaseAdmin
      .from("feed_posts")
      .select(
        "id, title, thumbnail_url, like_count, is_reservable, style_tags, studio_name, location_text, distance_km, original_price, discounted_price, duration_min, description, review_count, rating_avg, created_at",
      )
      .eq("id", postId)
      .eq("status", "active")
      .maybeSingle();

    if (postError) return errorResponse(500, `feed post lookup failed: ${postError.message}`);
    if (!post) return errorResponse(404, "feed post not found");

    const [
      { data: images, error: imagesError },
      { data: reviews, error: reviewsError },
      { data: like, error: likeError },
      { data: reference, error: referenceError },
    ] = await Promise.all([
      supabaseAdmin
        .from("feed_post_images")
        .select("image_url")
        .eq("post_id", postId)
        .order("sort_order", { ascending: true }),
      supabaseAdmin
        .from("feed_post_reviews")
        .select("user_name, rating, comment, created_at")
        .eq("post_id", postId)
        .order("created_at", { ascending: false })
        .limit(3),
      supabaseAdmin
        .from("bookmarks")
        .select("reference_id")
        .eq("reference_id", postId)
        .eq("user_id", userId)
        .maybeSingle(),
      supabaseAdmin
        .from("references")
        .select("shop_id")
        .eq("id", postId)
        .maybeSingle(),
    ]);

    if (imagesError) return errorResponse(500, `feed images lookup failed: ${imagesError.message}`);
    if (reviewsError) return errorResponse(500, `feed reviews lookup failed: ${reviewsError.message}`);
    if (likeError && likeError.code !== "PGRST116") {
      return errorResponse(500, `feed like lookup failed: ${likeError.message}`);
    }
    if (referenceError && referenceError.code !== "PGRST116") {
      return errorResponse(500, `reference lookup failed: ${referenceError.message}`);
    }

    const galleryImageURLs = (images ?? [])
      .map((row) => (row as { image_url?: string }).image_url)
      .filter((v): v is string => !!v && v.length > 0);

    const postData = post as FeedPost;

    return jsonResponse(200, {
      post: {
        id: postData.id,
        title: postData.title,
        thumbnail_url: postData.thumbnail_url,
        shop_id: reference?.shop_id ?? null,
        like_count: postData.like_count,
        is_reservable: postData.is_reservable,
        is_liked: !!like,
        style_tags: postData.style_tags ?? [],
        studio_name: postData.studio_name,
        location_text: postData.location_text,
        distance_km: postData.distance_km,
        original_price: postData.original_price,
        discounted_price: postData.discounted_price,
        duration_min: postData.duration_min,
        description: postData.description,
        review_count: postData.review_count,
        rating_avg: postData.rating_avg,
        created_at: postData.created_at,
      },
      gallery_image_urls: galleryImageURLs,
      recent_reviews: (reviews ?? []).map((row) => {
        const review = row as {
          user_name: string;
          rating: number;
          comment: string;
          created_at: string;
        };
        return {
          user_name: review.user_name,
          rating: review.rating,
          comment: review.comment,
          created_at: review.created_at,
        };
      }),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return errorResponse(401, message);
  }
});
