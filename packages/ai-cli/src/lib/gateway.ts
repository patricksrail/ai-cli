import { createFal } from "@ai-sdk/fal";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import {
  cancelResponseBody,
  convertImageModelFileToDataUri,
  DownloadError,
  fetchWithValidatedRedirects,
  readResponseWithSizeLimit,
  type FetchFunction,
} from "@ai-sdk/provider-utils";
import { createReplicate } from "@ai-sdk/replicate";
import { createFalClient } from "@fal-ai/client";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  gateway as vercelGateway,
  type ImageModel,
  type LanguageModel,
  type SpeechModel,
  type TranscriptionModel,
} from "ai";

type Environment = Record<string, string | undefined>;

export type GatewayBackend = "vercel" | "cloudflare";
export type GatewayModality =
  | "language"
  | "image"
  | "video"
  | "speech"
  | "transcription";
export type CloudflareProvider =
  | "openai"
  | "google"
  | "openrouter"
  | "replicate"
  | "fal";

export interface CloudflareGatewayConfig {
  accountId: string;
  gatewayId: string;
  headers: Record<string, string>;
}

export interface CloudflareModelRoute {
  provider: CloudflareProvider;
  modelId: string;
}

const EXPLICIT_PROVIDER_PREFIXES = new Map<string, CloudflareProvider>([
  ["openai", "openai"],
  ["google", "google"],
  ["openrouter", "openrouter"],
  ["replicate", "replicate"],
  ["fal", "fal"],
]);

// Provider SDKs require a credential even when Cloudflare supplies the real
// provider key from BYOK. This value is removed before every gateway request.
const CLOUDFLARE_BYOK_CREDENTIAL = "cloudflare-byok";

/** Cloudflare BYOK is the default in this fork; Vercel remains opt-in. */
export function resolveGatewayBackend(
  env: Environment = process.env
): GatewayBackend {
  const value = env.AI_CLI_GATEWAY?.trim().toLowerCase();
  if (!value || value === "cloudflare") return "cloudflare";
  if (value === "vercel") return "vercel";
  throw new Error(
    `AI_CLI_GATEWAY must be one of: vercel, cloudflare (got ${JSON.stringify(env.AI_CLI_GATEWAY)})`
  );
}

export function resolveCloudflareGatewayConfig(
  env: Environment = process.env
): CloudflareGatewayConfig {
  const accountId = nonEmpty(env.CLOUDFLARE_ACCOUNT_ID);
  if (!accountId) {
    throw new Error(
      "CLOUDFLARE_ACCOUNT_ID is required when using the Cloudflare gateway"
    );
  }

  const gatewayId = nonEmpty(env.CLOUDFLARE_AI_GATEWAY_ID) ?? "ai-cli";
  const token =
    nonEmpty(env.CLOUDFLARE_AI_GATEWAY_TOKEN) ??
    nonEmpty(env.CLOUDFLARE_API_TOKEN);
  if (!token) {
    throw new Error(
      "CLOUDFLARE_AI_GATEWAY_TOKEN or CLOUDFLARE_API_TOKEN is required when using the Cloudflare gateway"
    );
  }

  return {
    accountId,
    gatewayId,
    headers: { "cf-aig-authorization": `Bearer ${token}` },
  };
}

export function cloudflareProviderBaseURL(
  provider: CloudflareProvider,
  config: Pick<CloudflareGatewayConfig, "accountId" | "gatewayId">
): string {
  const gatewayURL = `https://gateway.ai.cloudflare.com/v1/${config.accountId}/${config.gatewayId}`;
  switch (provider) {
    case "openai":
      return `${gatewayURL}/openai`;
    case "google":
      return `${gatewayURL}/google-ai-studio/v1beta`;
    case "openrouter":
      return `${gatewayURL}/openrouter/v1`;
    case "replicate":
      return `${gatewayURL}/replicate`;
    case "fal":
      return `${gatewayURL}/fal`;
  }
}

/**
 * Explicit provider prefixes select that provider and are removed once. This
 * preserves nested IDs such as openrouter/openai/gpt-5-mini and
 * replicate/owner/model. Creator-style IDs fall back to OpenRouter for text and
 * Replicate for generated media, retaining the complete ID.
 */
