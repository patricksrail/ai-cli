---
date_created: 2026-09-06
date_updated: 2026-09-07
summary: Central provider architecture, billing distinctions, and extension checklist for this fork.
related:
  - ../packages/ai-cli/src/fork/providers.ts
  - https://github.com/patricksrail/ai-cli/blob/main/packages/ai-cli/src/fork/model-preferences.json
  - ../LEARNINGS.md
---

# Providers and routing

The executable registry is [`src/fork/providers.ts`](../packages/ai-cli/src/fork/providers.ts). It owns provider IDs, supported CLI modalities, native base paths, credential type, free-discovery support, nuances, and source links. `ai providers --all` prints a compact overview without needing credentials. Add `--details` for authentication, billing notes, full catalog and pricing links and sources; `--json` retains the complete metadata. Use `ai providers` for the configured BYOK inventory and `ai doctor --provider <name>` to check access. A supported provider is not necessarily authenticated or funded.

The editable model choices live separately in [CLI model preferences](https://github.com/patricksrail/ai-cli/blob/main/packages/ai-cli/src/fork/model-preferences.json): defaults, best, cheapest, and ordered bestFree lists. These contain full provider routes. Adding a provider must not silently change those preferences.

## Gateway, provider, and model

Cloudflare AI Gateway is the routing, logging, and control layer. The provider runs the model and determines the billing account. The creator authored the model. A route such as `openrouter/openai/gpt-5.6-luna` means OpenRouter hosts/routes OpenAI's model through our default Cloudflare gateway; `openai/gpt-5.6-luna` uses the direct OpenAI account. Neither prefix selects a different gateway. The upstream-compatible Vercel gateway remains an explicit override.

For `workers-ai/@cf/black-forest-labs/flux-1-schnell`, Cloudflare Workers AI runs FLUX.1 Schnell, the same named model available through Fal. Cloudflare AI Gateway still supplies logging/control. This does not make Gemini, Luna, or arbitrary OpenRouter models free: the Workers AI host must actually offer the model.

## Cloudflare capability versus this CLI

Checked the latest relevant Cloudflare blog announcement on 2026-09-06: [Unifying Workers AI and AI Gateway into a single AI control plane](https://blog.cloudflare.com/workers-ai-gateway-unification/) is dated August 7, 2026. The integration really does call Workers AI through AI Gateway using the shared `/ai/` REST API and `cf-aig-gateway-id`. Keep `--gateway cloudflare`; choose `--provider workers-ai`. No second gateway or deployed Worker is required.

Cloudflare's [Workers AI catalog](https://developers.cloudflare.com/workers-ai/models/) currently lists 86 entries, including text, images, audio, embeddings and some deprecated models. That is provider capability, not 86 models verified for this account or implemented by this CLI. This fork currently adapts only FLUX.1 Schnell for Workers AI. Other providers keep their existing catalogs. External Gemini/OpenAI/OpenRouter models reachable through the unified API do not thereby inherit Workers AI's free allocation.

Both Workers Free and Workers Paid get 10,000 shared neurons per day under standard Workers AI billing. This measures compute, not a fixed number of requests or tokens. Quota resets at 00:00 UTC. Workers Free stops at quota; Workers Paid can continue with billed overage. Some frontier models require a paid billing method. Prepaid AI Gateway billing is optional and is not enabled here. The retained adapter's strict `--free` check requires a verifiable Free plan; ordinary mode also accepts a verified spending cap. These are CLI safeguards, not Cloudflare requirements for receiving the allowance on Paid plans.

## Workers AI: disabled by choice

**Decision, 2026-09-06:** Patrick chose to leave this integration OFF because the daily free allowance was too small to justify it. The central registry sets `enabled: false`; the CLI rejects Workers AI generation and catalog requests before inference. It is excluded from automatic free discovery. The tested adapter and research remain as reference, and the independently useful Wrangler token fix remains in place.

**Verified allowance:** [Cloudflare pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) grants 10,000 neurons daily and prices paid overage at $0.011 per 1,000. Thus `10,000 / 1,000 × $0.011 = $0.11` of daily usage value. This is not transferable cash credit. At the measured 172.8 neurons per 1024×1024 four-step Flux image, a fresh allowance covers 57 whole images if no other account usage consumes it. The dollar amount is small; calling each image expensive would be a separate judgment, not a pricing fact.

The following describes the tested implementation retained for reference; it is disabled in the installed CLI.

Cloudflare hosts FLUX.1 Schnell; the existing gateway provides logging and spending controls. No deployed Worker or prepaid credits are needed. This adapter supports text-to-image with four steps and native resolution; arbitrary size and reference images are not supported.

```sh
ai providers --all --details
ai doctor --provider workers-ai
ai models --provider workers-ai
ai image --provider workers-ai -m @cf/black-forest-labs/flux-1-schnell "a blue sailboat"
```

Current account configuration, the authorized cap, token name and live test references are recorded in [HANDOFF.md](../HANDOFF.md#workers-ai-decision-2026-09-06). Reusable authentication and usage-query guidance is in [LEARNINGS.md](../LEARNINGS.md#workers-ai-authentication-and-gateway-routing).

Ordinary Workers AI generation verifies a provider-wide cap of at most `monthlyBudgetUsd` in `src/fork/providers.ts` over at least 30 days, or verifies a Workers Free plan, before inference. Disabled rules, larger or shorter budgets, rules for another provider, and model/metadata-filtered rules cannot satisfy the cap check. Unified/prepaid billing is refused. The adapter only reads settings; it never changes the plan, budget or credits itself.

`--free` remains strict and never treats a capped paid route as free. A Workers Free plan must be verified through subscription reads; unknown or inaccessible subscription state is refused. This account has Workers Paid and therefore does not advertise this image route as free. Existing Fal defaults remain unchanged.

Cloudflare model-resolution error 2040 is distinct from an exhausted budget. An affected gateway rejected uncached Google/OpenRouter inference despite a Workers AI-only filter; see the [reproduction and limits of the diagnosis](../LEARNINGS.md#spend-limit-model-resolution-errors-and-cache-controls). Cached successes do not establish recovery.

Gateway management changes must preserve authentication and other writable settings; see [safe gateway updates](../LEARNINGS.md#updating-gateway-settings-without-breaking-byok).

## Canonical sources

The provider registry owns `catalogUrl`, `pricingUrl`, and supplementary `sources` for every provider. Read those saved URLs directly when refreshing information; search only when a source moves or does not answer the question. `ai providers --all --details` displays them and `--json` exposes the fields. Prices remain time-sensitive, so saved URLs avoid rediscovery, not verification. Fal and Replicate endpoint pages provide model-specific units and minimums beyond their general pricing pages.

## Schnell image cost comparison

Checked 2026-09-06, for one 1024×1024 FLUX.1 Schnell image with four inference steps:

| Host | Approximate cost per image | Cost for 1,000 images before free allowances |
| --- | ---: | ---: |
| Cloudflare Workers AI | $0.0019008 (0.19 cents) | $1.90 |
| Fal | $0.003 (0.30 cents) | $3.00 |

Cloudflare's live usage measurement was 172.8 neurons. Its [pricing table](https://developers.cloudflare.com/workers-ai/platform/pricing/) converts that to `172.8 / 1,000 × $0.011 = $0.0019008`; the gateway independently reported the same estimated cost. The listed tile/step units are consistent with `4 × (4.8 + 4 × 9.6)` for this output. This verifies one size and step count, not every possible setting. The [Cloudflare model page](https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/) is the model-specific reference.

[Fal's Schnell model card](https://fal.ai/models/fal-ai/flux/schnell) lists $0.003 per megapixel, rounded upward. Its [documented marketplace billing convention](https://fal.ai/docs/documentation/serverless/publishing-to-marketplace) uses `ceil(width × height / (1024 × 1024))`; the table assumes that convention for a 1024-square image. This is a published-price estimate, not a verified Fal invoice for a matching request. The same billing guide identifies `X-Fal-Billable-Units` as the response field for metered units. Smaller outputs need not be cheaper when rounded to a whole unit.

At these rates Cloudflare is about 37% cheaper, saving approximately $1.10 per 1,000 images before allowances. Both are fractions of a cent per image. Within Cloudflare's unused daily allowance the net inference cost is zero; 10,000 neurons cover 57 whole images of the measured size, shared with other account usage. This is a price comparison, not a quality or reliability comparison between hosts. The CLI route remains disabled by choice.

Durable calculations, sources and reproduction guidance live in these repository docs. `.scratchpad` contains disposable probe scripts, raw captures, logs and sample images; deleting it does not remove these findings.

## Extending a provider

1. Add or update the registry entry and its official sources. Register only modalities the adapter implements; creator prefixes are not provider aliases.
2. Implement provider-specific discovery/auth in a fork module. BYOK providers use stored default keys through the existing gateway adapter; account-native Workers AI uses its documented Cloudflare auth. Never import local third-party keys in Cloudflare mode.
3. Preserve the native model ID after stripping the host prefix once. Add generation and image-byte tests that exercise the actual SDK adapter, including error and billing refusal paths.
4. Establish cost eligibility for the exact host and model. A free suffix, open weights, playground promotion, or zero text-token price does not prove free image generation. Preserve unit pricing and rounding; distinguish daily allowances from zero-price inference.
5. Run a small authorized live probe before promoting the model into defaults or bestFree. Verify actual output, modality, and gateway routing. Record limitations in the registry and reusable findings in LEARNINGS.md.
6. Update relevant help, package/web docs, and CHANGELOG.md. Keep upstream command hooks small; the registry and fork adapters own provider policy.

Human output uses bold provider names, terminal colors and grouped command examples. Capability lists are under `ai providers --details`; JSON retains them. Piped output is plain text; set `NO_COLOR=1` to disable terminal styling.
