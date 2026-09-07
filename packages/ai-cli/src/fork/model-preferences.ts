/**
 * Model choices owned by this CLI: load the adjacent JSON, validate a runtime
 * override, and expand preferred aliases into explicit provider/model routes.
 *
 * Edit model-preferences.json to change Patrick's choices. This module describes
 * how to interpret those choices; providers.ts owns supported provider names.
 * Nothing here fetches a catalog, checks account credit, or sends inference.
 */
import { readFileSync } from "node:fs";

import type { Modality } from "../lib/models.js";
import bundledPreferences from "./model-preferences.json";
import { PROVIDERS, type ProviderId } from "./providers.js";

// Preference data and its public, offline listing -----------------------------

export type Provider = ProviderId;
export const MODALITIES: Modality[] = [
  "text",
  "image",
  "video",
  "speech",
  "transcription",
];

export interface PreferredModel {
  alias: string;
  label: string;
  route: string;
  modalities: Modality[];
  /** Native model IDs for deliberate overrides of the same model's host. */
  providers?: Partial<Record<Provider, string>>;
}

export interface Preferences {
  dateUpdated: string;
  defaults: Record<Modality, string>;
  best: Partial<Record<Modality, string>>;
  cheapest: Partial<Record<Modality, string>>;
  bestFree: Partial<Record<Modality, string[]>>;
  preferred: PreferredModel[];
  fallbacks: Record<string, string[]>;
}

export function preferenceLocation(): string {
  return (
    process.env.AI_CLI_MODEL_PREFERENCES ||
    "packages/ai-cli/src/fork/model-preferences.json (bundled; rebuild after editing)"
  );
}

