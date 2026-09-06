/** Fork-owned discovery. Provider keys stay in Cloudflare; never use local keys.
 * OpenRouter: https://openrouter.ai/docs/api/api-reference/models/list-models-filtered-by-user-provider-preferences-privacy-settings-and-guardrails
 * Fal: https://fal.ai/docs/platform-apis/v1/models
 * Provider inventory: https://developers.cloudflare.com/api/resources/ai_gateway/subresources/provider_configs/methods/list/
 */
import {
  cloudflareProviderBaseURL,
  resolveCloudflareGatewayConfig,
  type CloudflareProvider,
} from "../lib/gateway.js";
import type { GatewayModels, ModelEntry, Modality } from "../lib/models.js";
import { googleFreeTier } from "./google-pricing.js";
import {
  PROVIDERS,
  PROVIDER_REGISTRY,
  assertProviderEnabled,
} from "./providers.js";
import { workersAIEntries } from "./workers-ai.js";
export { PROVIDERS } from "./providers.js";

export interface CatalogEntry extends ModelEntry {
  provider: CloudflareProvider;
  source: string;
  free?: boolean;
  freeTier?: ReturnType<typeof googleFreeTier>;
}
export interface Catalog {
  entries: CatalogEntry[];
  providers: CloudflareProvider[];
  warnings: string[];
  notes: string[];
}

type Row = Record<string, any>;

