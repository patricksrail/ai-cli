---
date_created: 2026-08-29
date_updated: 2026-09-06
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

Fal endpoint namespaces are not uniformly `fal-ai/...`. MiniMax H3 Max's official endpoint is `minimax/h3-max/text-to-video`, while the AI SDK Fal video adapter unconditionally builds `queue.fal.run/fal-ai/{model}`. On 2026-08-30, that produced a completed queue request whose result was `404 Path /h3-max/text-to-video not found`. The verified fix uses `@fal-ai/client` 1.10.1 for non-`fal-ai/` video namespaces with Cloudflare's documented `proxyUrl` configuration and `when: "always"` in Node/Bun. `fal.subscribe()` then owns submission, status polling, and result retrieval without changing the endpoint. H3 Max receives a numeric duration, its `480P`/`768P` resolution form, and required prompt-expansion default.

The first built-CLI H3 Max retest completed inference but failed while downloading the returned Fal CDN URL because AI SDK's safe Node downloader dynamically loads `undici`; Bun had not made the transitive package resolvable from the bundled entrypoint. Declaring the compatible `undici` 7 runtime dependency fixed every provider-hosted URL download without replacing the SDK's validated downloader.

The installed Fal SDK defaulted transcription `chunkLevel` to `word`, while the live endpoint accepted `segment`. The Cloudflare wrapper defaults to `segment` and still honors an explicit `providerOptions.fal.chunkLevel` override.

## Provider-hosted video downloads through BYOK

Google Veo and OpenRouter return completed video file URLs on their provider origins rather than the configured Cloudflare origin. Cloudflare mode maps validated Google `generativelanguage.googleapis.com/v1beta/...` and OpenRouter `openrouter.ai/api/v1/videos/...` URLs back to their provider-native gateway bases. Provider `key` query parameters are removed, and redirects to media CDNs are followed without forwarding the Cloudflare Run token.

## Live validation boundaries

Live media calls for OpenRouter, Replicate, and Fal succeeded through the authenticated gateway with all local provider credentials unset. The exact command `ai video -m "fal-ai/minimax/h3-max" --duration 5 ...` produced a 7,232,157-byte MP4 with 5.184 seconds of 1344x768 H.264 video at 24 fps and AAC audio. Google image/video and OpenAI inference reached upstream account limits and returned quota or credit errors, so those providers were not recorded as successful inference tests.

ImageMagick was absent from Patrick's macOS test environment on 2026-08-29. `ffmpeg` was available and generated the deterministic media fixture instead. This is an environment fact, not an ai-cli runtime dependency.

## Local Bun link on Patrick's Mac

On 2026-08-30, `bun link --cwd packages/ai-cli` correctly registered the package and created `$HOME/.bun/bin/ai`, but that directory was not on Patrick's PATH. The verified local entrypoint is `$HOME/.local/bin/ai`, symlinked to the Bun-generated executable. Rebuild `packages/ai-cli/dist` after source changes; the linked command then follows this checkout without reinstalling.

## Provider catalog discovery and free pricing

On 2026-09-06, macOS with Bun 1.3.5, all five stored providers exposed discovery through Cloudflare BYOK without local provider keys. Cloudflare `provider_configs` uses `provider_slug` and `alias`, and contains secret-preview fields; project only the provider inventory, never print the full management response. Discovery needs AI Gateway Read for this inventory, while an explicit provider can use a Run-only token.

OpenRouter's authenticated `/models/user?output_modalities=all` includes account preferences and non-text models. Some media entries have zero prompt/completion prices without establishing zero media cost. Only classify text-output entries with explicit zero prices as free; reject unknown, negative/dynamic, nonzero ancillary, and paid override prices. OpenRouter's native `openrouter/free` requires the CLI route `openrouter/openrouter/free` because the first segment selects the host.

Fal's model metadata works through the Cloudflare Fal route with `x-fal-target-url: https://api.fal.ai/v1/models`; follow `next_cursor`. Google uses `nextPageToken`. Replicate's public catalog is large enough that eager full scans make even a summary slow: show inventory without catalog scans, fetch a first Replicate page for browsing, and make all pages opt-in. Native `QUERY /models` search through Cloudflare was verified with `flux`. Replicate lacks a modality field; output-example extensions are only type hints. Never send a gateway token to a provider's absolute pagination URL; validate it and map its query back to Cloudflare.

## Google free tier and route-specific selection

