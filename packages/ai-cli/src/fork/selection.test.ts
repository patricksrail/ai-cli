import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveModels } from "../lib/models.js";
import { matchAlternatives, generateWithGuidance } from "./alternatives.js";
import { normalizeOpenRouter, type CatalogEntry } from "./catalog.js";
import { doctorChecks } from "./diagnostics.js";
import { googleFreeTier } from "./google-pricing.js";
import { modelPreferences } from "./preferences.js";
import { preferredFree, selectModel } from "./selection.js";

const originalFetch = globalThis.fetch;
const keys = [
  "AI_CLI_GATEWAY",
  "AI_CLI_MODEL_PREFERENCES",
  "AI_CLI_TEXT_MODEL",
  "AI_CLI_PROVIDERS",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_AI_GATEWAY_TOKEN",
];
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  process.env.AI_CLI_GATEWAY = "cloudflare";
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [k, v] of Object.entries(saved))
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
});
const router = (id: string, input: string, output: string) =>
  normalizeOpenRouter({
    id,
    architecture: { output_modalities: ["text"] },
    pricing: { prompt: input, completion: output },
  });
const google = (id = "gemini-3.8-flash"): CatalogEntry => ({
  id: `google/${id}`,
  provider: "google",
  creator: "google",
  source: "test",
  capabilities: ["text"],
  freeTier: googleFreeTier(id),
});

test("default, best and best-free are separate stored preferences", async () => {
  expect(resolveModels("text")).toEqual(["google/gemini-3.8-flash"]);
  expect(modelPreferences().best.video).toBe("fal/minimax/h3-max");
  expect((await selectModel("video", { best: true })).id).toBe(
    "fal/minimax/h3-max"
  );
  expect(modelPreferences().bestFree.text?.[0]).toBe("google/gemini-3.8-flash");
  process.env.AI_CLI_TEXT_MODEL = "openrouter/openai/gpt-5.6-luna";
  expect(resolveModels("text")[0]).toBe("openrouter/openai/gpt-5.6-luna");
});

test("Google source metadata is exact and distinguishes eligibility from zero billing", () => {
  expect(google().freeTier?.condition).toContain("paid projects");
  expect(google().free).toBeUndefined();
  expect(googleFreeTier("gemini-3.8-flash")).toBeDefined();
  expect(googleFreeTier("gemini-3.1-pro-preview")).toBeUndefined();
  expect(googleFreeTier("gemini-3.8-flash-image")).toBeUndefined();
});

test("best free prefers Google, then only actually free available OpenRouter entries", () => {
  const free = router("openrouter/free", "0", "0");
  expect(preferredFree([free, google()], "text")?.id).toBe(
    "google/gemini-3.8-flash"
  );
  expect(preferredFree([free], "text")?.id).toBe("openrouter/openrouter/free");
  expect(
    preferredFree([router("paid/model", "1", "1")], "text")
  ).toBeUndefined();
});

test("cheapest uses the editable fully qualified low-cost preference", async () => {
  expect((await selectModel("image", { cheapest: true })).id).toBe(
    "fal/fal-ai/sana"
  );
  expect((await selectModel("text", { cheapest: true })).id).toBe(
    "openrouter/openai/gpt-5.6-luna"
  );
});

