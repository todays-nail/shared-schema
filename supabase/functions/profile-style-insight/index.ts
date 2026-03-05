import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  errorResponse,
  getBearerToken,
  jsonResponse,
} from "../_shared/http.ts";
import { verifyAccessJwt } from "../_shared/jwt.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";

type StyleEvent = {
  type: "liked" | "service";
  created_at: string;
  tags: string[];
};

type TagScore = {
  liked_score: number;
  service_score: number;
  total_score: number;
};

type LikedRow = {
  created_at: string;
  reference_id: string;
};

type ServiceRow = {
  status: string;
  created_at: string;
  reference_id: string;
};

type CandidatePostRow = {
  id: string;
  thumbnail_url: string;
  style_tags: string[] | null;
  is_reservable: boolean;
  created_at: string;
};

const COMPLETED_STATUSES = [
  "COMPLETED",
  "BALANCE_PAID",
  "SERVICE_CONFIRMED",
];

const MAX_TOP_TAGS = 3;
const DEFAULT_POST_LIMIT = 12;
const MAX_POST_LIMIT = 24;
const HALF_LIFE_DAYS = 90;
const SERVICE_WEIGHT = 1.5;
const LIKE_WEIGHT = 1.0;

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
}

function parsePostLimit(raw: string | null): number {
  if (!raw) return DEFAULT_POST_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_POST_LIMIT) {
    throw new Error(`post_limit must be integer between 1 and ${MAX_POST_LIMIT}`);
  }
  return n;
}

function daysAgo(from: Date, now: Date): number {
  const ms = now.getTime() - from.getTime();
  return Math.max(0, ms / (1000 * 60 * 60 * 24));
}

function recencyDecay(eventAtISO: string, now: Date): number {
  const eventAt = new Date(eventAtISO);
  if (Number.isNaN(eventAt.getTime())) return 0;

  const elapsedDays = daysAgo(eventAt, now);
  return Math.pow(0.5, elapsedDays / HALF_LIFE_DAYS);
}

