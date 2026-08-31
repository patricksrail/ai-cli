import { afterEach, describe, expect, test } from "bun:test";

import { createFal } from "@ai-sdk/fal";

import {
  cloudflareProviderBaseURL,
  createCloudflareByokFetch,
  createCloudflareFalQueueVideoModel,
  createCloudflareFalClientFetch,
  createCloudflareFalFetch,
  createCloudflareGoogleVideoDownload,
  createCloudflareOpenRouterVideoDownload,
  createCloudflareReplicateFetch,
  imageModel,
  languageModel,
  resolveCloudflareGatewayConfig,
  resolveGatewayBackend,
  routeCloudflareModel,
  speechModel,
  transcriptionModel,
  videoModel,
  withCloudflareFalTranscriptionDefaults,
} from "./gateway.js";

const REPLICATE_BASE_URL =
  "https://gateway.ai.cloudflare.com/v1/account/gateway/replicate";
const FAL_BASE_URL = "https://gateway.ai.cloudflare.com/v1/account/gateway/fal";
const GOOGLE_BASE_URL =
  "https://gateway.ai.cloudflare.com/v1/account/gateway/google-ai-studio/v1beta";
const OPENROUTER_BASE_URL =
  "https://gateway.ai.cloudflare.com/v1/account/gateway/openrouter/v1";

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
  "CLOUDFLARE_AI_GATEWAY_TOKEN",
  "CLOUDFLARE_API_TOKEN",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "OPENROUTER_API_KEY",
  "REPLICATE_API_TOKEN",
  "FAL_API_KEY",
  "FAL_KEY",
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
  test("defaults to Cloudflare and keeps Vercel available explicitly", () => {
    expect(resolveGatewayBackend({})).toBe("cloudflare");
    expect(resolveGatewayBackend({ AI_CLI_GATEWAY: " cloudflare " })).toBe(
      "cloudflare"
    );
    expect(resolveGatewayBackend({ AI_CLI_GATEWAY: "vercel" })).toBe("vercel");
  });

  test("rejects unknown backends", () => {
    expect(() => resolveGatewayBackend({ AI_CLI_GATEWAY: "other" })).toThrow(
      "AI_CLI_GATEWAY must be one of"
    );
  });
});

