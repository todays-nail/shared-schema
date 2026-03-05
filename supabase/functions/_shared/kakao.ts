export type KakaoProfile = {
  id: string;
  nickname: string | null;
  profileImageURL: string | null;
};

type KakaoMeResponse = {
  id?: number | string;
  kakao_account?: {
    profile?: {
      nickname?: string | null;
      profile_image_url?: string | null;
    };
  };
};

function normalizedOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function getKakaoProfileFromAccessToken(
  kakaoAccessToken: string,
): Promise<KakaoProfile> {
  const resp = await fetch("https://kapi.kakao.com/v2/user/me", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${kakaoAccessToken}`,
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
    },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Kakao verify failed: ${resp.status} ${text}`);
  }

  const data = await resp.json() as KakaoMeResponse;
  if (data?.id === undefined || data?.id === null) {
    throw new Error("Kakao verify failed: missing id");
  }

  const profile = data.kakao_account?.profile;
  return {
    id: String(data.id),
    nickname: normalizedOptionalString(profile?.nickname),
    profileImageURL: normalizedOptionalString(profile?.profile_image_url),
  };
}

export async function getKakaoUserIdFromAccessToken(
  kakaoAccessToken: string,
): Promise<string> {
  const kakaoProfile = await getKakaoProfileFromAccessToken(kakaoAccessToken);
  return kakaoProfile.id;
}