/** Each caller receives its own copy, so an override cannot mutate defaults. */
export function modelPreferences(): Preferences {
  const defaults = structuredClone(bundledPreferences) as Preferences;
  const overridePath = process.env.AI_CLI_MODEL_PREFERENCES;
  if (!overridePath) return defaults;

  let override: unknown;
  try {
    override = JSON.parse(readFileSync(overridePath, "utf8"));
  } catch {
    throw new Error("Cannot read AI_CLI_MODEL_PREFERENCES JSON file");
  }
  try {
    return mergePreferences(override, defaults);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid model preference: ${detail}`, { cause: error });
  }
}

/** Editorial choices only. ckId lets CK consume this feed without guessing its
 * provider:model spelling; it does not claim CK has adopted our gateway route. */
export function preferredModels(
  options: { modality?: Modality; preferences?: Preferences } = {}
) {
  const preferences = options.preferences ?? modelPreferences();
  return preferences.preferred
    .filter(
      (entry) =>
        !options.modality || entry.modalities.includes(options.modality)
    )
    .map((entry) => ({ ...entry, ...parseRoute(entry.route) }));
}

// Alias resolution ------------------------------------------------------------

/** Parse an explicit billing host; creator namespaces stay in modelId.
 * Example: openrouter/openai/gpt-5.6-sol keeps openai/gpt-5.6-sol intact. */
export function parseRoute(route: string) {
  const separator = route.indexOf("/");
  const provider = route.slice(0, separator) as Provider;
  const modelId = route.slice(separator + 1);
  if (
    separator < 1 ||
    !PROVIDERS.includes(provider) ||
    !modelId ||
    !/^[\x21-\x7e]+$/.test(route)
  ) {
    throw new Error(
      `Use a full provider/model route, or a saved alias: ${route}`
    );
  }
  return {
    route,
    provider,
    modelId,
    gateway: "cloudflare" as const,
    ckId: `${provider}:${modelId}`,
  };
}

/** An alias picks a model AND its default host. --provider selects another saved
 * native ID for that alias. Non-alias inputs with --provider are native IDs,
 * matching CLI syntax; do not prepend a second provider prefix yourself. */
export function resolveModel(
  input: string,
  options: {
    provider?: Provider;
    modality?: Modality;
    preferences?: Preferences;
  } = {}
) {
  const preferences = options.preferences ?? modelPreferences();
  const preferred = preferences.preferred.find(
    (entry) => entry.alias === input
  );
  if (
    preferred &&
    options.modality &&
    !preferred.modalities.includes(options.modality)
  ) {
    throw new Error(`${input} does not support ${options.modality}`);
  }
  if (!options.provider) return parseRoute(preferred?.route ?? input);
  if (!preferred) return parseRoute(`${options.provider}/${input}`);

  const defaultRoute = parseRoute(preferred.route);
  const nativeModelId =
    preferred.providers?.[options.provider] ??
    (defaultRoute.provider === options.provider
      ? defaultRoute.modelId
      : undefined);
  if (!nativeModelId)
    throw new Error(`No ${options.provider} route saved for ${input}`);
  return parseRoute(`${options.provider}/${nativeModelId}`);
}

// Runtime override validation -------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Route maps merge by key; preferred replaces the whole editorial list. This
 * lets a small override change one default without copying every preference. */
export function mergePreferences(
  override: unknown,
  base: Preferences
): Preferences {
  if (!isRecord(override))
    throw new Error("Model preferences must be a JSON object");
  const preferences = structuredClone(base);
  const routeSections = [
    "defaults",
    "best",
    "cheapest",
    "bestFree",
    "fallbacks",
  ] as const;

  for (const sectionName of routeSections) {
    const section = override[sectionName];
    if (section === undefined) continue;
    if (!isRecord(section))
      throw new Error(`Invalid preferences section: ${sectionName}`);

    for (const [name, value] of Object.entries(section)) {
      if (sectionName === "fallbacks") parseRoute(name);
      else if (!MODALITIES.includes(name as Modality))
        throw new Error(`Unknown preference modality: ${name}`);

      const isRouteList =
        sectionName === "fallbacks" || sectionName === "bestFree";
      const routes = isRouteList ? value : [value];
      // An empty fallback list deliberately pins that primary route. Other
      // choices must contain at least one usable model.
      if (
        !Array.isArray(routes) ||
        (sectionName !== "fallbacks" && routes.length === 0)
      ) {
        throw new Error(`Invalid model preference: ${sectionName}.${name}`);
      }
      for (const route of routes) {
        if (typeof route !== "string")
          throw new Error(`Invalid model preference: ${sectionName}.${name}`);
        parseRoute(route);
      }
      Object.assign(preferences[sectionName], {
        [name]: structuredClone(value),
      });
    }
  }

  if (override.preferred !== undefined)
    preferences.preferred = validatePreferredList(override.preferred);
  return preferences;
}

function validatePreferredList(value: unknown): PreferredModel[] {
  if (!Array.isArray(value)) throw new Error("preferred must be an array");
  const aliases = new Set<string>();
  return value.map((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.alias !== "string" ||
      !/^[a-zA-Z0-9._-]+$/.test(entry.alias)
    ) {
      throw new Error("Invalid preferred model alias");
    }
    if (aliases.has(entry.alias))
      throw new Error(`Duplicate preferred model alias: ${entry.alias}`);
    aliases.add(entry.alias);
    if (typeof entry.label !== "string" || !entry.label.trim())
      throw new Error(`Missing label for ${entry.alias}`);
    if (
      !Array.isArray(entry.modalities) ||
      !entry.modalities.length ||
      entry.modalities.some((mode) => !MODALITIES.includes(mode))
    ) {
      throw new Error(`Invalid modalities for ${entry.alias}`);
    }
    if (typeof entry.route !== "string")
      throw new Error(`Missing route for ${entry.alias}`);
    parseRoute(entry.route);

    if (entry.providers !== undefined) {
      if (!isRecord(entry.providers))
        throw new Error(`Invalid provider overrides for ${entry.alias}`);
      for (const [provider, nativeModelId] of Object.entries(entry.providers)) {
        if (typeof nativeModelId !== "string")
          throw new Error(`Invalid ${provider} model ID for ${entry.alias}`);
        parseRoute(`${provider}/${nativeModelId}`);
      }
    }
    return structuredClone(entry) as unknown as PreferredModel;
  });
}
