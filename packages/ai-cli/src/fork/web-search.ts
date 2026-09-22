/**
 * Provider search settings, verified 2026-09-21. Enable the provider's hosted
 * search only on explicit opt-in; the model still decides when to use it.
 * Gemini 3.8 free API text excludes search (429 with search, 200 without).
 * https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash
 * Keep capability decisions here so fallback attempts use their own provider.
 */
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { openrouter } from "@openrouter/ai-sdk-provider";
import type { ToolSet, JSONValue } from "ai";

import { resolveGatewayBackend, routeCloudflareModel } from "../lib/gateway.js";

export interface SearchRoute {
  provider: string;
  modelId: string;
}

/** Tools belong on generateText/streamText, not the SDK model constructor. */
export function webSearchTools(provider: string, enabled = false): ToolSet {
  if (!enabled) return {};
  switch (provider) {
    // Current Gemini models use google_search, not google_search_retrieval.
    // https://ai.google.dev/gemini-api/docs/google-search
    case "google":
      return { google_search: google.tools.googleSearch({}) };
    // Requires Responses (the default OpenAI SDK model), not Chat Completions.
    // https://developers.openai.com/api/docs/guides/tools-web-search
    case "openai":
      return { web_search: openai.tools.webSearch({}) };
    // Auto uses native search where supported, otherwise Exa. The old web
    // plugin and :online suffix are deprecated; the server executes this tool.
    // https://openrouter.ai/docs/guides/features/server-tools/web-search
    case "openrouter":
      return { web_search: openrouter.tools.webSearch({}) };
    default:
      return {};
  }
}

/**
 * Image APIs have no universal tools field. Only send flags to verified models;
 * Flux, Imagen, speech and video endpoints must not receive invented options.
 * Explicit false is sent for supported models so opt-out overrides their defaults.
 */
export function imageSearchOptions(
  route: SearchRoute,
  enabled = false
): Record<string, Record<string, JSONValue>> {
  const { provider, modelId } = route;
  if (
    provider === "fal" &&
    /^fal-ai\/nano-banana-(?:2|pro)(?:\/edit)?$/.test(modelId)
  ) {
    // https://fal.ai/models/fal-ai/nano-banana-2/api
    // https://fal.ai/models/fal-ai/nano-banana-2/edit/api
    // https://fal.ai/models/fal-ai/nano-banana-pro/api
    return { fal: { enable_web_search: enabled } };
  }
  if (provider === "replicate" && modelId === "google/nano-banana-2") {
    // https://replicate.com/google/nano-banana-2/api/schema
    return { replicate: { google_search: enabled } };
  }
  if (
    provider === "google" &&
    /^gemini-3(?:\.1)?-(?:pro|flash)-image(?:-preview)?$/.test(modelId)
  ) {
    // AI SDK image adapter forwards googleSearch to Gemini's hosted tool.
    // https://ai-sdk.dev/providers/ai-sdk-providers/google#image-models
    return enabled ? { google: { googleSearch: {} } } : {};
  }
  return {};
}

/** Vercel IDs name a creator; Cloudflare IDs name our billing provider. Do not
 * interpret an unknown Vercel creator as an OpenRouter billing route. */
export function searchRoute(
  modelId: string,
  modality: "language" | "image"
): SearchRoute {
  if (resolveGatewayBackend() === "cloudflare")
    return routeCloudflareModel(modelId, modality);
  const slash = modelId.indexOf("/");
  return {
    provider: modelId.slice(0, slash),
    modelId: modelId.slice(slash + 1),
  };
}