describe("resolveCloudflareGatewayConfig", () => {
  test("requires an account and a gateway token", () => {
    expect(() => resolveCloudflareGatewayConfig({})).toThrow(
      "CLOUDFLARE_ACCOUNT_ID is required"
    );

    expect(() =>
      resolveCloudflareGatewayConfig({ CLOUDFLARE_ACCOUNT_ID: "account" })
    ).toThrow(
      "CLOUDFLARE_AI_GATEWAY_TOKEN or CLOUDFLARE_API_TOKEN is required"
    );
  });

  test("defaults the gateway id and adds gateway authorization", () => {
    expect(
      resolveCloudflareGatewayConfig({
        CLOUDFLARE_ACCOUNT_ID: "account",
        CLOUDFLARE_AI_GATEWAY_TOKEN: "run-token",
      }).gatewayId
    ).toBe("ai-cli");

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

  test("prefers a least-privilege gateway token", () => {
    expect(
      resolveCloudflareGatewayConfig({
        CLOUDFLARE_ACCOUNT_ID: "account",
        CLOUDFLARE_AI_GATEWAY_TOKEN: "run-token",
        CLOUDFLARE_API_TOKEN: "management-token",
      }).headers
    ).toEqual({ "cf-aig-authorization": "Bearer run-token" });
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
    expect(cloudflareProviderBaseURL("fal", config)).toBe(
      "https://gateway.ai.cloudflare.com/v1/account-id/gateway-id/fal"
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
    expect(routeCloudflareModel("fal/fal-ai/flux/schnell", "image")).toEqual({
      provider: "fal",
      modelId: "fal-ai/flux/schnell",
    });
    expect(routeCloudflareModel("fal-ai/minimax/h3-max", "video")).toEqual({
      provider: "fal",
      modelId: "minimax/h3-max",
    });
    expect(routeCloudflareModel("fal-ai/flux/schnell", "image")).toEqual({
      provider: "fal",
      modelId: "fal-ai/flux/schnell",
    });
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
    expect(() => routeCloudflareModel("fal/model", "language")).toThrow(
      "Cloudflare language model"
    );
    expect(() => routeCloudflareModel("elevenlabs/voice", "speech")).toThrow(
      "openai/, google/, fal/"
    );
  });
});

describe("createCloudflareByokFetch", () => {
  test("removes provider credentials from Cloudflare requests", async () => {
    const { calls, fetchFunction } = sequentialFetch([new Response("ok")]);
    const byokFetch = createCloudflareByokFetch(fetchFunction);

    await byokFetch(`${GOOGLE_BASE_URL}/models/gemini:generateContent`, {
      method: "POST",
      headers: {
        authorization: "Bearer provider-secret",
        "x-goog-api-key": "provider-secret",
        "cf-aig-authorization": "Bearer cloudflare-token",
        "content-type": "application/json",
      },
      body: "{}",
    });

    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.has("authorization")).toBe(false);
    expect(headers.has("x-goog-api-key")).toBe(false);
    expect(headers.get("cf-aig-authorization")).toBe("Bearer cloudflare-token");
    expect(headers.get("content-type")).toBe("application/json");
  });
});

describe("createCloudflareFalFetch", () => {
  test("rewrites sync and queue inference with the exact Fal target", async () => {
    const { calls, fetchFunction } = sequentialFetch([
      new Response("sync"),
      new Response("queue"),
    ]);
    const falFetch = createCloudflareFalFetch(FAL_BASE_URL, fetchFunction);
    const syncTarget = "https://fal.run/fal-ai/minimax/speech-02-turbo";
    const queueTarget =
      "https://queue.fal.run/fal-ai/wan/v2.2-5b/text-to-video?fal_webhook=https%3A%2F%2Fexample.com%2Fhook";
    const authHeaders = {
      authorization: "Key provider-secret",
      "cf-aig-authorization": "Bearer cloudflare-token",
    };

    await falFetch(syncTarget, { method: "POST", headers: authHeaders });
    await falFetch(queueTarget, { method: "POST", headers: authHeaders });

    expect(calls.map((call) => call.input)).toEqual([
      FAL_BASE_URL,
      FAL_BASE_URL,
    ]);
    expect(
      calls.map((call) =>
        new Headers(call.init?.headers).get("x-fal-target-url")
      )
    ).toEqual([syncTarget, queueTarget]);
    for (const call of calls) {
      const headers = new Headers(call.init?.headers);
      expect(headers.has("authorization")).toBe(false);
      expect(headers.get("cf-aig-authorization")).toBe(
        "Bearer cloudflare-token"
      );
    }
  });

  test("preserves a Fal Request method, body, and signal", async () => {
    const { calls, fetchFunction } = sequentialFetch([new Response("ok")]);
    const falFetch = createCloudflareFalFetch(FAL_BASE_URL, fetchFunction);
    const controller = new AbortController();
    const request = new Request("https://fal.run/fal-ai/test-model", {
      method: "POST",
      headers: {
        authorization: "Key provider-secret",
        "cf-aig-authorization": "Bearer cloudflare-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ prompt: "hello" }),
      signal: controller.signal,
    });

    await falFetch(request);

    const forwarded = calls[0]?.input;
    expect(forwarded).toBeInstanceOf(Request);
    const forwardedRequest = forwarded as Request;
    expect(forwardedRequest.url).toBe(FAL_BASE_URL);
    expect(forwardedRequest.method).toBe("POST");
    expect(await forwardedRequest.clone().json()).toEqual({ prompt: "hello" });
    expect(forwardedRequest.signal.aborted).toBe(false);
    controller.abort();
    expect(forwardedRequest.signal.aborted).toBe(true);
  });

  test("leaves Fal CDN downloads direct", async () => {
    const { calls, fetchFunction } = sequentialFetch([new Response("media")]);
    const falFetch = createCloudflareFalFetch(FAL_BASE_URL, fetchFunction);
    const mediaURL = "https://fal.media/files/output.mp4";

    await falFetch(mediaURL);

    expect(calls[0]?.input).toBe(mediaURL);
    expect(new Headers(calls[0]?.init?.headers).has("x-fal-target-url")).toBe(
      false
    );
  });
});

describe("createCloudflareFalClientFetch", () => {
  test("authenticates only Cloudflare proxy requests", async () => {
    const { calls, fetchFunction } = sequentialFetch([
      new Response("gateway"),
      new Response("direct"),
    ]);
    const falClientFetch = createCloudflareFalClientFetch(
      { "cf-aig-authorization": "Bearer cloudflare-token" },
      fetchFunction
    );

    await falClientFetch(FAL_BASE_URL, {
      headers: { authorization: "Key provider-placeholder" },
    });
    await falClientFetch("https://v3.fal.media/video.mp4");

    const gatewayHeaders = new Headers(calls[0]?.init?.headers);
    expect(gatewayHeaders.has("authorization")).toBe(false);
    expect(gatewayHeaders.get("cf-aig-authorization")).toBe(
      "Bearer cloudflare-token"
    );
    expect(
      new Headers(calls[1]?.init?.headers).has("cf-aig-authorization")
    ).toBe(false);
  });
});

describe("createCloudflareFalQueueVideoModel", () => {
  test("uses Fal's official Cloudflare proxy flow without changing publisher namespaces", async () => {
    let clientSettings: unknown;
    let subscription: { endpointId: string; options: unknown } | undefined;
    const model = createCloudflareFalQueueVideoModel(
      "minimax/h3-max/text-to-video",
      {
        CLOUDFLARE_ACCOUNT_ID: "account",
        CLOUDFLARE_AI_GATEWAY_ID: "gateway",
        CLOUDFLARE_AI_GATEWAY_TOKEN: "cloudflare-token",
      },
      (settings) => {
        clientSettings = settings;
        return {
          async subscribe(endpointId, options) {
            subscription = { endpointId, options };
            return {
              requestId: "fal-request-id",
              data: {
                video: {
                  url: "https://v3.fal.media/video.mp4",
                  content_type: "video/mp4",
                  width: 1366,
                  height: 768,
                },
              },
            };
          },
        };
      }
    );

    const result = await model.doGenerate!({
      prompt: "A paper boat crosses a puddle",
      n: 1,
      aspectRatio: "16:9",
      resolution: "1366x768",
      duration: 5,
      fps: undefined,
      seed: 42,
      image: undefined,
      frameImages: undefined,
      inputReferences: undefined,
      generateAudio: undefined,
      providerOptions: {},
      headers: { "x-title": "ai-cli", ignored: undefined },
    });

    expect(clientSettings).toMatchObject({
      proxyUrl: { url: FAL_BASE_URL, when: "always" },
    });
    expect(typeof (clientSettings as { fetch?: unknown }).fetch).toBe(
      "function"
    );
    expect("credentials" in (clientSettings as object)).toBe(false);
    expect(subscription).toEqual({
      endpointId: "minimax/h3-max/text-to-video",
      options: {
        input: {
          prompt: "A paper boat crosses a puddle",
          aspect_ratio: "16:9",
          duration: 5,
          resolution: "768P",
          seed: 42,
          prompt_expansion_mode: "balanced",
          enable_safety_checker: true,
        },
        abortSignal: undefined,
        headers: { "x-title": "ai-cli" },
        logs: false,
        mode: "polling",
      },
    });
    expect(result.videos).toEqual([
      {
        type: "url",
        url: "https://v3.fal.media/video.mp4",
        mediaType: "video/mp4",
      },
    ]);
    expect(result.response.headers).toEqual({
      "x-request-id": "fal-request-id",
    });
  });

  test("selects H3 Max image-to-video from the short provider model ID", async () => {
    let endpointId: string | undefined;
    let input: Record<string, unknown> | undefined;
    const model = createCloudflareFalQueueVideoModel(
      "minimax/h3-max",
      {
        CLOUDFLARE_ACCOUNT_ID: "account",
        CLOUDFLARE_API_TOKEN: "cloudflare-token",
      },
      () => ({
        async subscribe(endpoint, options) {
          endpointId = endpoint;
          input = options.input;
          return {
            requestId: "request",
            data: { video: { url: "https://v3.fal.media/video.mp4" } },
          };
        },
      })
    );

    await model.doGenerate!({
      prompt: "Animate this",
      n: 1,
      aspectRatio: undefined,
      resolution: undefined,
      duration: undefined,
      fps: undefined,
      seed: undefined,
      image: { type: "url", url: "https://example.com/input.png" },
      frameImages: undefined,
      inputReferences: undefined,
      generateAudio: undefined,
      providerOptions: {},
    });

    expect(endpointId).toBe("minimax/h3-max/image-to-video");
    expect(input?.image_url).toBe("https://example.com/input.png");
  });

  test("fails clearly when Fal completes without a video URL", async () => {
    const model = createCloudflareFalQueueVideoModel(
      "minimax/h3-max",
      {
        CLOUDFLARE_ACCOUNT_ID: "account",
        CLOUDFLARE_API_TOKEN: "cloudflare-token",
      },
      () => ({
        async subscribe() {
          return { requestId: "request", data: {} };
        },
      })
    );

    expect(
      model.doGenerate!({
        prompt: "prompt",
        n: 1,
        aspectRatio: undefined,
        resolution: undefined,
        duration: undefined,
        fps: undefined,
        seed: undefined,
        image: undefined,
        frameImages: undefined,
        inputReferences: undefined,
        generateAudio: undefined,
        providerOptions: {},
      })
    ).rejects.toThrow("without a video result");
  });
});

describe("withCloudflareFalTranscriptionDefaults", () => {
  test("defaults chunk level to segment and respects an explicit override", async () => {
    const { calls, fetchFunction } = sequentialFetch([
      jsonResponse({ request_id: "default-request" }),
      jsonResponse({ text: "default", chunks: [] }),
      jsonResponse({ request_id: "override-request" }),
      jsonResponse({ text: "override", chunks: [] }),
    ]);
    const model = withCloudflareFalTranscriptionDefaults(
      createFal({ apiKey: "test-key", fetch: fetchFunction }).transcription(
        "wizper"
      )
    );
    const audio = new Uint8Array([0x52, 0x49, 0x46, 0x46]);

    await model.doGenerate({ audio, mediaType: "audio/wav" });
    await model.doGenerate({
      audio,
      mediaType: "audio/wav",
      providerOptions: { fal: { chunkLevel: "word" } },
    });

    expect(JSON.parse(String(calls[0]?.init?.body)).chunk_level).toBe(
      "segment"
    );
    expect(JSON.parse(String(calls[2]?.init?.body)).chunk_level).toBe("word");
  });
});

describe("createCloudflareReplicateFetch", () => {
  test("rewrites Flux 2 reference images to Replicate's array schema", async () => {
    const { calls, fetchFunction } = sequentialFetch([
      jsonResponse({ id: "flux-2", status: "starting" }),
    ]);
    const cloudflareFetch = createCloudflareReplicateFetch(
      REPLICATE_BASE_URL,
      fetchFunction,
      0
    );

    await cloudflareFetch(
      `${REPLICATE_BASE_URL}/models/black-forest-labs/flux-2-pro/predictions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: {
            prompt: "edit these references",
            input_image: "data:image/png;base64,first",
            input_image_2: "data:image/png;base64,second",
          },
        }),
      }
    );

    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      input: {
        prompt: "edit these references",
        input_images: [
          "data:image/png;base64,first",
          "data:image/png;base64,second",
        ],
      },
    });
  });

  test("rewrites Flux 2 reference images from a Request body", async () => {
    const { calls, fetchFunction } = sequentialFetch([
      jsonResponse({ id: "flux-request", status: "starting" }),
    ]);
    const cloudflareFetch = createCloudflareReplicateFetch(
      REPLICATE_BASE_URL,
      fetchFunction,
      0
    );
    const request = new Request(
      `${REPLICATE_BASE_URL}/models/black-forest-labs/flux-2-pro/predictions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: {
            prompt: "edit this reference",
            input_image: "data:image/png;base64,first",
          },
        }),
      }
    );

    await cloudflareFetch(request);

    const forwarded = calls[0]?.input;
    expect(forwarded).toBeInstanceOf(Request);
    expect(await (forwarded as Request).clone().json()).toEqual({
      input: {
        prompt: "edit this reference",
        input_images: ["data:image/png;base64,first"],
      },
    });
  });

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
        headers: {
          authorization: "Bearer provider-secret",
          "cf-aig-authorization": "Bearer cloudflare-token",
          prefer: "wait",
        },
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
    for (const call of calls) {
      const headers = new Headers(call.init?.headers);
      expect(headers.has("authorization")).toBe(false);
      expect(headers.get("cf-aig-authorization")).toBe(
        "Bearer cloudflare-token"
      );
    }
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

describe("createCloudflareGoogleVideoDownload", () => {
  test("downloads Veo files through BYOK and drops auth on CDN redirects", async () => {
    const { calls, fetchFunction } = sequentialFetch([
      new Response(null, {
        status: 302,
        headers: { location: "https://storage.googleapis.com/video.mp4" },
      }),
      new Response(new Uint8Array([0, 0, 0, 24]), {
        headers: { "content-type": "video/mp4" },
      }),
    ]);
    const download = createCloudflareGoogleVideoDownload(
      GOOGLE_BASE_URL,
      {
        authorization: "Bearer provider-secret",
        "x-goog-api-key": "provider-secret",
        "cf-aig-authorization": "Bearer cloudflare-token",
      },
      fetchFunction
    );

    const result = await download({
      url: new URL(
        "https://generativelanguage.googleapis.com/v1beta/files/video:download?alt=media&key=provider-secret"
      ),
    });

    expect(result.data).toEqual(new Uint8Array([0, 0, 0, 24]));
    expect(result.mediaType).toBe("video/mp4");
    expect(calls[0]?.input).toBe(
      `${GOOGLE_BASE_URL}/files/video:download?alt=media`
    );
    const gatewayRequestHeaders = new Headers(calls[0]?.init?.headers);
    expect(gatewayRequestHeaders.has("authorization")).toBe(false);
    expect(gatewayRequestHeaders.has("x-goog-api-key")).toBe(false);
    expect(gatewayRequestHeaders.get("cf-aig-authorization")).toBe(
      "Bearer cloudflare-token"
    );
    expect(
      new Headers(calls[1]?.init?.headers).has("cf-aig-authorization")
    ).toBe(false);
  });
});

describe("createCloudflareOpenRouterVideoDownload", () => {
  test("downloads video content through BYOK without credentialing other URLs", async () => {
    const { calls, fetchFunction } = sequentialFetch([
      new Response(null, {
        status: 302,
        headers: { location: "https://openrouter-cdn.example/video.mp4" },
      }),
      new Response(new Uint8Array([0, 0, 0, 24]), {
        headers: { "content-type": "video/mp4" },
      }),
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "video/mp4" },
      }),
    ]);
    const download = createCloudflareOpenRouterVideoDownload(
      OPENROUTER_BASE_URL,
      {
        authorization: "Bearer provider-secret",
        "cf-aig-authorization": "Bearer cloudflare-token",
      },
      fetchFunction
    );

    const result = await download({
      url: new URL(
        "https://openrouter.ai/api/v1/videos/video-id/content?index=0"
      ),
    });
    await download({
      url: new URL("https://openrouter.ai/api/v1/models"),
    });

    expect(result.data).toEqual(new Uint8Array([0, 0, 0, 24]));
    expect(result.mediaType).toBe("video/mp4");
    expect(calls[0]?.input).toBe(
      `${OPENROUTER_BASE_URL}/videos/video-id/content?index=0`
    );
    const gatewayRequestHeaders = new Headers(calls[0]?.init?.headers);
    expect(gatewayRequestHeaders.has("authorization")).toBe(false);
    expect(gatewayRequestHeaders.get("cf-aig-authorization")).toBe(
      "Bearer cloudflare-token"
    );
    expect(
      new Headers(calls[1]?.init?.headers).has("cf-aig-authorization")
    ).toBe(false);
    expect(calls[2]?.input).toBe("https://openrouter.ai/api/v1/models");
    expect(
      new Headers(calls[2]?.init?.headers).has("cf-aig-authorization")
    ).toBe(false);
  });
});

