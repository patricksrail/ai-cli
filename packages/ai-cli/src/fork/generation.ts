/**
 * CLI generation policy. Commands pass their routing options through runJobs
 * explicitly; no ambient execution context is needed to understand a request.
 *
 * Flow: select allowed routes -> execute via fallback.ts -> report guidance.
 * Catalog alternatives are separate in alternatives.ts and never run inference.
 */
import { errorMessage } from "../lib/errors.js";
import { resolveGatewayBackend, routeCloudflareModel } from "../lib/gateway.js";
import type { Modality } from "../lib/models.js";
import { fetchCloudflareCatalog } from "./catalog.js";
import { runWithFallback, type GenerationResult } from "./fallback.js";
import { googleFreeTier } from "./google-pricing.js";
import { modelPreferences, resolveModel } from "./model-preferences.js";
import { isFreeOffer } from "./selection.js";

// Inputs carried explicitly from command flags -------------------------------

export interface GenerationPolicy {
  /** --no-fallback sets false; otherwise the saved order is enabled. */
  fallback?: boolean;
  /** Comma-separated --fallbacks value; replaces the saved order. */
  fallbacks?: string;
  free?: boolean;
  provider?: string;
}
export interface GenerationOptions {
  modality: Modality;
  quiet?: boolean;
  routing?: GenerationPolicy;
}

/** Cloudflare uses our one-attempt-per-route loop. Vercel keeps the upstream
 * SDK retry defaults; returning no override is intentional and regression-tested. */
export function generationRetryOptions(): { maxRetries?: number } {
  return resolveGatewayBackend() === "cloudflare" ? { maxRetries: 0 } : {};
}

// Select permitted routes before making a generation request ------------------

export async function fallbackCandidates(
  primaryRoute: string,
  modality: Modality,
  policy: GenerationPolicy = {}
): Promise<string[]> {
  if (policy.fallback === false) return [primaryRoute];
  const preferences = modelPreferences();
  const savedFallbacks = policy.free
    ? (preferences.bestFree[modality] ?? [])
    : (preferences.fallbacks[primaryRoute] ?? []);
  const requestedFallbacks =
    policy.fallbacks?.split(",").map((route) => route.trim()) ?? savedFallbacks;
  const fallbackRoutes = requestedFallbacks.map(
    (route) => resolveModel(route, { modality, preferences }).route
  );
  let candidates = [...new Set([primaryRoute, ...fallbackRoutes])];

  if (policy.provider) {
    const selectedProvider = policy.provider.toLowerCase();
    const otherHosts = candidates.filter(
      (route) => providerFor(route, modality) !== selectedProvider
    );
    // Saved cross-host recovery is filtered. An explicitly conflicting list is
    // a user input error, so fail before submitting even the primary request.
    if (policy.fallbacks !== undefined && otherHosts.length) {
      throw new Error(
        "Fallback routes must use the explicit --provider; omit --provider to allow other hosts"
      );
    }
    candidates = candidates.filter((route) => !otherHosts.includes(route));
  }
  if (policy.free && candidates.length > 1) {
    const allowedFallbacks = await verifiedFreeFallbacks(
      candidates.slice(1),
      modality
    );
    if (
      policy.fallbacks !== undefined &&
      allowedFallbacks.length !== candidates.length - 1
    ) {
      throw new Error(
        "--free fallback is not listed as free; choose a verified free route"
      );
    }
    // Initial selection already checked the primary. Missing catalog evidence
    // removes a fallback, never the validated primary or the free-only rule.
    candidates = [primaryRoute, ...allowedFallbacks];
  }
  return candidates;
}

function providerFor(route: string, modality: Modality) {
  return routeCloudflareModel(
    route,
    modality === "text" ? "language" : modality
  ).provider;
}

async function verifiedFreeFallbacks(
  routes: string[],
  modality: Modality
): Promise<string[]> {
  const providers = [
    ...new Set(routes.map((route) => providerFor(route, modality))),
  ];
  // Query only the selected hosts. Run-only gateway credentials need not be
  // able to enumerate every configured provider key to verify these routes.
  const catalogs = await Promise.allSettled(
    providers.map((provider) => fetchCloudflareCatalog(provider))
  );
  const freeRoutes = new Set<string>();
  for (const catalog of catalogs) {
    if (catalog.status === "rejected") {
      process.stderr.write(
        `Warning: free fallback catalog unavailable; omitting unverified routes: ${errorMessage(catalog.reason)}\n`
      );
      continue;
    }
    for (const entry of catalog.value.entries) {
      if (entry.capabilities.includes(modality) && isFreeOffer(entry))
        freeRoutes.add(entry.id);
    }
  }
  return routes.filter((route) => freeRoutes.has(route));
}

// Execute and explain the result ---------------------------------------------

export async function generateWithGuidance<T>(
  primaryRoute: string,
  generate: (model: string) => Promise<T>,
  options: GenerationOptions
): Promise<GenerationResult<T>> {
  if (resolveGatewayBackend() !== "cloudflare") {
    // The SDK owns internal Vercel retries. Our attempt metadata records the
    // selected route, not each of those internal HTTP requests.
    return {
      value: await generate(primaryRoute),
      model: primaryRoute,
      attempts: [{ model: primaryRoute, status: "success" }],
    };
  }
  const { modality, quiet, routing } = options;
  const candidates = await fallbackCandidates(primaryRoute, modality, routing);
  try {
    return await runWithFallback(
      candidates,
      async (modelRoute) => {
        if (!quiet) announceRoute(modelRoute, primaryRoute);
        return generate(modelRoute);
      },
      {
        modality,
        onAttempt: (attempt) => {
          if (quiet || attempt.status !== "failed") return;
          const httpStatus = attempt.failure?.statusCode;
          const statusDetail = httpStatus ? ` (HTTP ${httpStatus})` : "";
          process.stderr.write(
            `Failed ${attempt.model}: ${attempt.failure?.kind}${statusDetail}\n`
          );
        },
      }
    );
  } catch (error) {
    const providerError =
      error instanceof Error && error.cause ? error.cause : error;
    const guidance = `\nCheck: ai doctor\nAlternatives: ai providers ${primaryRoute} --type ${modality}\nUse --fallbacks <routes> to set recovery order, or --no-fallback to pin one route.`;
    // Retain the cause so jobs.ts can include all failed attempts in JSON.
    throw new Error(
      `${errorMessage(error)}: ${errorMessage(providerError)}${guidance}`,
      { cause: error }
    );
  }
}

function announceRoute(modelRoute: string, primaryRoute: string): void {
  const action = modelRoute === primaryRoute ? "Using" : "Trying fallback";
  const freeTier =
    modelRoute.startsWith("google/") && googleFreeTier(modelRoute.slice(7));
  const billingNote = freeTier
    ? " (Google free-tier eligible; project billing/quota apply)"
    : "";
  process.stderr.write(`${action} ${modelRoute}${billingNote}\n`);
}
