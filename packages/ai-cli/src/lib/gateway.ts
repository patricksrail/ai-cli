import { createFal } from "@ai-sdk/fal";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import {
  cancelResponseBody,
  DownloadError,
  fetchWithValidatedRedirects,
  readResponseWithSizeLimit,
  type FetchFunction,
} from "@ai-sdk/provider-utils";
import { createReplicate } from "@ai-sdk/replicate";
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

const EXPLICIT_PROVIDERS = new Set<CloudflareProvider>([
  "openai",
  "google",
  "openrouter",
  "replicate",
  "fal",
]);

// Provider SDKs require a credential even when Cloudflare supplies the real
// provider key from BYOK. This value is removed before every gateway request.
const CLOUDFLARE_BYOK_CREDENTIAL = "cloudflare-byok";

/**
 * Keep upstream behavior unless Cloudflare is selected explicitly. This avoids
 * changing authentication or model routing for existing ai-cli installations.
 */
export function resolveGatewayBackend(
  env: Environment = process.env
): GatewayBackend {
  const value = env.AI_CLI_GATEWAY?.trim().toLowerCase();
  if (!value || value === "vercel") return "vercel";
  if (value === "cloudflare") return "cloudflare";
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
      "CLOUDFLARE_ACCOUNT_ID is required when AI_CLI_GATEWAY=cloudflare"
    );
  }

  const gatewayId = nonEmpty(env.CLOUDFLARE_AI_GATEWAY_ID) ?? "default";
  const token =
    nonEmpty(env.CLOUDFLARE_AI_GATEWAY_TOKEN) ??
    nonEmpty(env.CLOUDFLARE_API_TOKEN);
  if (!token) {
    throw new Error(
      "CLOUDFLARE_AI_GATEWAY_TOKEN or CLOUDFLARE_API_TOKEN is required when AI_CLI_GATEWAY=cloudflare"
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

  if (EXPLICIT_PROVIDERS.has(prefix as CloudflareProvider)) {
    const provider = prefix as CloudflareProvider;
    const strippedModelId = modelId.slice(slash + 1);
    if (slash === -1 || !strippedModelId) {
      throw new Error(`model ID must include a model after "${provider}/"`);
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
      return providers.fal.video(route.modelId);
    case "openai":
      throw unsupportedProviderError("video", modelId, [
        "google",
        "openrouter",
        "replicate",
        "fal",
      ]);
  }
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
