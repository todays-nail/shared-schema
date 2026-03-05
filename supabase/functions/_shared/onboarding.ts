export type OnboardingUserLike = {
  nickname: string | null;
};

// For this release, onboarding completion is determined only by nickname.
export function computeNeedsOnboarding(user: OnboardingUserLike): boolean {
  const nickname = (user.nickname ?? "").trim();
  return nickname.length === 0;
}
