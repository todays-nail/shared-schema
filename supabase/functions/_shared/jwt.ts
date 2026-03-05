import {
  create,
  getNumericDate,
  verify,
} from "https://deno.land/x/djwt@v3.0.2/mod.ts";
import { requireEnv } from "./env.ts";

type JwtPayload = Record<string, unknown>;

const jwtSecret = requireEnv("APP_JWT_SECRET");
const key = await crypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(jwtSecret),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign", "verify"],
);

export async function signAccessJwt(args: {
  userId: string;
  role: string;
  expiresInSeconds?: number;
}): Promise<string> {
  const exp = getNumericDate(args.expiresInSeconds ?? 15 * 60);
  return await create(
    { alg: "HS256", typ: "JWT" },
    {
      sub: args.userId,
      role: args.role,
      iss: "todaysnail-edge",
      exp,
    },
    key,
  );
}

export async function verifyAccessJwt(token: string): Promise<JwtPayload> {
  const payload = await verify(token, key);
  return payload as JwtPayload;
}
