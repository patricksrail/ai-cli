import { afterEach, expect, test } from "bun:test";

import { generateImage } from "ai";

import { routeCloudflareModel, imageModel } from "../lib/gateway.js";
import { PROVIDERS, PROVIDER_REGISTRY, providersFor } from "./providers.js";
import {
  checkWorkersAIFreeBilling,
  workersAIImage,
  workersAIEntries,
  WORKERS_AI_IMAGE,
} from "./workers-ai.js";

const env = {
  CLOUDFLARE_ACCOUNT_ID: "account",
  CLOUDFLARE_API_TOKEN: "cf-token",
  CLOUDFLARE_AI_GATEWAY_ID: "ai-cli",
};
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const json = (result: unknown) =>
  new Response(JSON.stringify({ success: true, result }), {
    headers: { "content-type": "application/json" },
  });
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7ioAAAAASUVORK5CYII=";
const budget = {
  workers_ai_billing_mode: "postpaid",
  spend_limits: {
    enabled: true,
    rules: [
      {
        enabled: true,
        limitType: "cost",
        limit: 20,
        window: 2592000,
        provider: { mode: "filter", values: ["workers-ai"] },
      },
    ],
  },
};
test("capped ordinary generation works without advertising the model as free", async () => {
  mockRequests([json([{ name: WORKERS_AI_IMAGE }]), json(budget)]);
  expect((await workersAIEntries(env))[0]?.freeTier).toBeUndefined();
  const calls = mockRequests([json(budget), json({ image: png })]);
  const result = await generateImage({
    model: workersAIImage(WORKERS_AI_IMAGE, env),
    prompt: "boat",
    maxRetries: 0,
  });
  expect(result.image.base64).toBe(png);
  expect(calls).toHaveLength(2);
});
test("a budget cannot turn explicit free mode into paid inference", async () => {
  const calls = mockRequests([
    json(budget),
    json([{ rate_plan: { id: "workers_standard" }, price: 5 }]),
  ]);
  await expect(
    generateImage({
      model: workersAIImage(WORKERS_AI_IMAGE, {
        ...env,
        AI_CLI_FREE_ONLY: "1",
      }),
      prompt: "boat",
      maxRetries: 0,
    })
  ).rejects.toThrow("Workers Free");
  expect(calls.every((c) => c.init?.method !== "POST")).toBe(true);
});
test.each([
  { limit: 21 },
  { window: 86400 },
  { enabled: false },
  { provider: { mode: "filter", values: ["openrouter"] } },
  { model: { mode: "filter", values: ["another-model"] } },
  { metadata: { user: { mode: "partition" } } },
])("inadequate budget %j refuses paid inference", async (override) => {
  const gateway = {
    ...budget,
    spend_limits: {
      enabled: true,
      rules: [{ ...budget.spend_limits.rules[0], ...override }],
    },
  };
  const calls = mockRequests([
    json(gateway),
    json([{ rate_plan: { id: "workers_standard" }, price: 5 }]),
  ]);
  await expect(
    generateImage({
      model: workersAIImage(WORKERS_AI_IMAGE, env),
      prompt: "boat",
      maxRetries: 0,
    })
  ).rejects.toThrow("Workers Free");
  expect(calls.every((c) => c.init?.method !== "POST")).toBe(true);
});
function mockRequests(responses: Response[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      calls.push({ url: String(input), init });
      const result = responses.shift();
      if (!result) throw new Error("unexpected request");
      return result;
    },
    { preconnect: originalFetch.preconnect }
  );
  return calls;
}
test("central registry drives native routing and supported modalities", () => {
  expect(
    routeCloudflareModel(`workers-ai/${WORKERS_AI_IMAGE}`, "image")
  ).toEqual({ provider: "workers-ai", modelId: WORKERS_AI_IMAGE });
  expect(() =>
    routeCloudflareModel(`workers-ai/${WORKERS_AI_IMAGE}`, "language")
  ).toThrow("not supported");
  expect(providersFor("image")).toContain("workers-ai");
  for (const id of PROVIDERS) {
    expect(PROVIDER_REGISTRY[id].nuance.length).toBeGreaterThan(20);
    expect(PROVIDER_REGISTRY[id].sources.length).toBeGreaterThan(0);
  }
});
test("disabled Workers AI integration refuses CLI model creation without network", () => {
  const calls = mockRequests([]);
  expect(() => imageModel(`workers-ai/${WORKERS_AI_IMAGE}`)).toThrow(
    "disabled"
  );
  expect(calls).toHaveLength(0);
});
test("Workers AI SDK flow verifies billing, uses existing gateway and decodes native image", async () => {
  const calls = mockRequests([
    json({ workers_ai_billing_mode: "postpaid" }),
    json([]),
    json({ image: png }),
  ]);
  const result = await generateImage({
    model: workersAIImage(WORKERS_AI_IMAGE, env),
    prompt: "A blue boat",
    maxRetries: 0,
  });
  expect(result.image.base64).toBe(png);
  expect(calls).toHaveLength(3);
  expect(calls[2]?.url).toBe(
    `https://api.cloudflare.com/client/v4/accounts/account/ai/run/${WORKERS_AI_IMAGE}`
  );
  const headers = new Headers(calls[2]?.init?.headers);
  expect(headers.get("Authorization")).toBe("Bearer cf-token");
  expect(headers.get("cf-aig-gateway-id")).toBe("ai-cli");
  expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({
    prompt: "A blue boat",
    steps: 4,
  });
  expect(calls.every((call) => call.init?.redirect === "error")).toBe(true);
});
test.each(["unified", undefined])(
  "free-only refuses %s gateway billing without inference",
  async (mode) => {
    const calls = mockRequests([json({ workers_ai_billing_mode: mode })]);
    await expect(
      generateImage({
        model: workersAIImage(WORKERS_AI_IMAGE, env),
        prompt: "boat",
        maxRetries: 0,
      })
    ).rejects.toThrow("prepaid/unified or unknown");
    expect(calls.every((call) => call.init?.method !== "POST")).toBe(true);
  }
);
test.each([
  [{ rate_plan: { id: "workers_standard" }, price: 5 }],
  [{ rate_plan: { id: "unrecognized-product" }, price: 0 }],
  [{ rate_plan: { id: "workers_free" }, price: 5 }],
])(
  "free-only refuses paid or unverified subscriptions %j",
  async (subscriptions) => {
    const calls = mockRequests([
      json({ workers_ai_billing_mode: "postpaid" }),
      json([subscriptions]),
    ]);
    await expect(checkWorkersAIFreeBilling(env)).rejects.toThrow(
      "cannot verify a Workers Free plan"
    );
    expect(calls.every((call) => call.init?.method !== "POST")).toBe(true);
  }
);
test("subscription permission failures cannot turn into paid requests", async () => {
  const calls = mockRequests([
    json({ workers_ai_billing_mode: "postpaid" }),
    new Response("private response", { status: 403 }),
  ]);
  await expect(checkWorkersAIFreeBilling(env)).rejects.toThrow(
    "subscription reads"
  );
  expect(calls).toHaveLength(2);
});
test("free catalog entries require live model and billing checks", async () => {
  mockRequests([
    json([{ name: WORKERS_AI_IMAGE }]),
    json({ workers_ai_billing_mode: "postpaid" }),
    json([]),
  ]);
  expect((await workersAIEntries(env))[0]?.freeTier?.condition).toContain(
    "provider hard stop"
  );
});
test("unsupported image models and size controls fail without any network calls", async () => {
  const calls = mockRequests([]);
  expect(() => workersAIImage("@cf/unknown", env)).toThrow("only");
  await expect(
    generateImage({
      model: workersAIImage(WORKERS_AI_IMAGE, env),
      prompt: "boat",
      size: "512x512",
      maxRetries: 0,
    })
  ).rejects.toThrow("omit these options");
  expect(calls).toHaveLength(0);
});
