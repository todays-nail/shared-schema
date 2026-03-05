import { createRemoteJWKSet, jwtVerify } from "https://esm.sh/jose@5.9.6";

export type AppleProfile = {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
};

export class AppleConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppleConfigError";
  }
}

const appleJWKS = createRemoteJWKSet(
  new URL("https://appleid.apple.com/auth/keys"),
);

let cachedAllowedAudiences: string[] | null = null;

function resolveAllowedAudiences(): string[] {
  if (cachedAllowedAudiences) {
    return cachedAllowedAudiences;
  }

  const raw = Deno.env.get("APPLE_OAUTH_AUDIENCES") ?? "";
  if (raw.trim().length === 0) {
    throw new AppleConfigError("Missing required env: APPLE_OAUTH_AUDIENCES");
  }

  const parsed = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (parsed.length === 0) {
    throw new AppleConfigError(
      "Missing required env value: APPLE_OAUTH_AUDIENCES",
    );
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
  if (typeof value === "number") return value === 1;

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1";
  }

  return false;
}

export async function verifyAppleIdToken(idToken: string): Promise<AppleProfile> {
  const token = idToken.trim();
  if (!token) {
    throw new Error("Apple verify failed: missing id token");
  }

  const allowedAudiences = resolveAllowedAudiences();

  const { payload } = await jwtVerify(token, appleJWKS, {
    issuer: "https://appleid.apple.com",
    audience: allowedAudiences,
  });

  const sub = payload.sub?.trim();
  if (!sub) {
    throw new Error("Apple verify failed: missing sub");
  }

  return {
    sub,
    email: normalizedOptionalString(payload.email),
    emailVerified: normalizeEmailVerified(payload.email_verified),
    // Apple id_token에는 name/picture가 안정적으로 포함되지 않는다.
    name: null,
    picture: null,
  };
}
