import { afterEach, describe, expect, test } from "bun:test";

import {
  cloudflareProviderBaseURL,
  createCloudflareReplicateFetch,
  createGoogleVideoDownload,
  imageModel,
  languageModel,
  resolveCloudflareGatewayConfig,
  resolveGatewayBackend,
  routeCloudflareModel,
  speechModel,
  transcriptionModel,
  videoModel,
} from "./gateway.js";

const REPLICATE_BASE_URL =
  "https://gateway.ai.cloudflare.com/v1/account/gateway/replicate";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sequentialFetch(responses: Response[]) {
  const calls: Array<{
    input: Parameters<typeof fetch>[0];
    init?: Parameters<typeof fetch>[1];
  }> = [];
  const fetchFunction = Object.assign(
    async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1]
    ): Promise<Response> => {
      calls.push({ input, init });
      const response = responses.shift();
      if (!response) throw new Error("unexpected fetch call");
      return response;
    },
    { preconnect: globalThis.fetch.preconnect }
  );
  return { calls, fetchFunction };
}

const MANAGED_ENV_KEYS = [
  "AI_CLI_GATEWAY",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_AI_GATEWAY_ID",
  "CLOUDFLARE_API_TOKEN",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "OPENROUTER_API_KEY",
  "REPLICATE_API_TOKEN",
] as const;
const ORIGINAL_ENV = Object.fromEntries(
  MANAGED_ENV_KEYS.map((key) => [key, process.env[key]])
);

function modelMetadata(model: unknown): { modelId: string; provider?: string } {
  return model as { modelId: string; provider?: string };
}

