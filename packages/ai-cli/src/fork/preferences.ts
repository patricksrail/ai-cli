import { readFileSync } from "node:fs";

import type { Modality } from "../lib/models.js";
import bundled from "./model-preferences.json";

export interface Preferences {
  defaults: Record<Modality, string>;
  best: Partial<Record<Modality, string>>;
  cheapest: Partial<Record<Modality, string>>;
  bestFree: Partial<Record<Modality, string[]>>;
}
export const MODALITIES: Modality[] = [
  "text",
  "image",
  "video",
  "speech",
  "transcription",
];
export const preferenceLocation = () =>
  process.env.AI_CLI_MODEL_PREFERENCES ||
  "packages/ai-cli/src/fork/model-preferences.json (bundled; rebuild after editing)";

export function modelPreferences(): Preferences {
  const result: Preferences = structuredClone(bundled);
  const path = process.env.AI_CLI_MODEL_PREFERENCES;
  if (!path) return result;
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("Cannot read AI_CLI_MODEL_PREFERENCES JSON file");
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("Model preferences must be a JSON object");
  for (const section of ["defaults", "best", "bestFree", "cheapest"] as const) {
    const values = (data as Record<string, unknown>)[section];
    if (values === undefined) continue;
    if (!values || typeof values !== "object" || Array.isArray(values))
      throw new Error(`Invalid preferences section: ${section}`);
    for (const [key, value] of Object.entries(values)) {
      if (!MODALITIES.includes(key as Modality))
        throw new Error(`Unknown preference modality: ${key}`);
      const ids = section === "bestFree" ? value : [value];
      if (
        !Array.isArray(ids) ||
        ids.length === 0 ||
        ids.some(
          (id) =>
            typeof id !== "string" || !/^[\x21-\x7e]+\/[\x21-\x7e]+$/.test(id)
        )
      )
        throw new Error(`Invalid model preference: ${section}.${key}`);
      Object.assign(result[section], { [key]: value });
    }
  }
  return result;
}