function normalizeTags(tags: string[] | null | undefined): string[] {
  if (!tags || tags.length === 0) return [];

  const unique = new Set<string>();
  for (const tag of tags) {
    const normalized = tag.trim();
    if (!normalized) continue;
    unique.add(normalized);
  }

  return Array.from(unique);
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
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

function buildScores(events: StyleEvent[], now: Date): Map<string, TagScore> {
  const byTag = new Map<string, TagScore>();

  for (const event of events) {
    const tags = normalizeTags(event.tags);
    if (tags.length === 0) continue;

    const decay = recencyDecay(event.created_at, now);
    if (decay <= 0) continue;

    const baseWeight = event.type === "service" ? SERVICE_WEIGHT : LIKE_WEIGHT;
    const distributedScore = (baseWeight * decay) / tags.length;

    for (const tag of tags) {
      const prev = byTag.get(tag) ?? {
        liked_score: 0,
        service_score: 0,
        total_score: 0,
      };

      if (event.type === "service") {
        prev.service_score += distributedScore;
      } else {
        prev.liked_score += distributedScore;
      }

      prev.total_score = prev.liked_score + prev.service_score;
      byTag.set(tag, prev);
    }
  }

  return byTag;
}

function makeConfidence(likedCount: number, serviceCount: number): number {
  // 0~1 scale with soft saturation to avoid overconfidence on small sample sizes.
  const likedFactor = Math.min(1, likedCount / 10);
  const serviceFactor = Math.min(1, serviceCount / 6);
  return clampRatio(0.5 * likedFactor + 0.5 * serviceFactor);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "GET") return errorResponse(405, "Method not allowed");

  try {
    const userId = await requireUserId(req);
    const url = new URL(req.url);
    const postLimit = parsePostLimit(url.searchParams.get("post_limit"));
    const now = new Date();

    const [{ data: likedRows, error: likedError }, { data: serviceRows, error: serviceError }] = await Promise.all([
      supabaseAdmin
        .from("bookmarks")
        .select("created_at, reference_id")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(300),
      supabaseAdmin
        .from("reservations")
        .select("status, created_at, reference_id")
        .eq("user_id", userId)
        .in("status", COMPLETED_STATUSES)
        .order("created_at", { ascending: false })
        .limit(300),
    ]);

    if (likedError) {
      return errorResponse(500, `liked rows lookup failed: ${likedError.message}`);
    }
    if (serviceError) {
      return errorResponse(500, `service rows lookup failed: ${serviceError.message}`);
    }

    const safeLikedRows = ((likedRows ?? []) as unknown) as LikedRow[];
    const safeServiceRows = ((serviceRows ?? []) as unknown) as ServiceRow[];
    const referenceIds = new Set<string>();
    for (const row of safeLikedRows) {
      if (row.reference_id) referenceIds.add(row.reference_id);
    }
    for (const row of safeServiceRows) {
      if (row.reference_id) referenceIds.add(row.reference_id);
    }

    const postTagsById = new Map<string, string[]>();
    if (referenceIds.size > 0) {
      const { data: postRows, error: postError } = await supabaseAdmin
        .from("feed_posts")
        .select("id, style_tags")
        .in("id", Array.from(referenceIds));
      if (postError) {
        return errorResponse(500, `feed_posts lookup failed: ${postError.message}`);
      }

      for (const row of postRows ?? []) {
        postTagsById.set(row.id as string, normalizeTags((row.style_tags as string[] | null) ?? []));
      }
    }

    const likedEvents: StyleEvent[] = safeLikedRows
      .map((row) => ({
        type: "liked" as const,
        created_at: row.created_at,
        tags: normalizeTags(postTagsById.get(row.reference_id) ?? []),
      }))
      .filter((row) => row.tags.length > 0);

    const serviceEvents: StyleEvent[] = safeServiceRows
      .map((row) => ({
        type: "service" as const,
        created_at: row.created_at,
        tags: normalizeTags(postTagsById.get(row.reference_id) ?? []),
      }))
      .filter((row) => row.tags.length > 0);

    const allEvents = [...likedEvents, ...serviceEvents];
    const scores = buildScores(allEvents, now);

    const sortedTags = Array.from(scores.entries())
      .sort((a, b) => {
        const scoreDiff = b[1].total_score - a[1].total_score;
        if (scoreDiff !== 0) return scoreDiff;
        return a[0].localeCompare(b[0]);
      })
      .slice(0, MAX_TOP_TAGS);

    const totalTopScore = sortedTags.reduce((sum, [, value]) => sum + value.total_score, 0);

    const summaryItems = sortedTags.map(([tag, value]) => ({
      tag,
      ratio: totalTopScore > 0 ? clampRatio(value.total_score / totalTopScore) : 0,
      liked_score: Number(value.liked_score.toFixed(6)),
      service_score: Number(value.service_score.toFixed(6)),
    }));

    const likedReferenceIds = new Set<string>();
    for (const row of safeLikedRows) {
      if (row.reference_id) {
        likedReferenceIds.add(row.reference_id);
      }
    }

    const topTags = summaryItems.map((item) => item.tag);

    let recommendationPosts: CandidatePostRow[] = [];
    if (topTags.length > 0) {
      const { data: candidateRows, error: candidateError } = await supabaseAdmin
        .from("feed_posts")
        .select("id, thumbnail_url, style_tags, is_reservable, created_at")
        .eq("status", "active")
        .overlaps("style_tags", topTags)
        .order("created_at", { ascending: false })
        .limit(150);

      if (candidateError) {
        return errorResponse(500, `recommendation lookup failed: ${candidateError.message}`);
      }

      const tagRank = new Map<string, number>();
      topTags.forEach((tag, index) => tagRank.set(tag, index));

      recommendationPosts = ((candidateRows ?? []) as CandidatePostRow[])
        .filter((row) => !likedReferenceIds.has(row.id))
        .sort((a, b) => {
          const aTags = normalizeTags(a.style_tags);
          const bTags = normalizeTags(b.style_tags);

          const scoreFor = (tags: string[]): number => {
            let score = 0;
            for (const tag of tags) {
              const rank = tagRank.get(tag);
              if (rank !== undefined) {
                // Higher weight for higher-ranked preference tags.
                score += (MAX_TOP_TAGS - rank);
              }
            }
            return score;
          };

          const diff = scoreFor(bTags) - scoreFor(aTags);
          if (diff !== 0) return diff;
          if (a.created_at !== b.created_at) {
            return b.created_at.localeCompare(a.created_at);
          }
          return a.id.localeCompare(b.id);
        })
        .slice(0, postLimit);
    }

    const hasData = summaryItems.length > 0;
    const confidence = makeConfidence(likedEvents.length, serviceEvents.length);

    return jsonResponse(200, {
      summary: {
        rank_text: `Top ${summaryItems.length}`,
        subtitle: hasData ? "찜/시술 이력을 기반으로 한 최근 취향" : "찜/시술 데이터가 부족해요",
        items: summaryItems,
        confidence,
      },
      basis: {
        liked_design_count: safeLikedRows.length,
        completed_service_count: safeServiceRows.length,
      },
      recommendations: {
        tags: topTags,
        posts: recommendationPosts.map((row) => ({
          id: row.id,
          thumbnail_url: row.thumbnail_url,
          style_tags: normalizeTags(row.style_tags),
          is_reservable: row.is_reservable,
          created_at: row.created_at,
        })),
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (message.includes("post_limit")) {
      return errorResponse(400, message);
    }
    return errorResponse(401, message);
  }
});
