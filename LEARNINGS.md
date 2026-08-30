---
date_created: 2026-08-29
date_updated: 2026-08-29
summary: Verified authenticated Cloudflare BYOK routing and provider-native media behavior for ai-cli.
related:
  - https://developers.cloudflare.com/ai-gateway/usage/rest-api/
  - https://developers.cloudflare.com/ai-gateway/usage/providers/
  - https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/
---

# Learnings

## Cloudflare AI Gateway provider selection

On 2026-08-29 on macOS, Cloudflare's account-scoped `/accounts/{id}/ai/*` API required `Account > Workers AI > Read`; an active AI Gateway management token without that permission returned error `10000`. Provider-native routes use a different boundary: the gateway must be authenticated, the client sends a token with `AI Gateway Run` in `cf-aig-authorization`, and upstream credentials remain in Cloudflare Provider Keys through BYOK. The CLI prefers `CLOUDFLARE_AI_GATEWAY_TOKEN`, falls back to `CLOUDFLARE_API_TOKEN`, and strips provider authorization before requests leave the client.

Cloudflare's `ai-gateway-provider` implements the AI SDK language-model interface but not image, video, speech, or transcription. The smallest verified multi-modal approach was to keep ai-cli's command layer intact and point each official AI SDK provider at its Cloudflare provider-native base URL. Cloudflare replaces each provider's normal API prefix, so Replicate uses `/replicate`, Fal uses `/fal`, Google uses `/google-ai-studio/v1beta`, and OpenRouter uses `/openrouter/v1`.

## AI SDK patch alignment

The current provider packages use the newer video `doStart`/`doStatus` lifecycle from `@ai-sdk/provider` 4.0.8. Upstream's `ai` 7.0.3 expected the older `doGenerate` method, so a type cast passed compilation but failed at runtime. Keeping the provider packages and core `ai` package on compatible current 7.0.x/4.0.x patches removed the cast and restored video dispatch.

## Credential-safe provider requests

Google AI Studio accepts API keys in a query parameter, but Cloudflare AI Gateway records request paths. An early read-only discovery request using query authentication therefore placed the key in a gateway log. The BYOK design removes provider credentials from local environment variables, headers, and query strings; the Cloudflare-scoped fetch wrapper also strips SDK placeholder authentication. Rotate any key previously sent in a logged URL.

## Replicate predictions through Cloudflare

Replicate's image endpoint returned an asynchronous prediction envelope through Cloudflare even when the AI SDK requested a synchronous response with `Prefer: wait`. The image adapter expected the final output and failed after the prediction had started. A Cloudflare-scoped fetch wrapper now removes that preference, polls the prediction through the gateway until it reaches a terminal state, and returns the final envelope. Video keeps its native asynchronous lifecycle, but direct Replicate status URLs are rewritten to the configured Cloudflare base URL so every polling request remains on the gateway.

Replicate Flux 2's current schema accepts reference images in the plural `input_images` array. The installed AI SDK emitted numbered `input_image`, `input_image_2`, and later fields instead. The Cloudflare adapter combines those fields into `input_images`; a live Flux 2 image-to-image call verified the compatibility rewrite.

## Fal queues and transcription

The Fal SDK uses the configured base URL for image calls but constructs absolute `fal.run` and `queue.fal.run` URLs for speech, video, transcription, submission, status, and result calls. Cloudflare mode rewrites those requests to its `/fal` route and sends the exact original URL in `x-fal-target-url`. Fal CDN downloads remain direct and never receive the Cloudflare Run token.

The installed Fal SDK defaulted transcription `chunkLevel` to `word`, while the live endpoint accepted `segment`. The Cloudflare wrapper defaults to `segment` and still honors an explicit `providerOptions.fal.chunkLevel` override.

## Provider-hosted video downloads through BYOK

Google Veo and OpenRouter return completed video file URLs on their provider origins rather than the configured Cloudflare origin. Cloudflare mode maps validated Google `generativelanguage.googleapis.com/v1beta/...` and OpenRouter `openrouter.ai/api/v1/videos/...` URLs back to their provider-native gateway bases. Provider `key` query parameters are removed, and redirects to media CDNs are followed without forwarding the Cloudflare Run token.

## Live validation boundaries

Live media calls for OpenRouter, Replicate, and Fal succeeded through the authenticated gateway with all local provider credentials unset. Google image/video and OpenAI inference reached upstream account limits and returned quota or credit errors, so those providers were not recorded as successful inference tests.

ImageMagick was absent from Patrick's macOS test environment on 2026-08-29. `ffmpeg` was available and generated the deterministic media fixture instead. This is an environment fact, not an ai-cli runtime dependency.

## Local Bun link on Patrick's Mac

On 2026-08-30, `bun link --cwd packages/ai-cli` correctly registered the package and created `$HOME/.bun/bin/ai`, but that directory was not on Patrick's PATH. The verified local entrypoint is `$HOME/.local/bin/ai`, symlinked to the Bun-generated executable. Rebuild `packages/ai-cli/dist` after source changes; the linked command then follows this checkout without reinstalling.
