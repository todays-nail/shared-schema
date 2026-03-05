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

type NailGenLikeBody = {
  job_id?: string;
};

type NailGenLikeState = {
  is_liked: boolean;
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

async function loadLikeState(userId: string, jobId: string): Promise<NailGenLikeState | Response> {
  const { data: likeRow, error: likeError } = await supabaseAdmin
    .from("nail_generation_likes")
    .select("job_id")
    .eq("user_id", userId)
    .eq("job_id", jobId)
    .maybeSingle();

  if (likeError && likeError.code !== "PGRST116") {
    return errorResponse(500, `nail like lookup failed: ${likeError.message}`);
  }

  return {
    is_liked: !!likeRow,
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
    const body = await readJson<NailGenLikeBody>(req);
    const jobId = body.job_id?.trim().toLowerCase() ?? "";

    if (!isUuid(jobId)) {
      return errorResponse(400, "job_id must be uuid");
    }

    const { data: job, error: jobError } = await supabaseAdmin
      .from("nail_generation_jobs")
      .select("id")
      .eq("id", jobId)
      .eq("user_id", userId)
      .eq("status", "completed")
      .is("deleted_at", null)
      .maybeSingle();

    if (jobError) {
      return errorResponse(500, `nail job lookup failed: ${jobError.message}`);
    }

    if (!job) {
      return errorResponse(404, "nail job not found");
    }

    if (req.method === "POST") {
      const { data: existingLike, error: existingLikeError } = await supabaseAdmin
        .from("nail_generation_likes")
        .select("job_id")
        .eq("user_id", userId)
        .eq("job_id", jobId)
        .maybeSingle();

      if (existingLikeError && existingLikeError.code !== "PGRST116") {
        return errorResponse(500, `nail like lookup failed: ${existingLikeError.message}`);
      }

      if (!existingLike) {
        const { error: insertError } = await supabaseAdmin
          .from("nail_generation_likes")
          .insert({
            user_id: userId,
            job_id: jobId,
          });

        if (insertError) {
          return errorResponse(500, `nail like save failed: ${insertError.message}`);
        }
      }
    } else {
      const { error: deleteError } = await supabaseAdmin
        .from("nail_generation_likes")
        .delete()
        .eq("user_id", userId)
        .eq("job_id", jobId);

      if (deleteError) {
        return errorResponse(500, `nail like delete failed: ${deleteError.message}`);
      }
    }

    const likeState = await loadLikeState(userId, jobId);
    if (likeState instanceof Response) {
      return likeState;
    }

    return jsonResponse(200, {
      ok: true,
      job_id: jobId,
      is_liked: likeState.is_liked,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return errorResponse(401, message);
  }
});
