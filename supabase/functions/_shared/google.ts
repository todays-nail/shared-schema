import { createRemoteJWKSet, jwtVerify } from "https://esm.sh/jose@5.9.6";

export type GoogleProfile = {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
};

export class GoogleConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleConfigError";
  }
}

const googleJWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);

let cachedAllowedAudiences: string[] | null = null;

function resolveAllowedAudiences(): string[] {
  if (cachedAllowedAudiences) {
    return cachedAllowedAudiences;
  }

  const raw = Deno.env.get("GOOGLE_OAUTH_AUDIENCES") ?? "";
  if (raw.trim().length === 0) {
    throw new GoogleConfigError("Missing required env: GOOGLE_OAUTH_AUDIENCES");
  }

  const parsed = raw
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);

  if (parsed.length === 0) {
    throw new GoogleConfigError("Missing required env value: GOOGLE_OAUTH_AUDIENCES");
  }

  cachedAllowedAudiences = parsed;
  return parsed;
}

function normalizedOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEmailVerified(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() == "true";
  return false;
}

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
  const token = idToken.trim();
  if (!token) {
    throw new Error("Google verify failed: missing id token");
  }

  const allowedAudiences = resolveAllowedAudiences();

  const { payload } = await jwtVerify(token, googleJWKS, {
    issuer: ["accounts.google.com", "https://accounts.google.com"],
    audience: allowedAudiences,
  });

  const sub = payload.sub?.trim();
  if (!sub) {
    throw new Error("Google verify failed: missing sub");
  }

  return {
    sub,
    email: normalizedOptionalString(payload.email),
    emailVerified: normalizeEmailVerified(payload.email_verified),
    name: normalizedOptionalString(payload.name),
    picture: normalizedOptionalString(payload.picture),
  };
}
