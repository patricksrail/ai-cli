import { errorMessage } from "../lib/errors.js";
import { resolveGatewayBackend, routeCloudflareModel } from "../lib/gateway.js";
import type { Modality } from "../lib/models.js";
import { fetchCloudflareCatalog, type CatalogEntry } from "./catalog.js";
import { googleFreeTier } from "./google-pricing.js";

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

/** One request is still one provider choice. Never retry across billing hosts
 * implicitly: failed media calls can have created billable jobs already.
 * Catalog matches are suggestions, not proof of inference quota or credit.
 */
export async function generateWithGuidance<T>(
  model: string,
  generate: (model: string) => Promise<T>,
  noun: string,
  quiet?: boolean
): Promise<T> {
  if (resolveGatewayBackend() !== "cloudflare") return generate(model);
  if (!quiet && !process.stderr.isTTY) {
    const free = model.startsWith("google/") && googleFreeTier(model.slice(7));
    process.stderr.write(
      `Using ${model}${free ? " (Google free-tier eligible; project billing/quota apply)" : ""}\n`
    );
  }
  try {
    return await generate(model);
  } catch (error) {
    const modality: Modality =
      noun === "audio"
        ? "speech"
        : noun === "transcript"
          ? "transcription"
          : (noun as Modality);
    let guidance = `\nCheck: ai doctor\nAlternatives: ai providers ${model} --type ${modality}`;
    try {
      // Avoid crawling large media catalogs while reporting an inference failure.
      if (modality !== "text")
        throw new Error(
          "Use the explicit providers command for media alternatives"
        );
      const result = await findAlternatives(model, modality);
      if (result.alternatives.length)
        guidance =
          "\nCatalog alternatives (not inference-tested; prices may differ):\n" +
          result.alternatives.map((e) => `  ${e.id} — ${e.kind}`).join("\n") +
          (modality === "text"
            ? `\nTest one: ai doctor --probe --model ${result.alternatives[0]!.id}`
            : "");
    } catch {
      /* Diagnostics must never replace the original provider error. */
    }
    throw new Error(`${errorMessage(error)}${guidance}`, { cause: error });
  }
}
