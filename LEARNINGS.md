---
date_created: 2026-08-29
date_updated: 2026-08-29
summary: Verified Cloudflare AI Gateway integration constraints and provider-native routing behavior for ai-cli.
related:
  - https://developers.cloudflare.com/ai-gateway/usage/rest-api/
  - https://developers.cloudflare.com/ai-gateway/usage/providers/
---

# Learnings

## Cloudflare AI Gateway provider selection

On 2026-08-29 on macOS, Cloudflare's account-scoped `/accounts/{id}/ai/*` API required `Account > Workers AI > Read`; an active AI Gateway management token without that permission returned error `10000`. The existing provider-native gateway routes worked without an account change for OpenAI, Google AI Studio, OpenRouter, and Replicate when their upstream keys were forwarded.

Cloudflare's `ai-gateway-provider` implements the AI SDK language-model interface but not image, video, speech, or transcription. The smallest verified multi-modal approach was to keep ai-cli's command layer intact and point each official AI SDK provider at its Cloudflare provider-native base URL. Cloudflare replaces each provider's normal API prefix, so Replicate uses `/replicate` rather than `/replicate/v1`, while Google and OpenRouter retain the version suffix expected by their SDK adapters.

## AI SDK patch alignment

The current provider packages use the newer video `doStart`/`doStatus` lifecycle from `@ai-sdk/provider` 4.0.8. Upstream's `ai` 7.0.3 expected the older `doGenerate` method, so a type cast passed compilation but failed at runtime. Keeping the provider packages and core `ai` package on compatible current 7.0.x/4.0.x patches removed the cast and restored video dispatch.

## Credential-safe Google discovery

Google AI Studio accepts API keys in either a query parameter or the `x-goog-api-key` header, but Cloudflare AI Gateway records request paths. A read-only discovery request made with query authentication therefore placed the key in Cloudflare's gateway log. Use the header exclusively, never print raw gateway paths, and rotate any key previously sent in a logged URL.

## Replicate predictions through Cloudflare

Replicate's image endpoint returned an asynchronous prediction envelope through Cloudflare even when the AI SDK requested a synchronous response with `Prefer: wait`. The image adapter expected the final output and failed after the prediction had started. A Cloudflare-scoped fetch wrapper now removes that preference, polls the prediction through the gateway until it reaches a terminal state, and returns the final envelope. Video keeps its native asynchronous lifecycle, but direct Replicate status URLs are rewritten to the configured Cloudflare base URL so every polling request remains on the gateway.

## Google video downloads

The Google video adapter authenticates the final Veo download only when its URI shares the configured provider origin. With a Cloudflare base URL, Google still returns the completed file on `generativelanguage.googleapis.com`, so the adapter omits the key by design. Cloudflare mode supplies a validated download function that sends `x-goog-api-key` to that exact Google host and strips it if the request redirects to another origin.
