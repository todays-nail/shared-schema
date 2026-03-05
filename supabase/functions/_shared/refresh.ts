import { base64UrlEncode, sha256Hex } from "./crypto.ts";
import { requireEnv } from "./env.ts";

const pepper = requireEnv("REFRESH_TOKEN_PEPPER");

export function generateRefreshToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function hashRefreshToken(token: string): Promise<string> {
  // 서버에만 있는 pepper를 붙여서 해시 저장(원문 저장 금지)
  return await sha256Hex(`${token}.${pepper}`);
}