export function routeCloudflareModel(
  modelId: string,
  modality: GatewayModality
): CloudflareModelRoute {
  const slash = modelId.indexOf("/");
  const prefix = slash === -1 ? modelId : modelId.slice(0, slash);

  if (prefix === "fal-ai") {
    const remainder = modelId.slice(slash + 1);
    if (slash === -1 || !remainder) {
      throw new Error('model ID must include a model after "fal-ai/"');
    }
    assertProviderSupports("fal", modality, modelId);

    // Most Fal-owned endpoint IDs themselves begin with `fal-ai/`, so retain
    // that namespace. H3 Max is published under Fal's top-level `minimax/`
    // namespace; accept the intuitive host-qualified spelling for this model.
    const falEndpoint = remainder.startsWith("minimax/h3-max")
      ? remainder
      : modelId;
    return { provider: "fal", modelId: falEndpoint };
  }

  const explicitProvider = EXPLICIT_PROVIDER_PREFIXES.get(prefix);
  if (explicitProvider) {
    const provider = explicitProvider;
    const strippedModelId = modelId.slice(slash + 1);
    if (slash === -1 || !strippedModelId) {
      throw new Error(`model ID must include a model after "${prefix}/"`);
    }
    assertProviderSupports(provider, modality, modelId);
    return { provider, modelId: strippedModelId };
  }

  if (modality === "language") {
    return { provider: "openrouter", modelId };
  }
  if (modality === "image" || modality === "video") {
    return { provider: "replicate", modelId };
  }

  throw unsupportedProviderError(modality, modelId, [
    "openai",
    "google",
    "fal",
  ]);
}

export function languageModel(modelId: string): LanguageModel {
  if (resolveGatewayBackend() === "vercel") return vercelGateway(modelId);

  const route = routeCloudflareModel(modelId, "language");
  const providers = createCloudflareProviders();
  switch (route.provider) {
    case "openai":
      return providers.openai(route.modelId);
    case "google":
      return providers.google(route.modelId);
    case "openrouter":
      return providers.openrouter(route.modelId);
    case "replicate":
      throw unsupportedProviderError("language", modelId, [
        "openai",
        "google",
        "openrouter",
      ]);
    case "fal":
      throw unsupportedProviderError("language", modelId, [
        "openai",
        "google",
        "openrouter",
      ]);
  }
}

export function imageModel(modelId: string): ImageModel {
  if (resolveGatewayBackend() === "vercel") return vercelGateway.image(modelId);

  const route = routeCloudflareModel(modelId, "image");
  const providers = createCloudflareProviders();
  switch (route.provider) {
    case "openai":
      return providers.openai.image(route.modelId);
    case "google":
      return providers.google.image(route.modelId);
    case "openrouter":
      return providers.openrouter.imageModel(route.modelId);
    case "replicate":
      return providers.replicate.image(route.modelId);
    case "fal":
      return providers.fal.image(route.modelId);
  }
}

type GatewayVideoModel = ReturnType<typeof vercelGateway.video>;

export function videoModel(modelId: string): GatewayVideoModel {
  if (resolveGatewayBackend() === "vercel") return vercelGateway.video(modelId);

  const route = routeCloudflareModel(modelId, "video");
  const providers = createCloudflareProviders();
  switch (route.provider) {
    case "google":
      return providers.google.video(route.modelId);
    case "openrouter":
      return providers.openrouter.videoModel(route.modelId);
    case "replicate":
      return providers.replicate.video(route.modelId);
    case "fal":
      // The AI SDK Fal video adapter prepends `fal-ai/` to every queue path.
      // That is valid for Fal-owned endpoints, but breaks publisher namespaces
      // such as the official `minimax/h3-max/...` endpoints. Use Fal's own
      // queue client for those paths; it owns submit, polling, and result calls.
      return route.modelId.startsWith("fal-ai/")
        ? providers.fal.video(route.modelId)
        : createCloudflareFalQueueVideoModel(route.modelId);
    case "openai":
      throw unsupportedProviderError("video", modelId, [
        "google",
        "openrouter",
        "replicate",
        "fal",
      ]);
  }
}