test("preferences override is validated and does not alter bundled defaults", () => {
  const dir = mkdtempSync(join(tmpdir(), "ai-preferences-"));
  try {
    const path = join(dir, "models.json");
    writeFileSync(
      path,
      JSON.stringify({
        defaults: { text: "google/custom" },
        bestFree: { text: ["google/custom"] },
      })
    );
    process.env.AI_CLI_MODEL_PREFERENCES = path;
    expect(resolveModels("text")[0]).toBe("google/custom");
    writeFileSync(path, JSON.stringify({ best: { text: "bad model" } }));
    expect(() => modelPreferences()).toThrow("Invalid model preference");
    delete process.env.AI_CLI_MODEL_PREFERENCES;
    expect(resolveModels("text")[0]).toBe("google/gemini-3.8-flash");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("alternatives identify exact cross-provider IDs and likely misspellings", () => {
  const entries = [
    google("gemini-2.5-flash-lite"),
    router("google/gemini-2.5-flash-lite", "1", "1"),
    router("openai/unrelated", "1", "1"),
  ];
  expect(
    matchAlternatives("google/gemini-2.5-flash-lite", entries, "text")[0]
  ).toMatchObject({
    id: "openrouter/google/gemini-2.5-flash-lite",
    kind: "same model, different host",
  });
  expect(
    matchAlternatives("google/gemni-2.5-flash-lite", entries, "text")
  ).toHaveLength(2);
});

test("failed generation preserves error and never retries on another host", async () => {
  const generate = mock(async () => {
    throw new Error("quota exceeded");
  });
  await expect(
    generateWithGuidance("google/gemini-3.8-flash", generate, "text", true)
  ).rejects.toThrow("quota exceeded");
  expect(generate).toHaveBeenCalledTimes(1);
});

test("doctor without probe checks catalogs but never sends inference or leaks auth", async () => {
  Object.assign(process.env, {
    CLOUDFLARE_ACCOUNT_ID: "account",
    CLOUDFLARE_AI_GATEWAY_TOKEN: "SECRET-RUN",
    AI_CLI_PROVIDERS: "google",
  });
  const calls: string[] = [];
  globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
    calls.push(url);
    expect(init?.method ?? "GET").toBe("GET");
    return new Response(
      JSON.stringify({
        models: [
          {
            name: "models/gemini-3.8-flash",
            supportedGenerationMethods: ["generateContent"],
          },
        ],
      })
    );
  }) as unknown as typeof fetch;
  const checks = await doctorChecks({});
  expect(checks.some((c) => c.name === "google" && c.status === "ok")).toBe(
    true
  );
  expect(
    checks.some((c) => c.name === "inference" && c.status === "warning")
  ).toBe(true);
  expect(JSON.stringify(checks)).not.toContain("SECRET-RUN");
  expect(calls).toHaveLength(1);
});

test("doctor reports missing auth and selection refuses unset preferences", async () => {
  const checks = await doctorChecks({});
  expect(
    checks.some((c) => c.name === "credentials" && c.status === "error")
  ).toBe(true);
  await expect(selectModel("video", { cheapest: true })).rejects.toThrow(
    "No cheapest video preference saved"
  );
  await expect(
    selectModel("text", { cheapest: true, free: true })
  ).rejects.toThrow("cannot be combined");
});

// Free status belongs to a billing host, not just the underlying model family.
test("explicit free model checks the full provider route", async () => {
  Object.assign(process.env, {
    CLOUDFLARE_ACCOUNT_ID: "account",
    CLOUDFLARE_AI_GATEWAY_TOKEN: "run-token",
    AI_CLI_PROVIDERS: "google,openrouter",
  });
  globalThis.fetch = mock(
    async (url: string) =>
      new Response(
        JSON.stringify(
          String(url).includes("google-ai-studio")
            ? {
                models: [
                  {
                    name: "models/gemini-3.8-flash",
                    supportedGenerationMethods: ["generateContent"],
                  },
                ],
              }
            : {
                data: [
                  {
                    id: "google/gemini-3.8-flash",
                    architecture: { output_modalities: ["text"] },
                    pricing: { prompt: "0.000001", completion: "0.000002" },
                  },
                ],
              }
        )
      )
  ) as unknown as typeof fetch;
  expect(
    (
      await selectModel("text", {
        free: true,
        model: "google/gemini-3.8-flash",
      })
    ).id
  ).toBe("google/gemini-3.8-flash");
  await expect(
    selectModel("text", {
      free: true,
      model: "openrouter/google/gemini-3.8-flash",
    })
  ).rejects.toThrow("no request was sent");
});

// Neither paid image models nor zero text-token prices establish free images.
test("free image selection suggests the cheap preset without generating", async () => {
  Object.assign(process.env, {
    CLOUDFLARE_ACCOUNT_ID: "account",
    CLOUDFLARE_AI_GATEWAY_TOKEN: "run-token",
    AI_CLI_PROVIDERS: "openrouter",
  });
  globalThis.fetch = mock(
    async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: "vendor/image",
              architecture: { output_modalities: ["image"] },
              pricing: { prompt: "0", completion: "0" },
            },
          ],
        })
      )
  ) as unknown as typeof fetch;
  await expect(selectModel("image", { free: true })).rejects.toThrow(
    "For low-cost paid image, use --cheapest explicitly"
  );
});
