/** Central provider contract. Keep host names, supported CLI modalities, auth,
 * billing caveats, and source links here; adapters implement this contract.
 * Gateway is transport/control, provider is inference/billing, creator is model
 * authorship. Thus Cloudflare gateway + Workers AI provider is not two models.
 * Extension checklist: docs/providers.md. Editorial model choices are separate
 * in model-preferences.json so adding a provider never silently changes defaults.
 */
export interface ProviderDefinition {
  summary: string;
  /** Human-browsable full host catalog, independent of CLI adapter coverage. */
  catalogUrl: string;
  /** Canonical price list; open directly when refreshing prices, rather than searching. */
  pricingUrl: string;
  monthlyBudgetUsd?: number;
  enabled?: boolean;
  modalities: readonly string[];
  path: string;
  storedKey: boolean;
  freeDiscovery: boolean;
  auth: string;
  nuance: string;
  sources: readonly string[];
}
export const PROVIDER_REGISTRY = {
  openrouter: {
    catalogUrl: "https://openrouter.ai/models",
    pricingUrl: "https://openrouter.ai/models",
    summary: "Broad catalog; start here to browse free text models.",
    modalities: ["text", "image", "video"],
    path: "openrouter/v1",
    storedKey: true,
    freeDiscovery: true,
    auth: "Cloudflare stored OpenRouter key, default alias",
    nuance:
      "Keep creator/model inside the host prefix. Free status comes from live prices, not the creator or name. Media with zero text-token prices are not necessarily free.",
    sources: [
      "https://openrouter.ai/docs/api/api-reference/models/list-models-filtered-by-user-provider-preferences-privacy-settings-and-guardrails",
    ],
  },
  google: {
    catalogUrl: "https://ai.google.dev/gemini-api/docs/models",
    pricingUrl: "https://ai.google.dev/gemini-api/docs/pricing",
    summary: "Direct Gemini; free tier depends on your Google project.",
    modalities: ["text", "image", "video", "speech", "transcription"],
    path: "google-ai-studio/v1beta",
    storedKey: true,
    freeDiscovery: true,
    auth: "Cloudflare stored Google AI Studio key, default alias",
    nuance:
      "Gemini free-tier eligibility belongs to the direct Google project. Paid projects pay; it does not transfer to OpenRouter. Exact free IDs and dated sources are in google-pricing.ts.",
    sources: [
      "https://ai.google.dev/gemini-api/docs/pricing",
      "https://ai.google.dev/gemini-api/docs/billing",
    ],
  },
  openai: {
    catalogUrl: "https://developers.openai.com/api/docs/models",
    pricingUrl: "https://developers.openai.com/api/docs/pricing",
    summary: "Direct OpenAI; paid API access.",
    modalities: ["text", "image", "speech", "transcription"],
    path: "openai",
    storedKey: true,
    freeDiscovery: false,
    auth: "Cloudflare stored OpenAI key, default alias",
    nuance:
      "Direct OpenAI billing differs from OpenRouter's route to the same model. Catalog access does not prove credit. Image quality/style options are adapter-specific.",
    sources: [
      "https://developers.cloudflare.com/ai-gateway/usage/providers/openai/",
    ],
  },
  fal: {
    catalogUrl: "https://fal.ai/models",
    pricingUrl: "https://fal.ai/pricing",
    summary: "Media generation; includes the saved cheap image option.",
    modalities: ["image", "video", "speech", "transcription"],
    path: "fal",
    storedKey: true,
    freeDiscovery: false,
    auth: "Cloudflare stored Fal key, default alias",
    nuance:
      "Native endpoint IDs often include fal-ai/. H3 Max uses minimax/h3-max and Fal queue routing. Prices and rounding vary by endpoint; smaller resolution need not reduce the bill.",
    sources: [
      "https://fal.ai/docs/documentation/model-apis/pricing",
      "https://fal.ai/models/fal-ai/sana",
      "https://fal.ai/models/fal-ai/flux/schnell",
      "https://fal.ai/docs/documentation/serverless/publishing-to-marketplace",
    ],
  },
  replicate: {
    catalogUrl: "https://replicate.com/explore",
    pricingUrl: "https://replicate.com/pricing",
    summary: "Image and video models; paid API access.",
    modalities: ["image", "video"],
    path: "replicate",
    storedKey: true,
    freeDiscovery: false,
    auth: "Cloudflare stored Replicate key, default alias",
    nuance:
      "Nonofficial models may need :version. Poll predictions; use native search or opt into full pagination. Example output extensions are only modality hints.",
    sources: ["https://replicate.com/docs/reference/http"],
  },
  "workers-ai": {
    // Patrick declined activation after verifying the daily allowance's value.
    // Keep the tested adapter as reference; see docs/providers.md (2026-09-06).
    enabled: false,
    monthlyBudgetUsd: 20,
    catalogUrl: "https://developers.cloudflare.com/workers-ai/models/",
    pricingUrl:
      "https://developers.cloudflare.com/workers-ai/platform/pricing/",
    summary: "Left off by choice; small daily free allowance.",
    modalities: ["image"],
    path: "",
    storedKey: false,
    freeDiscovery: true,
    auth: "Cloudflare API token: Workers AI Metadata Read for catalogs, Workers AI Read for inference; gateway read for caps and subscription read for free-plan verification",
    nuance:
      "Cloudflare runs FLUX.1 Schnell; the gateway supplies logs and cost controls. Ordinary generation accepts a verified $20/month cap; --free still requires a verified Workers Free plan. Caps may overshoot during concurrent requests. Prepaid billing is refused.",
    sources: [
      "https://blog.cloudflare.com/workers-ai-gateway-unification/",
      "https://developers.cloudflare.com/changelog/post/2026-08-07-workers-ai-unified-billing/",
      "https://developers.cloudflare.com/workers-ai/platform/pricing/",
      "https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/",
      "https://developers.cloudflare.com/ai-gateway/usage/rest-api/",
    ],
  },
} as const satisfies Record<string, ProviderDefinition>;
export type ProviderId = keyof typeof PROVIDER_REGISTRY;
export const PROVIDERS = Object.keys(PROVIDER_REGISTRY) as ProviderId[];
export const FREE_PROVIDERS = PROVIDERS.filter(
  (id) => PROVIDER_REGISTRY[id].freeDiscovery && isProviderEnabled(id)
);
export function isProviderEnabled(id: ProviderId): boolean {
  return (PROVIDER_REGISTRY[id] as ProviderDefinition).enabled !== false;
}
export function assertProviderEnabled(id: ProviderId): void {
  if (!isProviderEnabled(id))
    throw new Error(
      `${id} is disabled in this fork by choice; see docs/providers.md. No request was sent.`
    );
}
export function providersFor(modality: string): ProviderId[] {
  return PROVIDERS.filter((id) =>
    (PROVIDER_REGISTRY[id].modalities as readonly string[]).includes(modality)
  );
}
