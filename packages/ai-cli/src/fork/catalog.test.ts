import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import { registerModelsCommand } from "../commands/models.js";
import { Command } from "../lib/command.js";
import {
  expandModelId,
  fetchGatewayModels,
  resolveModels,
} from "../lib/models.js";
import {
  asGatewayModels,
  cloudflareImageModels,
  fetchCloudflareCatalog,
  isFreeOpenRouter,
  normalizeOpenRouter,
} from "./catalog.js";
import {
  addRoutingOptions,
  qualifyProviderModels,
  withGateway,
} from "./options.js";

const originalFetch = globalThis.fetch;
const envKeys = [
  "AI_CLI_GATEWAY",
  "AI_CLI_PROVIDERS",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_AI_GATEWAY_TOKEN",
  "OPENROUTER_API_KEY",
  "AI_CLI_TEXT_MODEL",
];
let saved: Record<string, string | undefined>;
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
const freeModel = {
  id: "vendor/chat:free",
  name: "Free Chat",
  architecture: { output_modalities: ["text"] },
  pricing: { prompt: "0", completion: "0" },
};

beforeEach(() => {
  saved = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  Object.assign(process.env, {
    AI_CLI_GATEWAY: "cloudflare",
    CLOUDFLARE_ACCOUNT_ID: "account",
    CLOUDFLARE_API_TOKEN: "management-token",
    CLOUDFLARE_AI_GATEWAY_TOKEN: "run-token",
    OPENROUTER_API_KEY: "must-not-leak",
  });
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function catalogFetch(providers = ["openrouter"]) {
  const calls: string[] = [];
  globalThis.fetch = mock(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      expect(url).not.toContain("vercel");
      expect(JSON.stringify(init)).not.toContain("must-not-leak");
      const headers = new Headers(init?.headers);
      expect(init?.redirect).toBe("error");
      if (url.startsWith("https://api.cloudflare.com/")) {
        expect(headers.get("Authorization")).toBe("Bearer management-token");
        return json({
          result: providers.map((provider_slug) => ({
            provider_slug,
            alias: "default",
            secret_preview: "NEVER-PRINT",
          })),
        });
      }
      expect(url.startsWith("https://gateway.ai.cloudflare.com/")).toBe(true);
      expect(headers.get("cf-aig-authorization")).toBe("Bearer run-token");
      expect(headers.has("Authorization")).toBe(false);
      if (url.includes("openrouter"))
        return json({
          data: [
            freeModel,
            {
              ...freeModel,
              id: "vendor/paid",
              pricing: { prompt: "1", completion: "1" },
            },
          ],
        });
      if (url.includes("google-ai-studio"))
        return json({
          models: [
            {
              name: "models/gemini-test-image",
              supportedGenerationMethods: ["generateContent"],
            },
          ],
        });
      if (url.includes("/fal"))
        return json({
          models: [
            {
              endpoint_id: "fal-ai/speech",
              metadata: { category: "text-to-speech" },
            },
          ],
          has_more: false,
        });
      if (url.includes("/replicate"))
        return json({
          results: [
            {
              owner: "owner",
              name: "movie",
              default_example: { output: "https://cdn.example/movie.mp4" },
            },
          ],
          next: null,
        });
      return json({ data: [{ id: "whisper-1" }] });
    }
  ) as unknown as typeof fetch;
  return calls;
}

describe("Cloudflare discovery", () => {
  test("aggregates configured catalogs with full route IDs and only gateway credentials", async () => {
    const calls = catalogFetch([
      "openrouter",
      "google-ai-studio",
      "openai",
      "fal",
      "replicate",
    ]);
    const result = await fetchCloudflareCatalog();
    expect(result.providers).toEqual([
      "openrouter",
      "google",
      "openai",
      "fal",
      "replicate",
    ]);
    expect(result.entries.map((e) => e.id)).toContain(
      "openrouter/vendor/chat:free"
    );
    expect(result.entries.map((e) => e.id)).toContain("fal/fal-ai/speech");
    expect(result.entries.map((e) => e.id)).toContain("replicate/owner/movie");
    expect(JSON.stringify(result)).not.toContain("NEVER-PRINT");
    expect(calls).toHaveLength(6);
    expect(
      asGatewayModels(result.entries).languageImageModelIds.has(
        "google/gemini-test-image"
      )
    ).toBe(true);
  });
  test("main discovery seam selects Cloudflare by default", async () => {
    delete process.env.AI_CLI_GATEWAY;
    catalogFetch();
    expect((await fetchGatewayModels()).text[0]?.id).toBe(
      "openrouter/vendor/chat:free"
    );
  });
  test("provider selection avoids every unrelated catalog", async () => {
    const calls = catalogFetch(["openrouter", "google-ai-studio"]);
    await fetchCloudflareCatalog("openrouter");
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("/models/user?output_modalities=all");
    await expect(fetchCloudflareCatalog("fal")).rejects.toThrow(
      "No default Cloudflare Provider Key"
    );
  });
  test("Run-only token can use explicit provider; failed inventory is not silently assumed", async () => {
    globalThis.fetch = mock(async (url: string) =>
      url.includes("api.cloudflare.com")
        ? json({}, 403)
        : json({ data: [freeModel] })
    ) as unknown as typeof fetch;
    await expect(fetchCloudflareCatalog()).rejects.toThrow("AI Gateway Read");
    expect((await fetchCloudflareCatalog("openrouter")).entries).toHaveLength(
      1
    );
  });
  test("explicit inventory needs no management token", async () => {
    process.env.AI_CLI_PROVIDERS = "openrouter";
    delete process.env.CLOUDFLARE_API_TOKEN;
    const calls = catalogFetch();
    await fetchCloudflareCatalog();
    expect(calls).toHaveLength(1);
  });
  test("follows Google and Fal cursors and safely rewrites Replicate pagination", async () => {
    process.env.AI_CLI_PROVIDERS = "google,fal,replicate";
    const requests: string[] = [];
    globalThis.fetch = mock(async (url: string, init: RequestInit) => {
      const falTarget = new Headers(init.headers).get("x-fal-target-url");
      const target = falTarget ?? url;
      requests.push(target);
      if (url.includes("google"))
        return json({
          models: [],
          ...(!url.includes("pageToken")
            ? { nextPageToken: "google page" }
            : {}),
        });
      if (falTarget)
        return json({
          models: [],
          next_cursor: falTarget.includes("cursor") ? null : "fal page",
        });
      return json({
        results: [],
        next: url.includes("cursor")
          ? null
          : "https://api.replicate.com/v1/models?cursor=next",
      });
    }) as unknown as typeof fetch;
    await fetchCloudflareCatalog(undefined, { all: true });
    expect(requests).toHaveLength(6);
    expect(requests.some((u) => u.includes("pageToken=google%20page"))).toBe(
      true
    );
    expect(requests.some((u) => u.includes("cursor=fal%20page"))).toBe(true);
    expect(
      requests
        .filter((u) => u.includes("replicate"))
        .every((u) => u.startsWith("https://gateway.ai.cloudflare.com/"))
    ).toBe(true);
  });
  test("partial failure preserves healthy results; total failure rejects", async () => {
    process.env.AI_CLI_PROVIDERS = "openrouter,google";
    globalThis.fetch = mock(async (url: string) =>
      url.includes("openrouter") ? json({ data: [freeModel] }) : json({}, 503)
    ) as unknown as typeof fetch;
    const result = await fetchCloudflareCatalog();
    expect(result.entries).toHaveLength(1);
    expect(result.warnings[0]).toContain("google");
    await expect(fetchCloudflareCatalog("google")).rejects.toThrow("HTTP 503");
  });
  test("rejects foreign pagination instead of forwarding auth", async () => {
    process.env.AI_CLI_PROVIDERS = "replicate";
    const fetchMock = mock(async () =>
      json({ results: [], next: "https://evil.example/models" })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(
      fetchCloudflareCatalog("replicate", { all: true })
    ).rejects.toThrow("unexpected catalog pagination URL");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("free model pricing", () => {
  test("excludes unknown, paid, dynamic and per-request charges", () => {
    expect(
      isFreeOpenRouter({ prompt: "0", completion: "0", request: "0" })
    ).toBe(true);
    for (const pricing of [
      undefined,
      {},
      { prompt: "", completion: "0" },
      { prompt: "-1", completion: "-1" },
      { prompt: "0", completion: "0", request: "0.01" },
      {
        prompt: "0",
        completion: "0",
        overrides: [{ min_prompt_tokens: 100, completion: "1" }],
      },
    ])
      expect(isFreeOpenRouter(pricing)).toBe(false);
  });
  test("does not call video token placeholders or unsupported audio free", () => {
    expect(normalizeOpenRouter(freeModel).free).toBe(true);
    expect(
      normalizeOpenRouter({ ...freeModel, architecture: undefined }).free
    ).toBe(false);
    for (const output of ["video", "image", "audio"])
      expect(
        normalizeOpenRouter({
          ...freeModel,
          architecture: { output_modalities: [output] },
        }).free
      ).toBe(false);
    expect(
      normalizeOpenRouter({ ...freeModel, id: "vendor/model:batch" }).free
    ).toBe(false);
  });
});

describe("routing and browse flow", () => {
  test("all native namespaces survive provider qualification", () => {
    expect(
      qualifyProviderModels("openrouter", "openai/gpt-5,google/gemini")
    ).toBe("openrouter/openai/gpt-5,openrouter/google/gemini");
    expect(qualifyProviderModels("openrouter", "openrouter/free")).toBe(
      "openrouter/openrouter/free"
    );
    expect(qualifyProviderModels("fal", "fal-ai/flux/schnell")).toBe(
      "fal/fal-ai/flux/schnell"
    );
    expect(() => qualifyProviderModels("fal")).toThrow("requires --model");
  });
  test("flags are applied during action and gateway is restored", async () => {
    const command = new Command()
      .name("text")
      .argument("[prompt]", "prompt")
      .option("-m, --model <id>", "model");
    let observed: unknown;
    addRoutingOptions(command).action(async (_, opts) => {
      observed = opts;
      expect(process.env.AI_CLI_GATEWAY).toBe("cloudflare");
    });
    process.env.AI_CLI_GATEWAY = "vercel";
    await command.parseAsync([
      "bun",
      "ai",
      "hello",
      "--gateway",
      "cloudflare",
      "--provider",
      "openrouter",
      "-m",
      "openai/gpt-5",
    ]);
    expect(observed).toMatchObject({ model: "openrouter/openai/gpt-5" });
    expect(process.env.AI_CLI_GATEWAY).toBe("vercel");
    await withGateway("vercel", async () =>
      expect(resolveModels("text")).toEqual(["openai/gpt-5.5"])
    );
  });
  test("ambiguous short aliases require a full route", () => {
    expect(() =>
      expandModelId("gemini", [
        { id: "google/gemini" },
        { id: "openrouter/google/gemini" },
      ])
    ).toThrow("Ambiguous");
    expect(expandModelId("gemini", [{ id: "openrouter/google/gemini" }])).toBe(
      "openrouter/google/gemini"
    );
  });
  test("full image dispatch works without a discovery fetch", () => {
    const catalog = cloudflareImageModels([
      "google/gemini-image",
      "openrouter/google/gemini-image",
      "fal/fal-ai/flux/schnell",
    ]);
    expect([...catalog.languageImageModelIds]).toEqual(["google/gemini-image"]);
  });
  test("models command filters full IDs into JSON without stray stdout", async () => {
    catalogFetch();
    const stdout = process.stdout.write;
    const stderr = process.stderr.write;
    let output = "";
    process.stdout.write = ((chunk: string) => {
      output += chunk;
      return true;
    }) as typeof stdout;
    process.stderr.write = (() => true) as typeof stderr;
    try {
      const command = new Command().name("ai");
      registerModelsCommand(command);
      await command.parseAsync([
        "bun",
        "ai",
        "models",
        "--free",
        "--search",
        "chat",
        "--creator",
        "vendor",
        "--json",
      ]);
      const data = JSON.parse(output);
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe("openrouter/vendor/chat:free");
      expect(data[0].provider).toBe("openrouter");
    } finally {
      process.stdout.write = stdout;
      process.stderr.write = stderr;
    }
  });
});

async function runModels(...args: string[]) {
  const writeOut = process.stdout.write;
  const writeErr = process.stderr.write;
  let output = "";
  let errors = "";
  process.stdout.write = ((chunk: string) => {
    output += chunk;
    return true;
  }) as typeof writeOut;
  process.stderr.write = ((chunk: string) => {
    errors += chunk;
    return true;
  }) as typeof writeErr;
  try {
    const command = new Command().name("ai");
    registerModelsCommand(command);
    await command.parseAsync(["bun", "ai", "models", ...args]);
    return { output, errors };
  } finally {
    process.stdout.write = writeOut;
    process.stderr.write = writeErr;
  }
}

describe("catalog browsing limits", () => {
  test("bare models lists inventory and defaults without crawling catalogs", async () => {
    const calls = catalogFetch();
    const { output } = await runModels();
    expect(calls).toHaveLength(1);
    expect(output).toContain("configured");
    expect(output).toContain("google/gemini-3.8-flash");
    expect(output).toContain("--free");
    expect(output).not.toContain("vendor/chat");
  });
  test("filtered output is bounded, all and JSON show all matches, explicit JSON limit is honored", async () => {
    process.env.AI_CLI_PROVIDERS = "openrouter";
    globalThis.fetch = mock(async () =>
      json({
        data: Array.from({ length: 25 }, (_, n) => ({
          ...freeModel,
          id: `vendor/model-${String(n).padStart(2, "0")}`,
        })),
      })
    ) as unknown as typeof fetch;
    const normal = await runModels(
      "--provider",
      "openrouter",
      "--type",
      "text"
    );
    expect(normal.output).toContain("Showing 20 of 25");
    expect(normal.output).not.toContain("model-24");
    expect(
      (await runModels("--provider", "openrouter", "--all")).output
    ).toContain("Showing 25 of 25");
    expect(JSON.parse((await runModels("--json")).output)).toHaveLength(25);
    expect(
      JSON.parse((await runModels("--json", "--limit", "2")).output)
    ).toHaveLength(2);
    expect((await runModels("--type", "video")).output).toContain(
      "Showing 0 of 0"
    );
  });
  test("bad filters and combinations fail before any catalog request", async () => {
    const calls = catalogFetch();
    for (const args of [
      ["--limit", "0"],
      ["--limit", "1.5"],
      ["--all", "--limit", "2"],
      ["--free", "--provider", "fal"],
      ["--gateway", "invalid"],
      ["--gateway", "vercel", "--free"],
    ]) {
      await expect(runModels(...args)).rejects.toThrow();
    }
    expect(calls).toHaveLength(0);
  });
  test("Replicate first-page browsing explicitly reports partial coverage", async () => {
    process.env.AI_CLI_PROVIDERS = "replicate";
    const request = mock(async () =>
      json({
        results: [],
        next: "https://api.replicate.com/v1/models?cursor=page2",
      })
    );
    globalThis.fetch = request as unknown as typeof fetch;
    const result = await runModels("--provider", "replicate", "--json");
    expect(result.errors).toContain("first catalog page only");
    expect(JSON.parse(result.output)).toEqual([]);
    expect(request).toHaveBeenCalledTimes(1);
  });
  test("OpenRouter pagination retains account filtering and all modalities", async () => {
    process.env.AI_CLI_PROVIDERS = "openrouter";
    const urls: string[] = [];
    globalThis.fetch = mock(async (url: string) => {
      urls.push(url);
      return json({
        data: [freeModel],
        links: {
          next: url.includes("offset=")
            ? null
            : "/api/v1/models/user?offset=10&output_modalities=all",
        },
      });
    }) as unknown as typeof fetch;
    const result = await fetchCloudflareCatalog();
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain(
      "/openrouter/v1/models/user?output_modalities=all&offset=10"
    );
    expect(result.entries).toHaveLength(1);
  });
});

test("non-official Replicate models include the required prediction version", async () => {
  process.env.AI_CLI_PROVIDERS = "replicate";
  globalThis.fetch = mock(async () =>
    json({
      results: [
        {
          owner: "author",
          name: "model",
          is_official: false,
          latest_version: { id: "abc123" },
          default_example: { output: "https://example.com/image.png" },
        },
      ],
      next: null,
    })
  ) as unknown as typeof fetch;
  const result = await fetchCloudflareCatalog("replicate");
  expect(result.entries[0]?.id).toBe("replicate/author/model:abc123");
});
