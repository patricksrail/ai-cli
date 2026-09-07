import { routeCloudflareModel } from "../lib/gateway.js";
import type { Modality } from "../lib/models.js";
import {
  fetchCloudflareCatalog,
  parseProvider,
  type CatalogEntry,
} from "./catalog.js";
import { modelPreferences, preferenceLocation } from "./model-preferences.js";
import { FREE_PROVIDERS } from "./providers.js";

export interface SelectionOptions {
  best?: boolean;
  free?: boolean;
  cheapest?: boolean;
  provider?: string;
  model?: string;
}
export const isFreeOffer = (entry: CatalogEntry) =>
  entry.free === true || Boolean(entry.freeTier);

export function preferredFree(
  entries: CatalogEntry[],
  modality: Modality
): CatalogEntry | undefined {
  const eligible = entries.filter(
    (e) => e.capabilities.includes(modality) && isFreeOffer(e)
  );
  const preferences = modelPreferences().bestFree[modality] ?? [];
  return (
    preferences.map((id) => eligible.find((e) => e.id === id)).find(Boolean) ??
    eligible.sort((a, b) => a.id.localeCompare(b.id))[0]
  );
}

export async function selectModel(
  modality: Modality,
  opts: SelectionOptions
): Promise<{ id: string; reason: string }> {
  if (opts.cheapest && (opts.free || opts.best))
    throw new Error("--cheapest cannot be combined with --best or --free");
  if (opts.best && opts.free && !modelPreferences().bestFree[modality]?.length)
    throw new Error(
      `No best-free ${modality} preference saved; use --free or edit ${preferenceLocation()}`
    );
  const provider = opts.provider
    ? parseProvider(opts.provider)
    : opts.model
      ? routeCloudflareModel(
          opts.model,
          modality === "text" ? "language" : modality
        ).provider
      : undefined;
  if (opts.free && provider && !FREE_PROVIDERS.includes(provider))
    throw new Error(
      `No free-pricing metadata for ${provider}; use -m or choose a provider listed by ai providers --all`
    );
  if ((opts.best && !opts.free) || opts.cheapest) {
    const choice = opts.cheapest ? "cheapest" : "best";
    const id = modelPreferences()[choice][modality];
    if (!id)
      throw new Error(
        `No ${choice} ${modality} preference saved. Set ${choice}.${modality} in ${preferenceLocation()} or use -m.`
      );
    const route = routeCloudflareModel(
      id,
      modality === "text" ? "language" : modality
    );
    if (provider && provider !== route.provider)
      throw new Error(
        `Saved ${choice} ${modality} uses ${route.provider}; omit --provider or edit the preference`
      );
    return {
      id,
      reason: opts.cheapest
        ? "saved low-cost preference (not a live minimum-price claim)"
        : "saved best preference",
    };
  }
  const catalog = await fetchCloudflareCatalog(provider, {
    providers: opts.free
      ? modality === "image"
        ? FREE_PROVIDERS
        : FREE_PROVIDERS.filter((p) => p !== "workers-ai")
      : ["openrouter"],
  });
  for (const warning of catalog.warnings)
    process.stderr.write(
      `Warning: ${warning}; selection uses available catalogs\n`
    );
  const chosen = opts.model
    ? catalog.entries.find(
        (e) =>
          e.id === opts.model &&
          e.capabilities.includes(modality) &&
          isFreeOffer(e)
      )
    : preferredFree(catalog.entries, modality);
  if (!chosen)
    throw new Error(
      opts.model
        ? `${opts.model} is not verified as free or eligible for a free tier for ${modality}; no request was sent.`
        : `No verified free ${modality} model found.${modelPreferences().cheapest[modality] ? ` For low-cost paid ${modality}, use --cheapest explicitly.` : ""} No paid fallback was made.`
    );
  return {
    id: chosen.id,
    reason: chosen.freeTier
      ? chosen.provider === "workers-ai"
        ? "Workers Free plan verified; shared daily quota applies"
        : "Google free-tier eligible; project billing and quota apply"
      : "zero listed OpenRouter prices; rate limits apply",
  };
}
