import {
  runWithFallback,
  type Attempt,
} from "@patricksrail/bricks/ai/fallback";
import { resolveModel } from "@patricksrail/bricks/ai/preferences";

import { errorMessage } from "../lib/errors.js";
import { resolveGatewayBackend, routeCloudflareModel } from "../lib/gateway.js";
import type { Modality } from "../lib/models.js";
import { fetchCloudflareCatalog, type CatalogEntry } from "./catalog.js";
import { executionPolicy, type ExecutionPolicy } from "./execution-policy.js";
import { googleFreeTier } from "./google-pricing.js";
import { modelPreferences } from "./preferences.js";
import { isFreeOffer } from "./selection.js";

function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(
        next[j - 1]! + 1,
        row[j]! + 1,
        row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    row = next;
  }
  return row[b.length]!;
}
function modelIdentity(id: string, modality: Modality): string {
  const route = routeCloudflareModel(
    id,
    modality === "text" ? "language" : modality
  );
  return route.provider === "google" || route.provider === "openai"
    ? `${route.provider}/${route.modelId}`
    : route.modelId;
}
export function matchAlternatives(
  model: string,
  entries: CatalogEntry[],
  modality: Modality
) {
  const identity = modelIdentity(model, modality);
  return entries
    .filter((e) => e.id !== model && e.capabilities.includes(modality))
    .flatMap((e) => {
      try {
        const difference = distance(identity, modelIdentity(e.id, modality));
        return difference <= 3
          ? [
              {
                id: e.id,
                kind:
                  difference === 0
                    ? "same model, different host"
                    : "similar name; check model/version",
                difference,
              },
            ]
          : [];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.difference - b.difference || a.id.localeCompare(b.id))
    .slice(0, 5);
}
export async function findAlternatives(
  model: string,
  modality: Modality = "text"
) {
  const catalog = await fetchCloudflareCatalog(undefined, {
    providers:
      modality === "text" ? ["google", "openrouter", "openai"] : undefined,
    search: model.split("/").at(-1),
  });
  return {
    alternatives: matchAlternatives(model, catalog.entries, modality),
    warnings: catalog.warnings,
  };
}

/** Build the complete plan before inference. Free-only and explicit host
 * restrictions apply to every candidate, not only initial selection. */
export async function fallbackCandidates(
  model: string,
  modality: Modality,
  policy: ExecutionPolicy = executionPolicy.getStore() ?? {}
): Promise<string[]> {
  if (policy.fallback === false) return [model];
  const prefs = modelPreferences();
  const saved = policy.free
    ? (prefs.bestFree[modality] ?? [])
    : (prefs.fallbacks[model] ?? []);
  const extras = (policy.fallbacks ?? saved).map(
    (id) => resolveModel(id, { modality, preferences: prefs }).route
  );
  let candidates = [...new Set([model, ...extras])];
  if (policy.provider) {
    const invalid = candidates.filter(
      (id) =>
        routeCloudflareModel(id, modality === "text" ? "language" : modality)
          .provider !== policy.provider
    );
    if (policy.fallbacks && invalid.length)
      throw new Error(
        "Fallback routes must use the explicit --provider; omit --provider to allow other hosts"
      );
    candidates = candidates.filter((id) => !invalid.includes(id));
  }
  if (policy.free && candidates.length > 1) {
    const providers = [
      ...new Set(
        candidates
          .slice(1)
          .map(
            (id) =>
              routeCloudflareModel(
                id,
                modality === "text" ? "language" : modality
              ).provider
          )
      ),
    ];
    const catalogs = await Promise.allSettled(
      providers.map((provider) => fetchCloudflareCatalog(provider))
    );
    const entries = catalogs.flatMap((result) =>
      result.status === "fulfilled" ? result.value.entries : []
    );
    for (const result of catalogs)
      if (result.status === "rejected")
        process.stderr.write(
          `Warning: free fallback catalog unavailable; omitting unverified routes: ${errorMessage(result.reason)}\n`
        );
    const free = new Set(
      entries
        .filter((e) => e.capabilities.includes(modality) && isFreeOffer(e))
        .map((e) => e.id)
    );
    if (policy.fallbacks && candidates.slice(1).some((id) => !free.has(id)))
      throw new Error(
        "--free fallback is not listed as free; choose a verified free route"
      );
    candidates = [model, ...candidates.slice(1).filter((id) => free.has(id))];
  }
  return candidates;
}

export async function generateWithGuidance<T>(
  model: string,
  generate: (model: string) => Promise<T>,
  noun: string,
  quiet?: boolean
): Promise<{ value: T; model: string; attempts: Attempt[] }> {
  if (resolveGatewayBackend() !== "cloudflare")
    return {
      value: await generate(model),
      model,
      attempts: [{ model, status: "success" }],
    };
  const modality: Modality =
    noun === "audio"
      ? "speech"
      : noun === "transcript"
        ? "transcription"
        : (noun as Modality);
  const candidates = await fallbackCandidates(model, modality);
  try {
    return await runWithFallback(
      candidates,
      async (id) => {
        if (!quiet) {
          const free = id.startsWith("google/") && googleFreeTier(id.slice(7));
          process.stderr.write(
            `${id === model ? "Using" : "Trying fallback"} ${id}${free ? " (Google free-tier eligible; project billing/quota apply)" : ""}\n`
          );
        }
        return generate(id);
      },
      {
        modality,
        onAttempt: (attempt) => {
          if (!quiet && attempt.status === "failed")
            process.stderr.write(
              `Failed ${attempt.model}: ${attempt.failure?.kind}${attempt.failure?.statusCode ? ` (HTTP ${attempt.failure.statusCode})` : ""}\n`
            );
        },
      }
    );
  } catch (error) {
    const cause = error instanceof Error && error.cause ? error.cause : error;
    const guidance = `\nCheck: ai doctor\nAlternatives: ai providers ${model} --type ${modality}\nUse --fallbacks <routes> to set recovery order, or --no-fallback to pin one route.`;
    // Preserve the provider's actionable error and the structured attempt chain.
    throw new Error(
      `${errorMessage(error)}: ${errorMessage(cause)}${guidance}`,
      { cause: error }
    );
  }
}
