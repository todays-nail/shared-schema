import { create } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

type APNSEnvironment = "production" | "sandbox";
export type AIGenerationPushEventType = "ai_generation_completed" | "ai_generation_failed";

type APNSConfig = {
  teamId: string;
  keyId: string;
  privateKeyPEM: string;
  topic: string;
  defaultEnv: APNSEnvironment;
};

export type APNSPushToken = {
  id: string;
  apns_token: string;
  apns_env_hint: APNSEnvironment | null;
};

export type APNSDispatchResult = {
  attempted: number;
  sent: number;
  failed: number;
  invalidTokenIds: string[];
  skippedReason?: string;
};

let cachedConfig: APNSConfig | null | undefined;
let cachedSigningKey: CryptoKey | null = null;
let cachedAuthToken:
  | {
    token: string;
    expiresAtMs: number;
  }
  | null = null;

function normalizePEM(raw: string): string {
  const replaced = raw.replace(/\\n/g, "\n").trim();
  if (replaced.includes("BEGIN PRIVATE KEY")) return replaced;
  return `-----BEGIN PRIVATE KEY-----\n${replaced}\n-----END PRIVATE KEY-----`;
}

function parseConfig(): APNSConfig | null {
  if (cachedConfig !== undefined) return cachedConfig;

  const teamId = (Deno.env.get("APNS_TEAM_ID") ?? "").trim();
  const keyId = (Deno.env.get("APNS_KEY_ID") ?? "").trim();
  const privateKeyRaw = (Deno.env.get("APNS_PRIVATE_KEY_P8") ?? "").trim();
  const topic = (Deno.env.get("APNS_TOPIC") ?? "").trim();
  const envRaw = (Deno.env.get("APNS_DEFAULT_ENV") ?? "production").trim().toLowerCase();
  const defaultEnv: APNSEnvironment = envRaw === "sandbox" ? "sandbox" : "production";

  if (!teamId || !keyId || !privateKeyRaw || !topic) {
    cachedConfig = null;
    return cachedConfig;
  }

  cachedConfig = {
    teamId,
    keyId,
    privateKeyPEM: normalizePEM(privateKeyRaw),
    topic,
    defaultEnv,
  };
  return cachedConfig;
}

function pemToDer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out.buffer as ArrayBuffer;
}

async function signingKey(config: APNSConfig): Promise<CryptoKey> {
  if (cachedSigningKey) return cachedSigningKey;

  const der = pemToDer(config.privateKeyPEM);
  cachedSigningKey = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  return cachedSigningKey;
}

async function authToken(config: APNSConfig): Promise<string> {
  const now = Date.now();
  if (cachedAuthToken && cachedAuthToken.expiresAtMs > now) {
    return cachedAuthToken.token;
  }

  const key = await signingKey(config);
  const iat = Math.floor(now / 1000);
  const token = await create(
    { alg: "ES256", typ: "JWT", kid: config.keyId },
    { iss: config.teamId, iat },
    key,
  );

  cachedAuthToken = {
    token,
    expiresAtMs: now + 50 * 60 * 1000,
  };
  return token;
}

function endpointForEnv(env: APNSEnvironment): string {
  return env === "sandbox"
    ? "https://api.sandbox.push.apple.com"
    : "https://api.push.apple.com";
}

function buildAlert(eventType: AIGenerationPushEventType): { title: string; body: string } {
  if (eventType === "ai_generation_completed") {
    return {
      title: "AI 네일 생성 완료",
      body: "결과가 준비되었어요. 지금 확인해 보세요.",
    };
  }
  return {
    title: "AI 네일 생성 실패",
    body: "생성에 실패했어요. 다시 시도해 주세요.",
  };
}

async function sendToToken(
  config: APNSConfig,
  token: APNSPushToken,
  eventType: AIGenerationPushEventType,
  jobId: string,
): Promise<{ ok: boolean; status: number; reason?: string }> {
  const bearer = await authToken(config);
  const env = token.apns_env_hint ?? config.defaultEnv;
  const endpoint = endpointForEnv(env);
  const url = `${endpoint}/3/device/${token.apns_token}`;
  const alert = buildAlert(eventType);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `bearer ${bearer}`,
      "apns-topic": config.topic,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      aps: {
        alert,
        sound: "default",
      },
      event_type: eventType,
      job_id: jobId,
    }),
  });

  if (response.ok) {
    return { ok: true, status: response.status };
  }

  let reason: string | undefined;
  try {
    const body = await response.json() as { reason?: string };
    if (typeof body.reason === "string" && body.reason.length > 0) {
      reason = body.reason;
    }
  } catch {
    reason = undefined;
  }

  return {
    ok: false,
    status: response.status,
    reason,
  };
}

function shouldDeactivateToken(status: number, reason?: string): boolean {
  if (status === 410) return true;
  if (status !== 400) return false;
  return reason === "BadDeviceToken" || reason === "Unregistered" || reason === "DeviceTokenNotForTopic";
}

export async function sendAIGenerationPushToTokens(args: {
  tokens: APNSPushToken[];
  eventType: AIGenerationPushEventType;
  jobId: string;
}): Promise<APNSDispatchResult> {
  const config = parseConfig();
  if (!config) {
    return {
      attempted: 0,
      sent: 0,
      failed: 0,
      invalidTokenIds: [],
      skippedReason: "missing APNS configuration",
    };
  }

  let sent = 0;
  let failed = 0;
  const invalidTokenIds: string[] = [];

  for (const token of args.tokens) {
    try {
      const result = await sendToToken(config, token, args.eventType, args.jobId);
      if (result.ok) {
        sent += 1;
      } else {
        failed += 1;
        if (shouldDeactivateToken(result.status, result.reason)) {
          invalidTokenIds.push(token.id);
        }
      }
    } catch {
      failed += 1;
    }
  }

  return {
    attempted: args.tokens.length,
    sent,
    failed,
    invalidTokenIds,
  };
}
