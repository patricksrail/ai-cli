/** Catalog suggestions only: compare model identities and nearby names across
 * hosts. These functions never generate or retry; see generation.ts for that. */
import { routeCloudflareModel } from "../lib/gateway.js";
import type { Modality } from "../lib/models.js";
import { fetchCloudflareCatalog, type CatalogEntry } from "./catalog.js";

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