type FalQueueVideoModel = GatewayVideoModel;
type FalQueueVideoOptions = Parameters<
  NonNullable<FalQueueVideoModel["doGenerate"]>
>[0];

interface FalQueueVideoResult {
  data: unknown;
  requestId: string;
}

interface FalQueueVideoClient {
  subscribe(
    endpointId: string,
    options: {
      input: Record<string, unknown>;
      abortSignal?: AbortSignal;
      headers?: Record<string, string>;
      logs?: boolean;
      mode?: "polling";
    }
  ): Promise<FalQueueVideoResult>;
}

interface FalQueueClientSettings {
  proxyUrl: { url: string; when: "always" };
  fetch: ProviderFetch;
}

type FalQueueVideoClientFactory = (
  settings: FalQueueClientSettings
) => FalQueueVideoClient;

const createOfficialFalQueueVideoClient: FalQueueVideoClientFactory = (
  settings
) => {
  const client = createFalClient(settings);
  return {
    subscribe: (endpointId, options) => client.subscribe(endpointId, options),
  };
};

/**
 * Adapt Fal's official queue client to the AI SDK video interface. Cloudflare
 * documents this exact SDK proxy setup for provider-native Fal requests.
 */
export function createCloudflareFalQueueVideoModel(
  modelId: string,
  env: Environment = process.env,
  createClient: FalQueueVideoClientFactory = createOfficialFalQueueVideoClient
): FalQueueVideoModel {
  const config = resolveCloudflareGatewayConfig(env);
  const client = createClient({
    proxyUrl: {
      url: cloudflareProviderBaseURL("fal", config),
      // @fal-ai/client applies a string proxy URL only in browsers by default.
      when: "always",
    },
    // Cloudflare injects the stored Fal key. The Fal client receives no local
    // provider credential; this fetch authenticates only the gateway request.
    fetch: createCloudflareFalClientFetch(config.headers),
  });

  return {
    specificationVersion: "v4",
    provider: "fal.video",
    modelId,
    maxVideosPerCall: 1,
    async doGenerate(options) {
      const endpointId = resolveFalQueueVideoEndpoint(modelId, options.image);
      const input = falQueueVideoInput(endpointId, options);
      const result = await client.subscribe(endpointId, {
        input,
        abortSignal: options.abortSignal,
        headers: definedHeaders(options.headers),
        logs: false,
        mode: "polling",
      });
      const response = falVideoResponse(result.data);

      return {
        videos: [
          {
            type: "url" as const,
            url: response.video.url,
            mediaType: response.video.content_type ?? "video/mp4",
          },
        ],
        warnings: [],
        providerMetadata: {
          fal: {
            requestId: result.requestId,
            videos: [compactFalVideoMetadata(response.video)],
          },
        },
        response: {
          timestamp: new Date(),
          modelId,
          headers: result.requestId
            ? { "x-request-id": result.requestId }
            : undefined,
        },
      };
    },
  };
}

function resolveFalQueueVideoEndpoint(
  modelId: string,
  image: FalQueueVideoOptions["image"]
): string {
  if (/^minimax\/h3-max(?:\/(?:text|image)-to-video)?$/.test(modelId)) {
    return `minimax/h3-max/${image ? "image" : "text"}-to-video`;
  }
  return modelId;
}

function falQueueVideoInput(
  endpointId: string,
  options: FalQueueVideoOptions
): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  if (options.prompt != null) input.prompt = options.prompt;
  if (options.image != null) {
    input.image_url =
      options.image.type === "url"
        ? options.image.url
        : convertImageModelFileToDataUri(options.image);
  }
  if (options.aspectRatio != null) input.aspect_ratio = options.aspectRatio;
  if (options.duration != null) input.duration = options.duration;
  if (options.resolution != null) {
    input.resolution = falQueueVideoResolution(endpointId, options.resolution);
  }
  if (options.seed != null) input.seed = options.seed;

  if (endpointId.startsWith("minimax/h3-max/")) {
    // These are the documented defaults, but H3 Max's current schema marks
    // prompt_expansion_mode as required. Sending both keeps first calls stable.
    input.prompt_expansion_mode = "balanced";
    input.enable_safety_checker = true;
  }

  return input;
}

