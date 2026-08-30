import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import {
  cancelResponseBody,
  DownloadError,
  fetchWithValidatedRedirects,
  readResponseWithSizeLimit,
  type FetchFunction,
} from "@ai-sdk/provider-utils";
import {
  createReplicate,
  type ReplicateProviderSettings,
} from "@ai-sdk/replicate";
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
  | "replicate";

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
]);

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
  const token = nonEmpty(env.CLOUDFLARE_API_TOKEN);

  return {
    accountId,
    gatewayId,
    headers: token ? { "cf-aig-authorization": `Bearer ${token}` } : {},
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

  throw unsupportedProviderError(modality, modelId, ["openai", "google"]);
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
    case "openai":
      throw unsupportedProviderError("video", modelId, [
        "google",
        "openrouter",
        "replicate",
      ]);
  }
}

/**
 * Google returns the completed Veo file on its own API origin, outside the
 * configured Cloudflare base URL. The stock adapter intentionally omits the
 * key on that cross-origin URL, so provide a header-authenticated downloader.
 */
export function videoDownload(modelId: string) {
  if (resolveGatewayBackend() !== "cloudflare") return undefined;

  const route = routeCloudflareModel(modelId, "video");
  if (route.provider !== "google") return undefined;

  const apiKey =
    nonEmpty(process.env.GEMINI_API_KEY) ??
    nonEmpty(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
  return apiKey ? createGoogleVideoDownload(apiKey) : undefined;
}

export function createGoogleVideoDownload(
  apiKey: string,
  fetchFunction?: FetchFunction
) {
  return async ({
    url,
    abortSignal,
  }: {
    url: URL;
    abortSignal?: AbortSignal;
  }): Promise<{ data: Uint8Array; mediaType: string | undefined }> => {
    const urlText = url.toString();
    const isGoogleFileURL =
      url.protocol === "https:" &&
      url.hostname === "generativelanguage.googleapis.com";
    const response = await fetchWithValidatedRedirects({
      url: urlText,
      headers: isGoogleFileURL ? { "x-goog-api-key": apiKey } : undefined,
      abortSignal,
      ...(fetchFunction ? { fetch: fetchFunction } : {}),
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
    case "openrouter":
    case "replicate":
      throw unsupportedProviderError("speech", modelId, ["openai", "google"]);
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
    case "openrouter":
    case "replicate":
      throw unsupportedProviderError("transcription", modelId, [
        "openai",
        "google",
      ]);
  }
}

function createCloudflareProviders(env: Environment = process.env) {
  const config = resolveCloudflareGatewayConfig(env);
  const replicateBaseURL = cloudflareProviderBaseURL("replicate", config);

  return {
    openai: createOpenAI({
      baseURL: cloudflareProviderBaseURL("openai", config),
      headers: config.headers,
      ...(nonEmpty(env.OPENAI_API_KEY)
        ? { apiKey: nonEmpty(env.OPENAI_API_KEY) }
        : {}),
    }),
    google: createGoogle({
      baseURL: cloudflareProviderBaseURL("google", config),
      headers: config.headers,
      ...((nonEmpty(env.GEMINI_API_KEY) ??
      nonEmpty(env.GOOGLE_GENERATIVE_AI_API_KEY))
        ? {
            apiKey:
              nonEmpty(env.GEMINI_API_KEY) ??
              nonEmpty(env.GOOGLE_GENERATIVE_AI_API_KEY),
          }
        : {}),
    }),
    openrouter: createOpenRouter({
      baseURL: cloudflareProviderBaseURL("openrouter", config),
      headers: config.headers,
      ...(nonEmpty(env.OPENROUTER_API_KEY)
        ? { apiKey: nonEmpty(env.OPENROUTER_API_KEY) }
        : {}),
    }),
    replicate: createReplicate({
      baseURL: replicateBaseURL,
      headers: config.headers,
      fetch: createCloudflareReplicateFetch(replicateBaseURL),
      ...(nonEmpty(env.REPLICATE_API_TOKEN)
        ? { apiToken: nonEmpty(env.REPLICATE_API_TOKEN) }
        : {}),
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
    image: ["openai", "google", "openrouter", "replicate"],
    video: ["google", "openrouter", "replicate"],
    speech: ["openai", "google"],
    transcription: ["openai", "google"],
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

type ProviderFetch = NonNullable<ReplicateProviderSettings["fetch"]>;

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
  const cloudflareFetch = async (
    input: Parameters<ProviderFetch>[0],
    init?: Parameters<ProviderFetch>[1]
  ): Promise<Response> => {
    const url = requestURL(input);
    const method = requestMethod(input, init);
    const headers = requestHeaders(input, init);
    const shouldPoll =
      method === "POST" &&
      url.startsWith(`${baseURL}/`) &&
      url.endsWith("/predictions") &&
      headers.has("prefer");

    if (shouldPoll) headers.delete("prefer");

    let response = await fetchFunction(input, { ...init, headers });
    if (!response.ok) return response;

    // Output files use this provider fetch too. Leave CDN bytes untouched.
    if (!url.startsWith(`${baseURL}/`)) return response;

    let prediction = await readReplicatePrediction(response);
    if (!prediction) return response;

    prediction = rewriteReplicatePredictionURL(prediction, baseURL);

    while (shouldPoll && !isTerminalPrediction(prediction.status)) {
      await pollDelay(pollIntervalMs, init?.signal);
      response = await fetchFunction(
        `${baseURL}/predictions/${encodeURIComponent(prediction.id)}`,
        {
          method: "GET",
          headers,
          signal: init?.signal,
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
