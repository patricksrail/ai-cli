/** The editable JSON contract is local to ai-cli and needs no catalog access. */
import { expect, test } from "bun:test";

import {
  mergePreferences,
  preferredModels,
  resolveModel,
  type Preferences,
} from "./model-preferences.js";
import bundledPreferences from "./model-preferences.json";

const preferences = bundledPreferences as Preferences;

test("preferred aliases preserve creator namespaces and explicit billing hosts", () => {
  expect(resolveModel("gpt-5.6-sol", { preferences })).toMatchObject({
    provider: "openrouter",
    modelId: "openai/gpt-5.6-sol",
    ckId: "openrouter:openai/gpt-5.6-sol",
  });
  expect(
    resolveModel("gpt-5.6-sol", { provider: "openai", preferences }).route
  ).toBe("openai/gpt-5.6-sol");
  expect(
    preferredModels({ preferences, modality: "text" }).some(
      (entry) => entry.alias === "gpt-5.6-sol"
    )
  ).toBe(true);
  expect(() => resolveModel("sana", { modality: "text", preferences })).toThrow(
    "does not support text"
  );
});

test("partial overrides keep other defaults and can deliberately remove recovery", () => {
  const updated = mergePreferences(
    {
      defaults: { text: "openrouter/openai/gpt-5.6-sol" },
      fallbacks: { "google/gemini-3.8-flash": [] },
    },
    preferences
  );
  expect(updated.defaults.image).toBe(preferences.defaults.image);
  expect(updated.defaults.text).not.toBe(preferences.defaults.text);
  expect(updated.fallbacks["google/gemini-3.8-flash"]).toEqual([]);
  expect(
    preferences.fallbacks["google/gemini-3.8-flash"].length
  ).toBeGreaterThan(0);
});

test("preferred overrides reject duplicate aliases and malformed native model IDs", () => {
  const preferred = preferences.preferred[0];
  expect(() =>
    mergePreferences({ preferred: [preferred, preferred] }, preferences)
  ).toThrow("Duplicate");
  expect(() =>
    mergePreferences(
      { preferred: [{ ...preferred, providers: { google: 123 } }] },
      preferences
    )
  ).toThrow("model ID");
});