Verified 2026-09-06 on macOS with Bun 1.3.5: the stored Google key lists Gemini 3.8 Flash through Cloudflare, and text generation succeeded. Google's [pricing](https://ai.google.dev/gemini-api/docs/pricing) lists its free tier, but [billing](https://ai.google.dev/gemini-api/docs/billing) makes that conditional on the key's project tier. Catalog visibility does not prove the project is unbilled. Keep dated exact Google model metadata in `src/fork/google-pricing.ts`; keep editable route preferences in `src/fork/model-preferences.json`. Never transfer Google's free eligibility to an OpenRouter route for the same model.

A 64-token Gemini probe returned no text because the output budget can be consumed by reasoning. The diagnostic probe uses 2048 output tokens and checks for nonempty text. Cloudflare-to-OpenRouter image generation also succeeded live; `src/fork/image-routing.test.ts` exercises the real SDK, gateway URL, stripped local authorization, native model ID, and decoded image with a mocked HTTP response.

## Low-cost image choices

Verified 2026-09-06 on Patrick's Mac: `ai image --provider fal -m fal-ai/sana --size 512x512` generated successfully through existing Cloudflare BYOK, without sourcing credentials in that invocation. Fal lists Sana at $0.001 per megapixel (https://fal.ai/models/fal-ai/sana). Do not promise proportional size discounts: Fal explicitly rounds Flux Schnell to whole megapixels (https://fal.ai/docs/model-api-reference/image-generation-api/flux-schnell), and Sana's short pricing statement does not establish its sub-megapixel minimum. OpenRouter documents no free image-generation models (https://openrouter.ai/blog/tutorials/image-generation-models/). Cloudflare Workers AI's daily allocation is separate from BYOK gateway routing; it does not make Fal or OpenRouter images free.

## Fresh-shell authentication differs from inherited environment

On 2026-09-06, an installed CLI check passed in the agent shell but failed in a fresh login shell started with only normal user/PATH variables: the Bun symlink did not load Cloudflare auth. The local `scripts/mac-ai.mjs` launcher fixes this by selecting only Cloudflare assignments from the canonical file with Node's environment parser, without evaluating shell code or loading local provider credentials. Existing environment values win. Test out-of-box behavior from `/tmp` with a sanitized environment; success in the agent's inherited environment is insufficient evidence. The `~/.local/bin/ai` link now points to this launcher; Bun's separate `~/.bun/bin/ai` link remains available.

## Workers AI authentication and gateway routing

Verified 2026-09-06 on macOS with Wrangler 4.129.0: Workers AI inference and catalog discovery use distinct token scopes. Workers AI Read enabled inference, but listing still failed with 403/code 10000 until Workers AI Metadata Read (`workers_ai_metadata_read`) was added. The live `/user/tokens/permission_groups` descriptions distinguished these scopes while the [model-list reference](https://developers.cloudflare.com/api/resources/ai/subresources/models/methods/list/) still named Read/Write. Check the live scope descriptions when the documented permission does not fix catalog authentication. A working gateway management token does not establish inference access; `default_usage_model=standard` does not establish a free account.

The [unified REST API](https://developers.cloudflare.com/ai-gateway/usage/rest-api/) accepts native Workers AI requests at `/accounts/{account}/ai/run/{model}` with Cloudflare bearer authentication. Adding `cf-aig-gateway-id` attaches AI Gateway logging and controls. Workers AI runs the model; AI Gateway remains the control layer. No deployed Worker or prepaid credits are required. The [unification announcement](https://blog.cloudflare.com/workers-ai-gateway-unification/) does not extend Workers AI's free allocation to external BYOK providers.

## Workers AI usage and spending controls

Under [standard pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), both Free and Paid plans receive 10,000 neurons daily; Free stops at quota, while Paid can incur overage. At $0.011 per 1,000 neurons, the allowance represents $0.11 of usage per day, not cash credit. A small allowance value does not imply expensive individual images. See the [Schnell comparison](docs/providers.md#schnell-image-cost-comparison) for measured usage, pricing calculations, rounding and source links.

[Gateway spend limits](https://developers.cloudflare.com/ai-gateway/features/spend-limits/) cover requests through that gateway and matching filters, not the whole account. The dashboard's sliding “1 month” is 2,592,000 seconds (30 days), not a calendar month. Costs are estimates and concurrent requests may overshoot an eventually consistent limit. A cap therefore does not prove zero overage. [Unified Billing](https://developers.cloudflare.com/ai-gateway/features/unified-billing/) is a separate prepaid option.

Account-wide daily neurons can be read from the public GraphQL endpoint `https://api.cloudflare.com/client/v4/graphql` using Cloudflare bearer authentication. Query `viewer.accounts(filter: {accountTag: ...}).aiInferenceAdaptiveGroups(limit: 1, filter: {datetime_geq: UTC-day-start, datetime_lt: now}) { sum { totalNeurons } }` without grouping dimensions. Verified against the dashboard on 2026-09-06: both reported 172.8 neurons for a 1024×1024 four-step Schnell image. Analytics may lag; gateway list-price cost is not an invoice or proof of a charge after allowances. Current account settings and operational test references belong in [HANDOFF.md](HANDOFF.md).

## Updating gateway settings without breaking BYOK

Verified 2026-09-06 on macOS with Node 26.5.0: Cloudflare's [Update Gateway API](https://developers.cloudflare.com/api/resources/ai_gateway/methods/update/) uses PUT, not a partial patch. It requires `rate_limiting_interval`, `rate_limiting_limit`, `collect_logs`, `cache_ttl`, and `cache_invalidate_on_update`. Sending only those required fields plus a changed spend limit also reset omitted `authentication` to false. [Stored BYOK keys require authenticated gateways](https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/); disabling authentication made Google report an unregistered caller and OpenRouter report missing credentials.

For a settings change, first GET the gateway, retain its current writable fields (as listed in the update schema), change only the intended field, then PUT that full writable projection. Verify authentication and billing controls in the response and a fresh read. Configuration reads can reflect a change before inference endpoints do; rapid on/off probes are not reliable causal evidence. Keep secrets in memory and never print the complete configuration because integration fields may contain credentials.

## Spend-limit model-resolution errors and cache controls

Verified 2026-09-06 using plain Node fetch requests, independently of ai-cli/AI SDK: Google AI Studio `POST /google-ai-studio/v1beta/models/gemini-2.5-flash-lite:generateContent` and OpenRouter `POST /openrouter/v1/chat/completions` with model `google/gemini-2.5-flash-lite` returned HTTP 403/code 2040 (`Model or provider could not be resolved for spend-limit enforcement`) on an authenticated gateway with a cost rule filtered only to `workers-ai`. With `spend_limits: {enabled: false, rules: []}`, the same requests returned HTTP 200, cache MISS and `OK` after allowing 75 seconds for propagation, with `cf-aig-skip-cache: true` on both requests. Repeated requests appeared to succeed after restoring the cap, but `cf-aig-skip-cache: true` exposed the same 403/code 2040. Cached successes were not evidence that new inference worked. In the final controlled on/off/on test, cache-bypassed requests failed with the rule present, succeeded with no rules, then failed again after restoring the identical rule and allowing another 75 seconds. This establishes that the configured cap triggers the failure on these routes; it does not identify Cloudflare's internal code defect. Provider keys, request bodies and routing paths were unchanged. Disabling the flags with a shorter wait did not clear the error, so that experiment does not distinguish inactive-rule handling from propagation delay.

[Spend-limit documentation](https://developers.cloudflare.com/ai-gateway/features/spend-limits/) says budgets also apply to BYOK and provider filters select only matching requests; exhausted budgets return 429. Code 2040 is therefore a gateway model-resolution failure, not evidence of depleted provider credits or a consumed Workers AI budget. The initial failure was inconsistent with the expected isolation of unrelated providers. The internal cause and evaluation order are not verified. For causal tests use the documented [cache-bypass header](https://developers.cloudflare.com/ai-gateway/glossary/) in every request, preserve authentication, and allow configuration propagation. Do not infer recovery from repeated cached prompts. A gateway can inspect estimated third-party spend without being the company charging for inference.

Reproduce with gateway authentication enabled, no local provider keys, and the documented [Google](https://developers.cloudflare.com/ai-gateway/usage/providers/google-ai-studio/) and [OpenRouter](https://developers.cloudflare.com/ai-gateway/usage/providers/openrouter/) native endpoints. Use the same tiny prompt and model for both configurations, preserve every writable gateway setting during changes, allow propagation, capture status/error/run ID, and restore the original configuration. Do not turn off a spending control permanently as an automatic CLI workaround. Current account state and test IDs are in HANDOFF.md.
