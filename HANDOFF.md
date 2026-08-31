---
date_created: 2026-08-30
date_updated: 2026-08-30
summary: Verified Cloudflare BYOK account state, provider tests, costs, limitations, and maintenance notes for the ai-cli fork.
related:
  - CLAUDE.md
  - docs/upstream-sync.md
  - LEARNINGS.md
  - https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/
---

# Cloudflare BYOK Fork Handoff

## Outcome

This repository is a GitHub fork of `vercel-labs/ai-cli` at `patricksrail/ai-cli`. `origin` points to Patrick's fork and `upstream` points to Vercel Labs. Before this default-and-documentation batch, `main` was at `babf4fb`, two commits ahead of upstream `4300c94`; the Cloudflare-default feature baseline ends at `79bdc31`, three commits ahead of that upstream commit. The fork preserves the upstream command layer and makes Cloudflare AI Gateway the default backend; Vercel remains available with `AI_CLI_GATEWAY=vercel`. Follow `docs/upstream-sync.md` for future source updates.

The CLI was tested as a built command-line application, not only through unit tests. Live acceptance commands explicitly unset all known provider credential environment variables and supplied only Cloudflare account/gateway authentication.

The installed local command is `/Users/patricksrail/.local/bin/ai`, linked through Bun to this checkout's `packages/ai-cli/dist/index.js`. A final no-override smoke test left `AI_CLI_GATEWAY`, `CLOUDFLARE_AI_GATEWAY_ID`, all model overrides and all provider keys unset; `ai text` selected `openrouter/google/gemini-2.5-flash-lite` and returned exactly `DEFAULT_OK`.

## Cloudflare Account State

- Authenticated gateway: `ai-cli`; logging is enabled and the existing Secrets Store is attached.
- The account's original `default` gateway was left unchanged.
- Provider Keys with alias `default`: `openrouter`, `replicate`, `google-ai-studio`, `openai`, and `fal`.
- Secret names follow Cloudflare's required API-created convention: `ai-cli_{provider}_default`.
- The client sends `cf-aig-authorization`; provider authorization and `x-goog-api-key` are stripped before gateway requests.
- Credential precedence is provider key on request, then stored BYOK key, then Cloudflare Unified Billing. Because the CLI removes provider credentials and each provider has a stored `default` key, these requests use BYOK rather than Unified Billing.

Do not put provider keys in the repository or CLI environment. On Patrick's Mac, source `/Users/patricksrail/Code/specialagent/.env.local` for the Cloudflare account ID and token. Prefer `CLOUDFLARE_AI_GATEWAY_TOKEN`; the existing `CLOUDFLARE_API_TOKEN` works as a fallback.

## Gemini and OpenRouter Clarification

The current Cloudflare-stored Google key is accepted; it is not expired. On 2026-08-30, both commands returned exactly `OK` with every local provider key unset:

```bash
ai text -m "google/gemini-2.5-flash-lite" "Reply only: OK"
ai text -m "openrouter/google/gemini-2.5-flash-lite" "Reply only: OK"
```

These are different provider paths. `google/...` uses the Google AI Studio BYOK key stored in Cloudflare. `openrouter/google/...` uses the stored OpenRouter key, then OpenRouter serves the Gemini model. The Google AI Studio key was observed on a free-tier project; OpenRouter, Replicate, and Fal use their own provider balances and are not implicitly free.

An earlier Google model-discovery request used query-string authentication, placing that Google key in Cloudflare request metadata. Google rejected two replacement-key creation attempts as suspicious, so rotation is still unverified and should be completed manually. Do not delete the working key until a replacement is created and installed in the Cloudflare `google-ai-studio` Provider Key.

## Live Acceptance Matrix

| Provider         | Verified through Cloudflare BYOK                                                    | Account limitation                                                |
| ---------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| OpenRouter       | Text, vision, text-to-image, image-to-image, text-to-video, image-to-video          | None during tests                                                 |
| Fal              | Text-to-image, image-to-image, speech, transcription, text-to-video, image-to-video | None during tests                                                 |
| Replicate        | Text-to-image, image-to-image, text-to-video, image-to-video                        | None after compatibility fixes                                    |
| Google AI Studio | Text, vision, speech, transcription                                                 | Image and Veo video reached Google but returned quota-zero errors |
| OpenAI           | BYOK selection and upstream account access                                          | Inference returned the provider account's zero-credit error       |

Evidence-safe model examples include:

- `google/gemini-2.5-flash-lite`
- `openrouter/google/gemini-2.5-flash-lite`
- `replicate/black-forest-labs/flux-2-pro`
- `replicate/prunaai/p-video`
- `fal/fal-ai/flux/schnell`
- `fal/fal-ai/wan/v2.2-5b/image-to-video`
- `fal-ai/minimax/h3-max` (official Fal queue client; text/image endpoint selected from input)
- `fal/fal-ai/minimax/speech-02-turbo`
- `fal/fal-ai/wizper`

Generated images and videos were checked for real MIME type, dimensions, duration and codecs; representative frames were visually inspected. The H3 Max CLI acceptance output was a 7,232,157-byte MP4 with 5.184 seconds of 1344x768 H.264 video at 24 fps and AAC audio. The OpenRouter image provider returned JPEG bytes for one requested `.png` output, which is provider behavior rather than a routing failure.

Video-file understanding is not implemented: `ai text` accepts still-image references but not video input. Text/image/video generation, still-image vision, image-to-image, image-to-video, speech and transcription were tested; video understanding was not.

## Provider-Specific Fixes

- Fal absolute `fal.run` and queue URLs are rewritten through Cloudflare `/fal` with `x-fal-target-url`; CDN downloads remain direct and uncredentialed.
- Fal publisher video endpoints outside the `fal-ai/` namespace use Fal's official queue client through Cloudflare's SDK proxy. `fal-ai/minimax/h3-max` selects text-to-video or image-to-video from the CLI input and handles polling internally.
- Fal transcription defaults `chunkLevel` to `segment`, matching the live endpoint while honoring explicit caller options.
- Replicate asynchronous predictions poll through Cloudflare. Flux 2 numbered reference fields are rewritten to the current `input_images` array.
- Google Veo and OpenRouter final video-content URLs are mapped back through their Cloudflare provider routes, and the Cloudflare token is removed before CDN redirects.
- Vercel behavior remains available explicitly and model discovery still uses Vercel's public catalog.
- Text, video, and audio defaults and full provider IDs skip public catalog discovery; short aliases and image model classification still fetch it.
- Structured provider errors surface `detail` and validation fields, and `undici` is a direct runtime dependency for the AI SDK's safe bundled video downloader.

## Costs and Balances

- Replicate received the user-approved $10 prepaid credit; auto-reload was not enabled.
- OpenRouter needed no top-up. The full media run used about $0.18 and left ample existing balance.
- Fal already had about $19.68, so no Fal purchase was made.
- Google direct text can use the AI Studio project's available free-tier quota; Google image/video quota was zero during testing.
- OpenAI had no usable inference credit. No OpenAI or Google billing change was authorized.

## Verification Baseline

The Cloudflare-default fork passed 213 CLI tests with 537 assertions and 20 web tests, plus typecheck, build, format, lint, MDX serialization and diff checks. Re-run all checks after gateway or documentation changes:

```bash
bun run typecheck
bun run test
bun run build
bun run format:check
bun run lint
git diff --check
```

The core implementation and regression tests are `packages/ai-cli/src/lib/gateway.ts` and `packages/ai-cli/src/lib/gateway.test.ts`. `LEARNINGS.md` records researched SDK and provider edge cases.
