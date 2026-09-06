import { expect, test } from "bun:test";

import { generateImage } from "ai";

import { imageModel } from "../lib/gateway.js";

// Exercise the real SDK and BYOK transport together. A model creator prefix must
// survive the OpenRouter host prefix; local provider keys must never be sent.
test("image generation uses Cloudflare -> OpenRouter -> native model and decodes the image", async () => {
  const keys = [
    "AI_CLI_GATEWAY",
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_AI_GATEWAY_ID",
    "CLOUDFLARE_AI_GATEWAY_TOKEN",
    "OPENROUTER_API_KEY",
  ];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  try {
    Object.assign(process.env, {
      AI_CLI_GATEWAY: "cloudflare",
      CLOUDFLARE_ACCOUNT_ID: "account",
      CLOUDFLARE_AI_GATEWAY_ID: "ai-cli",
      CLOUDFLARE_AI_GATEWAY_TOKEN: "run-token",
      OPENROUTER_API_KEY: "must-not-be-forwarded",
    });
    let count = 0;
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7ioAAAAASUVORK5CYII=";
    globalThis.fetch = Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        count++;
        expect(String(input)).toBe(
          "https://gateway.ai.cloudflare.com/v1/account/ai-cli/openrouter/v1/images"
        );
        const headers = new Headers(init?.headers);
        expect(headers.get("cf-aig-authorization")).toBe("Bearer run-token");
        expect(headers.has("authorization")).toBe(false);
        expect(JSON.parse(String(init?.body)).model).toBe(
          "google/gemini-3.1-flash-image-preview"
        );
        return new Response(JSON.stringify({ data: [{ b64_json: png }] }), {
          headers: { "content-type": "application/json" },
        });
      },
      { preconnect: originalFetch.preconnect }
    );
    const result = await generateImage({
      model: imageModel("openrouter/google/gemini-3.1-flash-image-preview"),
      prompt: "A blue square",
      maxRetries: 0,
    });
    expect(count).toBe(1);
    expect(result.image.base64).toBe(png);
    expect(result.image.mediaType).toBe("image/png");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
