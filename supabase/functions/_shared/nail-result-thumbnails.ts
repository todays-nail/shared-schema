import { requireEnv } from "./env.ts";
import { supabaseAdmin } from "./supabase.ts";

export const RESULT_BUCKET = "nail-results-private";
export const THUMBNAIL_BUCKET = "nail-results-thumb-public";
export const THUMBNAIL_SIGNED_URL_EXPIRES_SEC = 60;
export const THUMBNAIL_MAX_SIDE = 320;
export const THUMBNAIL_QUALITY = 72;
export const THUMBNAIL_CONTENT_TYPE = "image/jpeg";
export const THUMBNAIL_BACKFILL_MAX_BYTES = 280 * 1024;

export function defaultThumbnailObjectPath(userId: string, jobId: string): string {
  return `${userId}/${jobId}/thumb.jpg`;
}

export function absolutizeSignedUrl(signedUrl: string): string {
  if (signedUrl.startsWith("http://") || signedUrl.startsWith("https://")) {
    return signedUrl;
  }

  const supabaseUrl = requireEnv("SUPABASE_URL").replace(/\/+$/, "");
  if (signedUrl.startsWith("/storage/v1/")) return `${supabaseUrl}${signedUrl}`;
  if (signedUrl.startsWith("/object/")) return `${supabaseUrl}/storage/v1${signedUrl}`;
  if (signedUrl.startsWith("/")) return `${supabaseUrl}${signedUrl}`;
  return `${supabaseUrl}/${signedUrl}`;
}

export async function createTransformedThumbnailUrl(resultObjectPath: string): Promise<string> {
  const { data: signed, error: signedError } = await supabaseAdmin.storage
    .from(RESULT_BUCKET)
    .createSignedUrl(resultObjectPath, THUMBNAIL_SIGNED_URL_EXPIRES_SEC, {
      transform: {
        width: THUMBNAIL_MAX_SIDE,
        height: THUMBNAIL_MAX_SIDE,
        resize: "cover",
      },
    });

  if (signedError || !signed?.signedUrl) {
    throw new Error(`createSignedUrl failed: ${signedError?.message ?? "unknown"}`);
  }

  const baseURL = absolutizeSignedUrl(signed.signedUrl);
  const separator = baseURL.includes("?") ? "&" : "?";
  return `${baseURL}${separator}format=jpeg&quality=${THUMBNAIL_QUALITY}`;
}

export async function buildJpegThumbnailBytesFromResult(resultObjectPath: string): Promise<Uint8Array> {
  const thumbnailURL = await createTransformedThumbnailUrl(resultObjectPath);

  let response: Response;
  try {
    response = await fetch(thumbnailURL);
  } catch (e) {
    const message = e instanceof Error ? e.message : "thumbnail fetch failed";
    throw new Error(message);
  }

  if (!response.ok) {
    throw new Error(`thumbnail fetch status=${response.status}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

export async function uploadJpegThumbnail(thumbnailObjectPath: string, bytes: Uint8Array): Promise<void> {
  const { error } = await supabaseAdmin.storage
    .from(THUMBNAIL_BUCKET)
    .upload(thumbnailObjectPath, bytes, {
      contentType: THUMBNAIL_CONTENT_TYPE,
      upsert: true,
    });

  if (error) {
    throw new Error(error.message);
  }
}

export async function updateThumbnailPath(jobId: string, thumbnailObjectPath: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("nail_generation_jobs")
    .update({
      result_thumbnail_object_path: thumbnailObjectPath,
    })
    .eq("id", jobId)
    .eq("status", "completed");

  if (error) {
    throw new Error(error.message);
  }
}
