---
date_created: 2026-09-06
date_updated: 2026-09-06
summary: Purpose, ownership map, and upstream integration points for Patrick's ai-cli customizations.
---

# Fork customizations

This directory is the policy and presentation layer for Patrick's fork of `ai-cli`. Upstream owns the generation commands and Vercel behavior. The fork adds Cloudflare BYOK routing, provider discovery, model preferences, diagnostics, and the human-readable terminal output for those additions.

Start here when changing Patrick's defaults or merging upstream. Most new fork behavior lives in this directory, with tests beside it. Keep upstream integration small; a separate folder makes changes easier to find but cannot prevent merge conflicts in shared entry points.

## Product model

Keep these terms distinct in code, help, and documentation:

- **Gateway** is the control and transport layer. This fork defaults to Cloudflare; `--gateway vercel` selects the upstream path.
- **Provider** hosts the request and owns its billing or quota, such as Google, OpenRouter, Fal, or Replicate.
- **Creator** made the model. For example, `openrouter/google/gemini-...` means the Cloudflare gateway sends the request to the OpenRouter provider for a model created by Google.
- **Model preference** is this fork's saved route for a use case such as default, best, cheapest, or best free. It must include the provider when cost or eligibility depends on the route.

The command roles follow the same separation:

| Need                                                   | Command                                                        |
| ------------------------------------------------------ | -------------------------------------------------------------- |
| Generate                                               | `ai text`, `ai image`, `ai video`, `ai audio`                  |
| Choose a model                                         | `ai models`, with `--free`, `--best`, `--cheapest`, or filters |
| See model hosts and their setup                        | `ai providers`                                                 |
| See or override the routing layer                      | `ai gateways`                                                  |
| Diagnose credentials, catalogs, and optional inference | `ai doctor`                                                    |

## Fork invariants

- Cloudflare AI Gateway `ai-cli` is the default. Vercel remains an explicit override.
- Provider credentials stay in Cloudflare Provider Keys under the `default` alias. Cloudflare mode must not read, persist, or forward local provider keys.
- Curated choices use complete provider routes so billing and free-tier eligibility are unambiguous.
- Human output favors the next useful decision. Detailed metadata stays behind `--details`; complete structured data stays available through `--json`.
- Fork hooks in upstream-owned files stay small and covered by tests.

## Code ownership

| Change                                                                  | File                              |
| ----------------------------------------------------------------------- | --------------------------------- |
| Default, best, cheapest and best-free fully qualified model choices     | `model-preferences.json`          |
| Provider capabilities, authentication, billing nuances and source links | `providers.ts`                    |
| Preference loading and validation                                       | `preferences.ts`                  |
| Live provider catalogs and free-model discovery                         | `catalog.ts`, `google-pricing.ts` |
| Model selection and gateway-dependent defaults                          | `selection.ts`, `defaults.ts`     |
| Model browsing and command routing flags                                | `models-command.ts`, `options.ts` |
| Doctor, provider and gateway commands                                   | `diagnostics.ts`                  |
| Shared fork-only wrapping and terminal headings                         | `output.ts`                       |
| Suggestions after a model fails                                         | `alternatives.ts`                 |
| Disabled Workers AI adapter and billing guard                           | `workers-ai.ts`                   |

`providers.ts` is the executable source for provider names, catalog URLs, pricing URLs, authentication requirements, and short caveats. Save canonical provider URLs there when research finds them. `model-preferences.json` is the only place to edit the curated route choices. Do not copy either data set into command implementations.

## Integration outside this folder

- [`../lib/gateway.ts`](../lib/gateway.ts) contains the original Cloudflare transport, stored-key authentication and media routing. It consumes this folder's provider registry.
- [`../lib/models.ts`](../lib/models.ts) selects the backend; the command files and [`../index.ts`](../index.ts) register fork options and diagnostics.
- [`../lib/jobs.ts`](../lib/jobs.ts) announces the selected model and attaches failure suggestions.
- [`../../../../scripts/mac-ai.mjs`](../../../../scripts/mac-ai.mjs) is Patrick's local launcher. It loads Cloudflare configuration from the canonical ignored environment file.

Keep these integration points when merging upstream. Moving existing transport files solely for tidiness would create more rename conflicts without removing the need for these hooks.

## Context and verification

Each durable fact has one home:

| Information                                                                                         | Canonical home                                     |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Installation, commands, examples, and the shortest path for a user                                  | [Package README](../../README.md)                  |
| Stable routing, authentication, billing behavior, source links, and provider extension checklist    | [Provider guide](../../../../docs/providers.md)    |
| Provider and pricing catalog URLs consumed by the CLI                                               | [`providers.ts`](providers.ts)                     |
| Curated default, best, cheapest, and best-free routes                                               | [`model-preferences.json`](model-preferences.json) |
| Reusable verified behavior and implementation gotchas that required research                        | [Learnings](../../../../LEARNINGS.md)              |
| Current account configuration, authorized caps, live test results, and unresolved operational state | [Handoff](../../../../HANDOFF.md)                  |
| Merge procedure and invariants to recheck                                                           | [Upstream sync](../../../../docs/upstream-sync.md) |
| User-visible history                                                                                | [Changelog](../../../../CHANGELOG.md)              |

`.scratchpad/` contains disposable captures, generated samples, and test logs. Deleting it must not remove a fact, source URL, decision, or reproduction step needed by the next session.

## Adding or changing a provider

1. Update `providers.ts` with its canonical catalog, pricing, and API documentation URLs.
2. Implement catalog or transport behavior in the appropriate adapter without changing model preferences implicitly.
3. Update `model-preferences.json` only when the intended curated choice changed.
4. Add a stable behavioral test. Keep paid live probes explicit and record reusable results in the provider guide or Learnings.
5. Update the package README, website docs, and changelog for user-visible behavior.

## Possible shared `ai` workspace

Patrick may later create a broader `ai` workspace for "how to call AI" across applications: shared authentication guidance, provider samples, and perhaps a reusable agent skill. That has not been implemented here. When it is, keep CLI commands, terminal presentation, and upstream integration in this repository; extract provider-neutral examples and authentication knowledge to one imported or generated source instead of maintaining copied guidance in several projects.

From the repository root, run `bun test packages/ai-cli/src`, `bun run typecheck`, and `bun run --cwd packages/ai-cli build`. Rebuild before testing the installed `ai`. Live generation may spend provider credits; Workers AI is disabled by choice; its retained guard verifies free-plan eligibility or the authorized gateway cap. See the provider guide before revisiting it.
