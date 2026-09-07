import { readFileSync } from "node:fs";

import {
  preferences,
  mergePreferences,
  type Preferences,
} from "@patricksrail/bricks/ai/preferences";

import type { Modality } from "../lib/models.js";
export type { Preferences };
export const MODALITIES: Modality[] = [
  "text",
  "image",
  "video",
  "speech",
  "transcription",
];
export const preferenceLocation = () =>
  process.env.AI_CLI_MODEL_PREFERENCES ||
  "@patricksrail/bricks/ai/preferences.json (pinned library snapshot)";
export function modelPreferences(): Preferences {
  const path = process.env.AI_CLI_MODEL_PREFERENCES;
  if (!path) return structuredClone(preferences);
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("Cannot read AI_CLI_MODEL_PREFERENCES JSON file");
  }
  try {
    return mergePreferences(data);
  } catch (error) {
    throw new Error(
      `Invalid model preference: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
}
