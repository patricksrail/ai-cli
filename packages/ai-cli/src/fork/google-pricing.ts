/** Reviewed 2026-09-06 against Google's Standard pricing tables:
 * https://ai.google.dev/gemini-api/docs/pricing
 * Do not infer free eligibility from models.list: it contains no billing data.
 * Free vs paid is a PROJECT tier, not an API model variant:
 * https://ai.google.dev/gemini-api/docs/billing#can-i-revert-back-to-free-tier-after-ive-upgraded-to-higher-paid-tiers
 * These exact IDs have free input/output in the published free tier. This does
 * not verify the stored key's tier or remaining quota. Recheck the table before
 * adding models; image/video and Pro models often have no free tier.
 */
const FREE_TIER_IDS = new Set([
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash-preview-tts",
]);
export const GOOGLE_PRICING_SOURCE =
  "https://ai.google.dev/gemini-api/docs/pricing";
export function googleFreeTier(id: string) {
  return FREE_TIER_IDS.has(id)
    ? {
        source: GOOGLE_PRICING_SOURCE,
        checked: "2026-09-06",
        condition:
          "Free-tier project only; paid projects pay standard rates. Quota applies.",
      }
    : undefined;
}
