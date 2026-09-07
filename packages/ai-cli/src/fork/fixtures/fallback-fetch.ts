// Subprocess-only HTTP fixture. An unexpected request fails instead of using the network.
import { appendFileSync } from "node:fs";

let vercelAttempts = 0;

globalThis.fetch = (async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  const headers = new Headers(init?.headers);
  appendFileSync(
    process.env.FIXTURE_REQUESTS!,
    JSON.stringify({
      url,
      body: init?.body ? JSON.parse(String(init.body)) : null,
      providerAuth:
        headers.has("authorization") || headers.has("x-goog-api-key"),
      gatewayAuth: headers.get("cf-aig-authorization"),
    }) + "\n"
  );
  // Vercel uses the AI SDK model protocol. Fail once to prove the CLI leaves
  // its SDK retry defaults intact; no Cloudflare route should be contacted.
  if (url.endsWith("/language-model")) {
    vercelAttempts++;
    if (vercelAttempts === 1)
      return Response.json(
        { error: { message: "Temporarily unavailable" } },
        { status: 503, headers: { "retry-after-ms": "1" } }
      );
    return Response.json({
      content: [{ type: "text", text: "VERCEL_RETRIED" }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
    });
  }
  if (new URL(url).pathname.endsWith("/models/user"))
    return Response.json({
      data: [
        {
          id: "openrouter/free",
          architecture: { output_modalities: ["text"] },
          pricing: { prompt: "0", completion: "0" },
        },
      ],
    });
  if (new URL(url).pathname.endsWith("/models"))
    return Response.json({
      models: [
        {
          name: "models/gemini-3.8-flash",
          supportedGenerationMethods: ["generateContent"],
        },
      ],
    });
  if (url.includes(":generateContent"))
    return Response.json(
      {
        error: {
          message: "Quota exhausted",
          code: 429,
          status: "RESOURCE_EXHAUSTED",
        },
      },
      { status: 429 }
    );
  if (url.endsWith("/chat/completions"))
    return Response.json({
      id: "recovered",
      object: "chat.completion",
      created: 1,
      model: "google/gemini-3.8-flash",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "RECOVERED" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  throw new Error(`Unexpected fixture request: ${url}`);
}) as typeof fetch;