async function get(url: string, headers: Record<string, string>): Promise<Row> {
  const response = await fetch(url, {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  // Do not echo provider response bodies: they can contain credential metadata.
  if (!response.ok)
    throw new Error(`catalog request failed (HTTP ${response.status})`);
  return (await response.json()) as Row;
}

export function parseProvider(value: string): CloudflareProvider {
  const provider = value.toLowerCase();
  if (!PROVIDERS.includes(provider as CloudflareProvider))
    throw new Error(`--provider must be one of: ${PROVIDERS.join(", ")}`);
  return provider as CloudflareProvider;
}

export async function configuredProviders(): Promise<CloudflareProvider[]> {
  try {
    return await readProviderInventory();
  } catch (error) {
    throw new Error(
      `Cannot read Cloudflare Provider Keys: ${error instanceof Error ? error.message : "inventory unavailable"}. Supply CLOUDFLARE_API_TOKEN with AI Gateway Read permission, set AI_CLI_PROVIDERS, or select --provider openrouter with your Run token.`
    );
  }
}

async function readProviderInventory(): Promise<CloudflareProvider[]> {
  // Explicit inventory supports Run-only tokens without claiming automatic detection.
  if (process.env.AI_CLI_PROVIDERS)
    return [
      ...new Set(
        process.env.AI_CLI_PROVIDERS.split(",").map((v) =>
          parseProvider(v.trim())
        )
      ),
    ];
  const config = resolveCloudflareGatewayConfig();
  const token =
    process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_AI_GATEWAY_TOKEN;
  const providers = new Set<CloudflareProvider>();
  for (let page = 1; ; page++) {
    const body = await get(
      `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai-gateway/gateways/${config.gatewayId}/provider_configs?page=${page}&per_page=100`,
      { Authorization: `Bearer ${token}` }
    );
    if (!Array.isArray(body.result))
      throw new Error("invalid provider inventory response");
    for (const row of body.result) {
      const slug =
        row.provider_slug === "google-ai-studio" ? "google" : row.provider_slug;
      if (row.alias === "default" && PROVIDERS.includes(slug))
        providers.add(slug);
    }
    if (
      page * (body.result_info?.per_page ?? 100) >=
      (body.result_info?.total_count ?? body.result.length)
    )
      break;
  }
  return PROVIDERS.filter((p) => providers.has(p));
}

/** Zero must be explicit. Missing, negative/dynamic, or nonzero prices aren't free.
 * Read pricing from the authenticated model catalog, not a model-name suffix:
 * https://openrouter.ai/docs/api/api-reference/models/list-models-filtered-by-user-provider-preferences-privacy-settings-and-guardrails
 */
export function isFreeOpenRouter(pricing?: Row): boolean {
  if (
    !pricing ||
    pricing.prompt === undefined ||
    pricing.completion === undefined
  )
    return false;
  const zero = (v: unknown): boolean =>
    ((typeof v === "string" && v.trim() !== "") || typeof v === "number") &&
    Number(v) === 0;
  return Object.values(pricing).every((v) =>
    Array.isArray(v)
      ? v.every((row) =>
          Object.entries(row).every(
            ([key, value]) => key.startsWith("min_") || zero(value)
          )
        )
      : zero(v)
  );
}

function entry(
  provider: CloudflareProvider,
  id: string,
  capabilities: Modality[],
  extra: Partial<CatalogEntry> = {}
): CatalogEntry {
  return {
    id: `${provider}/${id}`,
    creator: id.includes("/") ? id.split("/")[0]! : provider,
    provider,
    source: "provider catalog",
    capabilities,
    ...extra,
  };
}

export function normalizeOpenRouter(row: Row): CatalogEntry {
  const outputs: string[] = row.architecture?.output_modalities ?? [];
  // The fork's OpenRouter adapter supports text, images, and video, not audio.
  const capabilities = row.id.endsWith(":batch")
    ? []
    : outputs.filter((v): v is Modality =>
        ["text", "image", "video"].includes(v)
      );
  return entry("openrouter", row.id, capabilities, {
    name: row.name,
    description: row.description,
    contextWindow: row.context_length,
    maxTokens: row.top_provider?.max_completion_tokens,
    released: row.created,
    pricing: row.pricing
      ? {
          ...row.pricing,
          input: row.pricing.prompt,
          output: row.pricing.completion,
        }
      : undefined,
    free:
      outputs.length === 1 &&
      outputs[0] === "text" &&
      !row.id.endsWith(":batch") &&
      isFreeOpenRouter(row.pricing),
    source: "OpenRouter account catalog",
  });
}

function normalizeGoogle(row: Row): CatalogEntry {
  const id = row.name.replace(/^models\//, "");
  const methods: string[] = row.supportedGenerationMethods ?? [];
  const capabilities: Modality[] = [];
  if (methods.includes("generateContent")) {
    if (/tts/.test(id)) capabilities.push("speech");
    else {
      capabilities.push("text");
      if (/image/.test(id)) capabilities.push("image");
    }
  }
  if (id.startsWith("imagen")) capabilities.push("image");
  if (id.startsWith("veo")) capabilities.push("video");
  return entry("google", id, capabilities, {
    freeTier: googleFreeTier(id),
    name: row.displayName,
    description: row.description,
    contextWindow: row.inputTokenLimit,
    maxTokens: row.outputTokenLimit,
  });
}

function normalizeOpenAI(row: Row): CatalogEntry {
  const id: string = row.id;
  // OpenAI's list API lacks modalities. Keep unfamiliar IDs unclassified rather
  // than advertising embeddings/realtime models as working text commands.
  const capabilities: Modality[] = /transcribe|^whisper/.test(id)
    ? ["transcription"]
    : /tts/.test(id)
      ? ["speech"]
      : /^(gpt-image|dall-e)/.test(id)
        ? ["image"]
        : /^(gpt-|chatgpt-|o[1-9])/.test(id) &&
            !/realtime|audio|search|image/.test(id)
          ? ["text"]
          : [];
  return entry("openai", id, capabilities, { released: row.created });
}

function normalizeFal(row: Row): CatalogEntry {
  const category = row.metadata?.category;
  const capabilities: Modality[] = /^(text|image)-to-image$/.test(category)
    ? ["image"]
    : /^(text|image)-to-video$/.test(category)
      ? ["video"]
      : category === "text-to-speech"
        ? ["speech"]
        : category === "speech-to-text"
          ? ["transcription"]
          : [];
  return entry("fal", row.endpoint_id, capabilities, {
    name: row.metadata?.display_name,
    description: row.metadata?.description,
    tags: category ? [category] : undefined,
  });
}

function normalizeReplicate(row: Row): CatalogEntry {
  // Replicate has no modality field. A sample's output extension is only a
  // discovery hint; model-specific required inputs still apply.
  const sample = row.default_example?.output;
  const output =
    typeof sample === "string"
      ? sample
      : Array.isArray(sample)
        ? (sample.find((v) => typeof v === "string") ?? "")
        : "";
  const capabilities: Modality[] = /\.(png|jpe?g|webp)(\?|$)/i.test(output)
    ? ["image"]
    : /\.(mp4|webm)(\?|$)/i.test(output)
      ? ["video"]
      : [];
  // Non-official predictions need a version hash, unlike official model routes.
  const version =
    row.is_official === false && row.latest_version?.id
      ? `:${row.latest_version.id}`
      : "";
  return entry(
    "replicate",
    `${row.owner}/${row.name}${version}`,
    capabilities,
    {
      name: row.name,
      description: row.description,
      source: "Replicate catalog (type inferred from example)",
    }
  );
}

interface CatalogRequest {
  providers?: CloudflareProvider[];
  all?: boolean;
  search?: string;
  model?: string;
}

async function providerEntries(
  provider: CloudflareProvider,
  request: CatalogRequest,
  notes: string[]
): Promise<CatalogEntry[]> {
  if (provider === "workers-ai") {
    assertProviderEnabled(provider);
    return workersAIEntries();
  }
  const config = resolveCloudflareGatewayConfig();
  const base = cloudflareProviderBaseURL(provider, config);
  const entries: CatalogEntry[] = [];
  if (provider === "replicate" && request.model?.startsWith("replicate/")) {
    const id = request.model.slice("replicate/".length);
    if (!/^[\w.-]+\/[\w.:-]+$/.test(id))
      throw new Error("invalid Replicate model ID");
    return [
      normalizeReplicate(
        await get(`${base}/models/${id.split(":")[0]}`, config.headers)
      ),
    ];
  }
  let cursor = "";
  const seen = new Set<string>();
  do {
    if (seen.has(cursor))
      throw new Error("catalog returned a repeated pagination cursor");
    seen.add(cursor);
    let url: string;
    const headers = { ...config.headers };
    if (provider === "fal") {
      url = base;
      headers["x-fal-target-url"] =
        `https://api.fal.ai/v1/models?limit=100&status=active${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    } else if (provider === "google")
      url = `${base}/models?pageSize=1000${cursor ? `&pageToken=${encodeURIComponent(cursor)}` : ""}`;
    else if (provider === "openrouter")
      url = `${base}/models/user?output_modalities=all${cursor}`;
    else url = `${base}/models${cursor}`;
    const body =
      provider === "replicate" && request.search
        ? await (async () => {
            const res = await fetch(url, {
              method: "QUERY",
              headers: { ...headers, "Content-Type": "text/plain" },
              body: request.search,
              redirect: "error",
              signal: AbortSignal.timeout(15_000),
            });
            if (!res.ok)
              throw new Error(`catalog search failed (HTTP ${res.status})`);
            return (await res.json()) as Row;
          })()
        : await get(url, headers);
    const rows =
      provider === "fal" || provider === "google"
        ? body.models
        : provider === "replicate"
          ? body.results
          : body.data;
    if (!Array.isArray(rows)) throw new Error("invalid catalog response");
    const normalize = {
      openrouter: normalizeOpenRouter,
      google: normalizeGoogle,
      openai: normalizeOpenAI,
      fal: normalizeFal,
      replicate: normalizeReplicate,
    }[provider];
    entries.push(...rows.map(normalize));
    cursor = "";
    if (provider === "google") cursor = body.nextPageToken ?? "";
    if (provider === "fal") cursor = body.next_cursor ?? "";
    if (provider === "replicate" && body.next) {
      const next = new URL(body.next);
      if (
        next.origin !== "https://api.replicate.com" ||
        next.pathname !== "/v1/models"
      )
        throw new Error("unexpected catalog pagination URL");
      cursor = next.search;
    }
    if (provider === "openrouter" && body.links?.next) {
      const next = new URL(body.links.next, "https://openrouter.ai");
      if (
        next.origin !== "https://openrouter.ai" ||
        next.pathname !== "/api/v1/models/user"
      )
        throw new Error("unexpected catalog pagination URL");
      const params = next.searchParams;
      params.delete("output_modalities");
      cursor = params.size ? `&${params}` : "";
      if (!cursor) throw new Error("invalid catalog pagination cursor");
    }
    if (provider === "replicate" && cursor && !request.all) {
      notes.push(
        "Replicate: first catalog page only; use --provider replicate --search <text> to search its catalog, or --all to fetch every page."
      );
      break;
    }
  } while (cursor);
  return entries;
}

export async function fetchCloudflareCatalog(
  provider?: CloudflareProvider,
  request: CatalogRequest = {}
): Promise<Catalog> {
  let providers: CloudflareProvider[];
  const notes: string[] = [];
  try {
    providers = await configuredProviders();
  } catch {
    if (!provider)
      throw new Error(
        "Cannot read Cloudflare Provider Keys. Supply CLOUDFLARE_API_TOKEN with AI Gateway Read permission, set AI_CLI_PROVIDERS, or select --provider openrouter with your Run token."
      );
    providers = [provider];
    notes.push(
      "Provider inventory unavailable; querying the explicitly selected provider through BYOK."
    );
  }
  // Workers AI authenticates the Cloudflare account itself, not a BYOK key.
  if (provider && !PROVIDER_REGISTRY[provider].storedKey)
    providers = [provider];
  else if (
    request.providers?.includes("workers-ai") &&
    !providers.includes("workers-ai")
  )
    providers.push("workers-ai");
  if (provider && !providers.includes(provider))
    throw new Error(
      `No default Cloudflare Provider Key configured for ${provider}`
    );
  if (provider) providers = [provider];
  else if (request.providers)
    providers = providers.filter((p) => request.providers!.includes(p));
  const results = await Promise.allSettled(
    providers.map((p) => providerEntries(p, request, notes))
  );
  const entries: CatalogEntry[] = [];
  const warnings: string[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") entries.push(...result.value);
    else
      warnings.push(
        `${providers[index]}: ${result.reason instanceof Error ? result.reason.message : "catalog unavailable"}`
      );
  });
  if (warnings.length === providers.length && providers.length)
    throw new Error(warnings.join("; "));
  return {
    entries: [...new Map(entries.map((e) => [e.id, e])).values()],
    providers,
    warnings,
    notes,
  };
}

export function asGatewayModels(entries: CatalogEntry[]): GatewayModels {
  const forType = (type: Modality) =>
    entries.filter((e) => e.capabilities.includes(type));
  return {
    text: forType("text"),
    image: forType("image"),
    video: forType("video"),
    speech: forType("speech"),
    transcription: forType("transcription"),
    all: entries.filter((e) => e.capabilities.length),
    lookup: entries,
    languageImageModelIds: new Set(
      entries
        .filter(
          (e) =>
            e.provider === "google" &&
            e.capabilities.includes("text") &&
            e.capabilities.includes("image")
        )
        .map((e) => e.id)
    ),
  };
}

/** Full image IDs do not need a network catalog for SDK dispatch. OpenRouter
 * owns image dispatch in its image adapter; Google's Gemini images use text.
 */
export function cloudflareImageModels(ids: string[]): GatewayModels {
  const result = asGatewayModels([]);
  result.languageImageModelIds = new Set(
    ids.filter((id) => id.startsWith("google/gemini-"))
  );
  return result;
}