function falQueueVideoResolution(
  endpointId: string,
  resolution: `${number}x${number}`
): string {
  if (endpointId.startsWith("minimax/h3-max/")) {
    const height = resolution.slice(resolution.indexOf("x") + 1);
    if (height === "480" || height === "768") return `${height}P`;
  }
  return resolution;
}

interface FalVideoFile {
  url: string;
  content_type?: string | null;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  fps?: number | null;
}

function falVideoResponse(value: unknown): { video: FalVideoFile } {
  if (!isRecord(value) || !isRecord(value.video)) {
    throw new Error("Fal completed the request without a video result");
  }
  const rawVideo = value.video;
  const url = rawVideo.url;
  if (typeof url !== "string" || !url) {
    throw new Error("Fal completed the request without a video URL");
  }
  return {
    video: {
      url,
      content_type: optionalString(rawVideo.content_type),
      width: optionalNumber(rawVideo.width),
      height: optionalNumber(rawVideo.height),
      duration: optionalNumber(rawVideo.duration),
      fps: optionalNumber(rawVideo.fps),
    },
  };
}

function compactFalVideoMetadata(
  video: FalVideoFile
): Record<string, string | number> {
  const metadata: Record<string, string | number> = { url: video.url };
  if (video.content_type != null) metadata.contentType = video.content_type;
  if (video.width != null) metadata.width = video.width;
  if (video.height != null) metadata.height = video.height;
  if (video.duration != null) metadata.duration = video.duration;
  if (video.fps != null) metadata.fps = video.fps;
  return metadata;
}