afterEach(() => {
  for (const key of MANAGED_ENV_KEYS) {
    const value = ORIGINAL_ENV[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("resolveGatewayBackend", () => {
  test("keeps Vercel as the default and accepts an explicit Vercel value", () => {
    expect(resolveGatewayBackend({})).toBe("vercel");
    expect(resolveGatewayBackend({ AI_CLI_GATEWAY: "vercel" })).toBe("vercel");
  });

  test("uses Cloudflare only when selected explicitly", () => {
    expect(resolveGatewayBackend({ AI_CLI_GATEWAY: " cloudflare " })).toBe(
      "cloudflare"
    );
  });

  test("rejects unknown backends", () => {
    expect(() => resolveGatewayBackend({ AI_CLI_GATEWAY: "other" })).toThrow(
      "AI_CLI_GATEWAY must be one of"
    );
  });
});

describe("resolveCloudflareGatewayConfig", () => {
  test("requires an account and defaults the gateway id", () => {
    expect(() => resolveCloudflareGatewayConfig({})).toThrow(
      "CLOUDFLARE_ACCOUNT_ID is required"
    );

    expect(
      resolveCloudflareGatewayConfig({ CLOUDFLARE_ACCOUNT_ID: "account" })
    ).toEqual({ accountId: "account", gatewayId: "default", headers: {} });
  });

  test("adds optional authenticated-gateway authorization", () => {
    expect(
      resolveCloudflareGatewayConfig({
        CLOUDFLARE_ACCOUNT_ID: " account ",
        CLOUDFLARE_AI_GATEWAY_ID: " production ",
        CLOUDFLARE_API_TOKEN: " secret-token ",
      })
    ).toEqual({
      accountId: "account",
      gatewayId: "production",
      headers: { "cf-aig-authorization": "Bearer secret-token" },
    });
  });
});

describe("cloudflareProviderBaseURL", () => {
  const config = { accountId: "account-id", gatewayId: "gateway-id" };

  test("builds each provider-native Cloudflare URL", () => {
    expect(cloudflareProviderBaseURL("openai", config)).toBe(
      "https://gateway.ai.cloudflare.com/v1/account-id/gateway-id/openai"
    );
    expect(cloudflareProviderBaseURL("google", config)).toBe(
      "https://gateway.ai.cloudflare.com/v1/account-id/gateway-id/google-ai-studio/v1beta"
    );
    expect(cloudflareProviderBaseURL("openrouter", config)).toBe(
      "https://gateway.ai.cloudflare.com/v1/account-id/gateway-id/openrouter/v1"
    );
    expect(cloudflareProviderBaseURL("replicate", config)).toBe(
      "https://gateway.ai.cloudflare.com/v1/account-id/gateway-id/replicate"
    );
  });
});

describe("routeCloudflareModel", () => {
  test("strips explicit provider prefixes exactly once", () => {
    expect(
      routeCloudflareModel("openrouter/openai/gpt-5-mini", "language")
    ).toEqual({ provider: "openrouter", modelId: "openai/gpt-5-mini" });
    expect(
      routeCloudflareModel("replicate/owner/model/version", "video")
    ).toEqual({ provider: "replicate", modelId: "owner/model/version" });
  });

  test("routes creator-style text through OpenRouter with the full id", () => {
    expect(
      routeCloudflareModel("anthropic/claude-sonnet-4.5", "language")
    ).toEqual({
      provider: "openrouter",
      modelId: "anthropic/claude-sonnet-4.5",
    });
  });

  test("routes creator-style image and video through Replicate with full ids", () => {
    expect(routeCloudflareModel("bfl/flux-pro", "image")).toEqual({
      provider: "replicate",
      modelId: "bfl/flux-pro",
    });
    expect(routeCloudflareModel("bytedance/seedance", "video")).toEqual({
      provider: "replicate",
      modelId: "bytedance/seedance",
    });
  });

  test("rejects missing nested model ids and unsupported modalities", () => {
    expect(() => routeCloudflareModel("openai/", "language")).toThrow(
      'after "openai/"'
    );
    expect(() => routeCloudflareModel("replicate/model", "language")).toThrow(
      "Cloudflare language model"
    );
    expect(() => routeCloudflareModel("elevenlabs/voice", "speech")).toThrow(
      "openai/, google/"
    );
  });
});

describe("createCloudflareReplicateFetch", () => {
  test("turns Replicate image requests into gateway-polled responses", async () => {
    const { calls, fetchFunction } = sequentialFetch([
      jsonResponse({
        id: "prediction-1",
        status: "starting",
        urls: { get: "https://api.replicate.com/v1/predictions/prediction-1" },
      }),
      jsonResponse({
        id: "prediction-1",
        status: "processing",
        urls: { get: "https://api.replicate.com/v1/predictions/prediction-1" },
      }),
      jsonResponse({
        id: "prediction-1",
        status: "succeeded",
        output: ["https://replicate.delivery/image.webp"],
        urls: { get: "https://api.replicate.com/v1/predictions/prediction-1" },
      }),
    ]);
    const cloudflareFetch = createCloudflareReplicateFetch(
      REPLICATE_BASE_URL,
      fetchFunction,
      0
    );

    const response = await cloudflareFetch(
      `${REPLICATE_BASE_URL}/models/owner/model/predictions`,
      {
        method: "POST",
        headers: { authorization: "Bearer test", prefer: "wait" },
        body: "{}",
      }
    );

    expect(response.ok).toBe(true);
    expect(await response.json()).toMatchObject({
      id: "prediction-1",
      status: "succeeded",
      output: ["https://replicate.delivery/image.webp"],
      urls: {
        get: `${REPLICATE_BASE_URL}/predictions/prediction-1`,
      },
    });
    expect(calls).toHaveLength(3);
    expect(new Headers(calls[0]?.init?.headers).has("prefer")).toBe(false);
    expect(calls[1]?.input).toBe(
      `${REPLICATE_BASE_URL}/predictions/prediction-1`
    );
    expect(new Headers(calls[1]?.init?.headers).get("authorization")).toBe(
      "Bearer test"
    );
  });

  test("rewrites video status URLs without blocking the start call", async () => {
    const { calls, fetchFunction } = sequentialFetch([
      jsonResponse({
        id: "video-1",
        status: "starting",
        urls: { get: "https://api.replicate.com/v1/predictions/video-1" },
      }),
    ]);
    const cloudflareFetch = createCloudflareReplicateFetch(
      REPLICATE_BASE_URL,
      fetchFunction,
      0
    );

    const response = await cloudflareFetch(
      `${REPLICATE_BASE_URL}/models/owner/video/predictions`,
      { method: "POST", headers: { authorization: "Bearer test" }, body: "{}" }
    );

    expect(calls).toHaveLength(1);
    expect(await response.json()).toMatchObject({
      status: "starting",
      urls: { get: `${REPLICATE_BASE_URL}/predictions/video-1` },
    });
  });

  test("returns a useful provider error for failed image predictions", async () => {
    const { fetchFunction } = sequentialFetch([
      jsonResponse({ id: "prediction-2", status: "starting" }),
      jsonResponse({
        id: "prediction-2",
        status: "failed",
        error: "model rejected the input",
      }),
    ]);
    const cloudflareFetch = createCloudflareReplicateFetch(
      REPLICATE_BASE_URL,
      fetchFunction,
      0
    );

    const response = await cloudflareFetch(
      `${REPLICATE_BASE_URL}/models/owner/model/predictions`,
      { method: "POST", headers: { prefer: "wait" }, body: "{}" }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "model rejected the input",
    });
  });

  test("passes Replicate delivery bytes through without parsing them", async () => {
    const binaryResponse = new Response(
      new Uint8Array([0x52, 0x49, 0x46, 0x46]),
      {
        headers: { "content-type": "image/webp" },
      }
    );
    const originalClone = binaryResponse.clone.bind(binaryResponse);
    let cloned = false;
    Object.defineProperty(binaryResponse, "clone", {
      value: () => {
        cloned = true;
        return originalClone();
      },
    });
    const { fetchFunction } = sequentialFetch([binaryResponse]);
    const cloudflareFetch = createCloudflareReplicateFetch(
      REPLICATE_BASE_URL,
      fetchFunction,
      0
    );

    const response = await cloudflareFetch(
      "https://replicate.delivery/output.webp"
    );

    expect(response).toBe(binaryResponse);
    expect(cloned).toBe(false);
  });
});

describe("createGoogleVideoDownload", () => {
  test("sends the key to Google's file host and strips it on redirects", async () => {
    const { calls, fetchFunction } = sequentialFetch([
      new Response(null, {
        status: 302,
        headers: { location: "https://storage.googleapis.com/video.mp4" },
      }),
      new Response(new Uint8Array([0, 0, 0, 24]), {
        headers: { "content-type": "video/mp4" },
      }),
    ]);
    const download = createGoogleVideoDownload(
      "google-test-key",
      fetchFunction
    );

    const result = await download({
      url: new URL(
        "https://generativelanguage.googleapis.com/v1beta/files/video:download"
      ),
    });

    expect(result.data).toEqual(new Uint8Array([0, 0, 0, 24]));
    expect(result.mediaType).toBe("video/mp4");
    expect(new Headers(calls[0]?.init?.headers).get("x-goog-api-key")).toBe(
      "google-test-key"
    );
    expect(new Headers(calls[1]?.init?.headers).has("x-goog-api-key")).toBe(
      false
    );
  });
});

describe("gateway model factories", () => {
  test("default mode returns Vercel gateway models", () => {
    delete process.env.AI_CLI_GATEWAY;

    expect(
      modelMetadata(languageModel("openai/gpt-5-mini")).provider
    ).toContain("gateway");
    expect(modelMetadata(imageModel("openai/gpt-image-1")).modelId).toBe(
      "openai/gpt-image-1"
    );
    expect(modelMetadata(videoModel("google/veo")).modelId).toBe("google/veo");
    expect(modelMetadata(speechModel("openai/tts-1")).modelId).toBe(
      "openai/tts-1"
    );
    expect(modelMetadata(transcriptionModel("openai/whisper-1")).modelId).toBe(
      "openai/whisper-1"
    );
  });

  test("Cloudflare mode validates account configuration before model creation", () => {
    process.env.AI_CLI_GATEWAY = "cloudflare";
    delete process.env.CLOUDFLARE_ACCOUNT_ID;

    expect(() => languageModel("openai/gpt-5-mini")).toThrow(
      "CLOUDFLARE_ACCOUNT_ID is required"
    );
  });

  test("Cloudflare mode constructs routed provider models without requests", () => {
    process.env.AI_CLI_GATEWAY = "cloudflare";
    process.env.CLOUDFLARE_ACCOUNT_ID = "account";
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.GEMINI_API_KEY = "test-google-key";
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.REPLICATE_API_TOKEN = "test-replicate-token";

    expect(
      modelMetadata(languageModel("openrouter/openai/gpt-5-mini")).modelId
    ).toBe("openai/gpt-5-mini");
    expect(
      modelMetadata(imageModel("replicate/owner/image-model")).modelId
    ).toBe("owner/image-model");
    expect(modelMetadata(videoModel("google/veo-model")).modelId).toBe(
      "veo-model"
    );
    expect(modelMetadata(speechModel("openai/tts-1")).modelId).toBe("tts-1");
    expect(
      modelMetadata(transcriptionModel("google/transcribe-model")).modelId
    ).toBe("transcribe-model");
  });
});