describe("gateway model factories", () => {
  test("explicit Vercel mode returns Vercel gateway models", () => {
    process.env.AI_CLI_GATEWAY = "vercel";

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

  test("default Cloudflare mode validates account configuration before model creation", () => {
    delete process.env.AI_CLI_GATEWAY;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;

    expect(() => languageModel("openai/gpt-5-mini")).toThrow(
      "CLOUDFLARE_ACCOUNT_ID is required"
    );
  });

  test("default Cloudflare mode constructs routed provider models without requests", () => {
    delete process.env.AI_CLI_GATEWAY;
    process.env.CLOUDFLARE_ACCOUNT_ID = "account";
    delete process.env.CLOUDFLARE_AI_GATEWAY_TOKEN;
    process.env.CLOUDFLARE_API_TOKEN = "cloudflare-token";
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.REPLICATE_API_TOKEN;
    delete process.env.FAL_API_KEY;
    delete process.env.FAL_KEY;

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
    expect(modelMetadata(imageModel("fal/fal-ai/flux/schnell")).modelId).toBe(
      "fal-ai/flux/schnell"
    );
    expect(
      modelMetadata(videoModel("fal/fal-ai/wan/v2.2-5b/image-to-video")).modelId
    ).toBe("fal-ai/wan/v2.2-5b/image-to-video");
    expect(modelMetadata(videoModel("fal-ai/minimax/h3-max")).modelId).toBe(
      "minimax/h3-max"
    );
    expect(
      modelMetadata(speechModel("fal/fal-ai/minimax/speech-02-turbo")).modelId
    ).toBe("fal-ai/minimax/speech-02-turbo");
    expect(modelMetadata(transcriptionModel("fal/fal-ai/wizper")).modelId).toBe(
      "wizper"
    );
  });
});