function definedHeaders(
  headers: Record<string, string | undefined> | undefined
): Record<string, string> | undefined {
  if (!headers) return undefined;
  return Object.fromEntries(
    Object.entries(headers).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/** Route provider-hosted video results back through Cloudflare BYOK. */
export function videoDownload(modelId: string) {
  if (resolveGatewayBackend() !== "cloudflare") return undefined;

  const route = routeCloudflareModel(modelId, "video");
  const config = resolveCloudflareGatewayConfig();
  switch (route.provider) {
    case "google":
      return createCloudflareGoogleVideoDownload(
        cloudflareProviderBaseURL("google", config),
        config.headers
      );
    case "openrouter":
      return createCloudflareOpenRouterVideoDownload(
        cloudflareProviderBaseURL("openrouter", config),
        config.headers
      );
    default:
      return undefined;
  }
}

export function createCloudflareGoogleVideoDownload(
  baseURL: string,
  gatewayHeaders: Record<string, string>,
  fetchFunction?: FetchFunction
) {
  return createCloudflareProviderVideoDownload(
    baseURL,
    gatewayHeaders,
    (url) => {
      const isGoogleFileURL =
        url.protocol === "https:" &&
        url.hostname === "generativelanguage.googleapis.com" &&
        (url.pathname === "/v1beta" || url.pathname.startsWith("/v1beta/"));
      if (!isGoogleFileURL) return undefined;

      const gatewayURL = new URL(
        `${baseURL}${url.pathname.slice("/v1beta".length)}${url.search}`
      );
      // The Google SDK can append a provider key to its file URL.
      gatewayURL.searchParams.delete("key");
      return gatewayURL;
    },
    fetchFunction
  );
}

export function createCloudflareOpenRouterVideoDownload(
  baseURL: string,
  gatewayHeaders: Record<string, string>,
  fetchFunction?: FetchFunction
) {
  return createCloudflareProviderVideoDownload(
    baseURL,
    gatewayHeaders,
    (url) => {
      const isOpenRouterVideoURL =
        url.protocol === "https:" &&
        url.host === "openrouter.ai" &&
        /^\/api\/v1\/videos\/[^/]+\/content$/.test(url.pathname);
      return isOpenRouterVideoURL
        ? new URL(
            `${baseURL}${url.pathname.slice("/api/v1".length)}${url.search}`
          )
        : undefined;
    },
    fetchFunction
  );
}

function createCloudflareProviderVideoDownload(
  baseURL: string,
  gatewayHeaders: Record<string, string>,
  mapToGatewayURL: (url: URL) => URL | undefined,
  fetchFunction?: FetchFunction
) {
  return async ({
    url,
    abortSignal,
  }: {
    url: URL;
    abortSignal?: AbortSignal;
  }): Promise<{ data: Uint8Array; mediaType: string | undefined }> => {
    const gatewayURL = mapToGatewayURL(url);
    const downloadURL = gatewayURL ?? url;
    const urlText = downloadURL.toString();
    const response = await fetchWithValidatedRedirects({
      url: urlText,
      headers: gatewayURL
        ? cloudflareGatewayHeaders(gatewayHeaders)
        : undefined,
      abortSignal,
      ...(fetchFunction ? { fetch: fetchFunction } : {}),
      trustedOrigin: baseURL,
    });

    if (!response.ok) {
      await cancelResponseBody(response);
      throw new DownloadError({
        url: urlText,
        statusCode: response.status,
        statusText: response.statusText,
      });
    }

    return {
      data: await readResponseWithSizeLimit({ response, url: urlText }),
      mediaType: response.headers.get("content-type") ?? undefined,
    };
  };
}

export function speechModel(modelId: string): SpeechModel {
  if (resolveGatewayBackend() === "vercel")
    return vercelGateway.speechModel(modelId);

  const route = routeCloudflareModel(modelId, "speech");
  const providers = createCloudflareProviders();
  switch (route.provider) {
    case "openai":
      return providers.openai.speech(route.modelId);
    case "google":
      return providers.google.speech(route.modelId);
    case "fal":
      return providers.fal.speech(route.modelId);
    case "openrouter":
    case "replicate":
      throw unsupportedProviderError("speech", modelId, [
        "openai",
        "google",
        "fal",
      ]);
  }
}

export function transcriptionModel(modelId: string): TranscriptionModel {
  if (resolveGatewayBackend() === "vercel")
    return vercelGateway.transcriptionModel(modelId);

  const route = routeCloudflareModel(modelId, "transcription");
  const providers = createCloudflareProviders();
  switch (route.provider) {
    case "openai":
      return providers.openai.transcription(route.modelId);
    case "google":
      return providers.google.transcription(route.modelId);
    case "fal":
      // The Fal transcription adapter inserts `fal-ai/` itself.
      return withCloudflareFalTranscriptionDefaults(
        providers.fal.transcription(route.modelId.replace(/^fal-ai\//, ""))
      );
    case "openrouter":
    case "replicate":
      throw unsupportedProviderError("transcription", modelId, [
        "openai",
        "google",
        "fal",
      ]);
  }
}

type FalTranscriptionModel = ReturnType<
  ReturnType<typeof createFal>["transcription"]
>;

/**
 * Fal's current transcription API accepts segment chunks by default, while
 * the SDK emits the older word default when no Fal provider options exist.
 */
export function withCloudflareFalTranscriptionDefaults(
  model: FalTranscriptionModel
): FalTranscriptionModel {
  const doGenerate = model.doGenerate.bind(model);
  model.doGenerate = (options) =>
    doGenerate({
      ...options,
      providerOptions: {
        ...options.providerOptions,
        fal: {
          chunkLevel: "segment",
          ...options.providerOptions?.fal,
        },
      },
    });
  return model;
}

function createCloudflareProviders(env: Environment = process.env) {
  const config = resolveCloudflareGatewayConfig(env);
  const replicateBaseURL = cloudflareProviderBaseURL("replicate", config);
  const falBaseURL = cloudflareProviderBaseURL("fal", config);
  const byokFetch = createCloudflareByokFetch();

  return {
    openai: createOpenAI({
      apiKey: CLOUDFLARE_BYOK_CREDENTIAL,
      baseURL: cloudflareProviderBaseURL("openai", config),
      headers: config.headers,
      fetch: byokFetch,
    }),
    google: createGoogle({
      apiKey: CLOUDFLARE_BYOK_CREDENTIAL,
      baseURL: cloudflareProviderBaseURL("google", config),
      headers: config.headers,
      fetch: byokFetch,
    }),
    openrouter: createOpenRouter({
      apiKey: CLOUDFLARE_BYOK_CREDENTIAL,
      baseURL: cloudflareProviderBaseURL("openrouter", config),
      headers: config.headers,
      fetch: byokFetch,
    }),
    replicate: createReplicate({
      apiToken: CLOUDFLARE_BYOK_CREDENTIAL,
      baseURL: replicateBaseURL,
      headers: config.headers,
      fetch: createCloudflareReplicateFetch(replicateBaseURL),
    }),
    fal: createFal({
      apiKey: CLOUDFLARE_BYOK_CREDENTIAL,
      baseURL: falBaseURL,
      headers: config.headers,
      fetch: createCloudflareFalFetch(falBaseURL),
    }),
  };
}

function assertProviderSupports(
  provider: CloudflareProvider,
  modality: GatewayModality,
  originalModelId: string
): void {
  const supported: Record<GatewayModality, CloudflareProvider[]> = {
    language: ["openai", "google", "openrouter"],
    image: ["openai", "google", "openrouter", "replicate", "fal"],
    video: ["google", "openrouter", "replicate", "fal"],
    speech: ["openai", "google", "fal"],
    transcription: ["openai", "google", "fal"],
  };
  if (!supported[modality].includes(provider)) {
    throw unsupportedProviderError(
      modality,
      originalModelId,
      supported[modality]
    );
  }
}

function unsupportedProviderError(
  modality: GatewayModality,
  modelId: string,
  supportedProviders: CloudflareProvider[]
): Error {
  const prefixes = supportedProviders
    .map((provider) => `${provider}/`)
    .join(", ");
  return new Error(
    `Cloudflare ${modality} model ${JSON.stringify(modelId)} is not supported; use one of these provider prefixes: ${prefixes}`
  );
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

type ProviderFetch = FetchFunction;

/**
 * Cloudflare injects the stored provider key. Provider SDK credentials are
 * placeholders only and must never reach the gateway.
 */
export function createCloudflareByokFetch(
  fetchFunction: ProviderFetch = globalThis.fetch
): ProviderFetch {
  const cloudflareFetch = async (
    input: Parameters<ProviderFetch>[0],
    init?: Parameters<ProviderFetch>[1]
  ): Promise<Response> => {
    const url = requestURL(input);
    if (!isCloudflareGatewayURL(url)) return fetchFunction(input, init);

    return fetchFunction(input, {
      ...init,
      headers: cloudflareGatewayHeaders(requestHeaders(input, init)),
    });
  };

  return Object.assign(cloudflareFetch, {
    preconnect: fetchFunction.preconnect,
  });
}

/** Authenticate Fal's SDK proxy without presenting the Cloudflare token as a Fal key. */
export function createCloudflareFalClientFetch(
  gatewayHeaders: Record<string, string>,
  fetchFunction: ProviderFetch = globalThis.fetch
): ProviderFetch {
  const cloudflareFetch = async (
    input: Parameters<ProviderFetch>[0],
    init?: Parameters<ProviderFetch>[1]
  ): Promise<Response> => {
    const url = requestURL(input);
    if (!isCloudflareGatewayURL(url)) return fetchFunction(input, init);

    const headers = cloudflareGatewayHeaders(requestHeaders(input, init));
    for (const [name, value] of Object.entries(gatewayHeaders)) {
      headers.set(name, value);
    }
    return fetchFunction(input, { ...init, headers });
  };

  return Object.assign(cloudflareFetch, {
    preconnect: fetchFunction.preconnect,
  });
}

/**
 * Fal's image adapter honors baseURL, while its speech, transcription, and
 * video adapters use absolute Fal URLs. Cloudflare's Fal route accepts those
 * alternative targets in `x-fal-target-url` on the provider base endpoint.
 */
export function createCloudflareFalFetch(
  baseURL: string,
  fetchFunction: ProviderFetch = globalThis.fetch
): ProviderFetch {
  const byokFetch = createCloudflareByokFetch(fetchFunction);
  const cloudflareFetch = async (
    input: Parameters<ProviderFetch>[0],
    init?: Parameters<ProviderFetch>[1]
  ): Promise<Response> => {
    const request = normalizeRequestInput(input, init);
    const targetURL = request?.url ?? requestURL(input);
    if (!isFalInferenceURL(targetURL)) return byokFetch(input, init);

    const headers = request
      ? new Headers(request.headers)
      : requestHeaders(input, init);
    headers.set("x-fal-target-url", targetURL);
    if (request) {
      return byokFetch(new Request(baseURL, request), { headers });
    }
    return byokFetch(baseURL, { ...init, headers });
  };

  return Object.assign(cloudflareFetch, {
    preconnect: fetchFunction.preconnect,
  });
}

function cloudflareGatewayHeaders(headers: HeadersInit): Headers {
  const sanitized = new Headers(headers);
  sanitized.delete("authorization");
  sanitized.delete("x-goog-api-key");
  return sanitized;
}

function isCloudflareGatewayURL(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname === "gateway.ai.cloudflare.com"
    );
  } catch {
    return false;
  }
}

function isFalInferenceURL(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      (parsed.hostname === "fal.run" || parsed.hostname === "queue.fal.run")
    );
  } catch {
    return false;
  }
}

interface ReplicatePrediction {
  id: string;
  status: string;
  output?: unknown;
  error?: unknown;
  urls?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Cloudflare forwards Replicate's asynchronous prediction envelope even when
 * the image SDK asks Replicate to wait. Poll through the gateway so image calls
 * still receive the completed shape they expect. Rewriting `urls.get` also
 * keeps the video SDK's later status checks on the Cloudflare origin.
 */
export function createCloudflareReplicateFetch(
  baseURL: string,
  fetchFunction: ProviderFetch = globalThis.fetch,
  pollIntervalMs = 1_000
): ProviderFetch {
  const byokFetch = createCloudflareByokFetch(fetchFunction);
  const cloudflareFetch = async (
    input: Parameters<ProviderFetch>[0],
    init?: Parameters<ProviderFetch>[1]
  ): Promise<Response> => {
    const request = normalizeRequestInput(input, init);
    const url = request?.url ?? requestURL(input);
    const method = request?.method ?? requestMethod(input, init);
    const headers = request
      ? new Headers(request.headers)
      : requestHeaders(input, init);
    const signal = request?.signal ?? init?.signal;
    const shouldPoll =
      method === "POST" &&
      url.startsWith(`${baseURL}/`) &&
      url.endsWith("/predictions") &&
      headers.has("prefer");

    if (shouldPoll) headers.delete("prefer");

    const sourceBody =
      request && request.body && isReplicateFlux2ModelURL(url, baseURL)
        ? await request.clone().text()
        : init?.body;
    const body = rewriteReplicateFlux2InputImages(
      url,
      baseURL,
      method,
      sourceBody
    );
    if (body !== sourceBody) headers.delete("content-length");
    const outboundInput = request
      ? new Request(request, {
          headers,
          ...(body === undefined ? {} : { body }),
        })
      : input;
    let response = await byokFetch(
      outboundInput,
      request ? undefined : { ...init, body, headers }
    );
    if (!response.ok) return response;

    // Output files use this provider fetch too. Leave CDN bytes untouched.
    if (!url.startsWith(`${baseURL}/`)) return response;

    let prediction = await readReplicatePrediction(response);
    if (!prediction) return response;

    prediction = rewriteReplicatePredictionURL(prediction, baseURL);

    while (shouldPoll && !isTerminalPrediction(prediction.status)) {
      await pollDelay(pollIntervalMs, signal);
      response = await byokFetch(
        `${baseURL}/predictions/${encodeURIComponent(prediction.id)}`,
        {
          method: "GET",
          headers,
          signal,
        }
      );
      if (!response.ok) return response;

      const nextPrediction = await readReplicatePrediction(response);
      if (!nextPrediction) return response;
      prediction = rewriteReplicatePredictionURL(nextPrediction, baseURL);
    }

    if (
      shouldPoll &&
      (prediction.status === "failed" || prediction.status === "canceled")
    ) {
      return jsonResponse(
        response,
        {
          error:
            typeof prediction.error === "string"
              ? prediction.error
              : `Replicate prediction ${prediction.status}`,
        },
        400
      );
    }

    return jsonResponse(response, prediction);
  };

  return Object.assign(cloudflareFetch, {
    preconnect: fetchFunction.preconnect,
  });
}

function requestURL(input: Parameters<ProviderFetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function normalizeRequestInput(
  input: Parameters<ProviderFetch>[0],
  init?: Parameters<ProviderFetch>[1]
): Request | undefined {
  return input instanceof Request ? new Request(input, init) : undefined;
}

function requestMethod(
  input: Parameters<ProviderFetch>[0],
  init?: Parameters<ProviderFetch>[1]
): string {
  return (init?.method ?? (input instanceof Request ? input.method : "GET"))
    .trim()
    .toUpperCase();
}

function requestHeaders(
  input: Parameters<ProviderFetch>[0],
  init?: Parameters<ProviderFetch>[1]
): Headers {
  const headers = new Headers(input instanceof Request ? input.headers : {});
  const overrides = new Headers(init?.headers);
  overrides.forEach((value, key) => headers.set(key, value));
  return headers;
}

/** Adapt the SDK's former numbered Flux 2 fields to Replicate's array schema. */
function rewriteReplicateFlux2InputImages(
  url: string,
  baseURL: string,
  method: string,
  body: BodyInit | null | undefined
): BodyInit | null | undefined {
  if (
    method !== "POST" ||
    typeof body !== "string" ||
    !isReplicateFlux2ModelURL(url, baseURL)
  ) {
    return body;
  }

  try {
    const payload: unknown = JSON.parse(body);
    if (typeof payload !== "object" || payload === null) return body;
    const inputValue = (payload as { input?: unknown }).input;
    if (typeof inputValue !== "object" || inputValue === null) return body;

    const input = inputValue as Record<string, unknown>;
    const numberedImages = Object.entries(input)
      .flatMap(([key, value]) => {
        const match = /^input_image(?:_(\d+))?$/.exec(key);
        return match
          ? [{ key, position: match[1] ? Number(match[1]) : 1, value }]
          : [];
      })
      .sort((left, right) => left.position - right.position);
    if (numberedImages.length === 0) return body;

    const rewrittenInput = { ...input };
    for (const image of numberedImages) delete rewrittenInput[image.key];
    rewrittenInput.input_images = numberedImages.map((image) => image.value);

    return JSON.stringify({ ...payload, input: rewrittenInput });
  } catch {
    return body;
  }
}

function isReplicateFlux2ModelURL(url: string, baseURL: string): boolean {
  try {
    const parsedURL = new URL(url);
    const parsedBaseURL = new URL(baseURL);
    const basePath = parsedBaseURL.pathname.replace(/\/$/, "");
    const modelPathPrefix = `${basePath}/models/black-forest-labs/flux-2-`;
    const modelPath = parsedURL.pathname.slice(modelPathPrefix.length);
    return (
      parsedURL.origin === parsedBaseURL.origin &&
      parsedURL.pathname.startsWith(modelPathPrefix) &&
      /^[^/]+\/predictions$/.test(modelPath)
    );
  } catch {
    return false;
  }
}

async function readReplicatePrediction(
  response: Response
): Promise<ReplicatePrediction | null> {
  try {
    const value: unknown = await response.clone().json();
    if (
      typeof value !== "object" ||
      value === null ||
      !("id" in value) ||
      typeof value.id !== "string" ||
      !("status" in value) ||
      typeof value.status !== "string"
    ) {
      return null;
    }
    return value as ReplicatePrediction;
  } catch {
    return null;
  }
}

function rewriteReplicatePredictionURL(
  prediction: ReplicatePrediction,
  baseURL: string
): ReplicatePrediction {
  return {
    ...prediction,
    urls: {
      ...prediction.urls,
      get: `${baseURL}/predictions/${encodeURIComponent(prediction.id)}`,
    },
  };
}

function isTerminalPrediction(status: string): boolean {
  return status === "succeeded" || status === "failed" || status === "canceled";
}

function jsonResponse(
  source: Response,
  value: unknown,
  status = source.status
): Response {
  const headers = new Headers(source.headers);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(value), {
    status,
    statusText: status === source.status ? source.statusText : undefined,
    headers,
  });
}

async function pollDelay(
  milliseconds: number,
  signal?: AbortSignal | null
): Promise<void> {
  if (signal?.aborted) throw signal.reason;
  if (milliseconds <= 0) return;

  await new Promise<void>((resolve, reject) => {
    const handleAbort = () => {
      clearTimeout(timeout);
      reject(signal?.reason);
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", handleAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}
