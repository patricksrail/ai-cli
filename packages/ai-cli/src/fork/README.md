---
date_created: 2026-09-06
date_updated: 2026-09-07
summary: Where CLI behavior lives and how to follow model selection, routing and failure recovery.
---

# Fork customizations

Start here to understand or change Patrick's ai-cli behavior. The CLI is self-contained: its model choices, aliases, Cloudflare authentication and fallback logic live in this repository. It does not import bricks or require access to that private repository to install or build.

## Where to make a change

| Change                                                                              | Owning file                                                              |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Preferred models, aliases, defaults, best/cheapest/free choices and fallback order  | [model-preferences.json](model-preferences.json)                         |
| Read and validate those choices; expand aliases; produce the offline preferred feed | [model-preferences.ts](model-preferences.ts)                             |
| Provider names, paths, capabilities, billing notes and source URLs                  | [providers.ts](providers.ts)                                             |
| Fetch catalogs and interpret Google free-tier metadata                              | [catalog.ts](catalog.ts), [google-pricing.ts](google-pricing.ts)         |
| Select a default, best, cheapest or verified free model                             | [defaults.ts](defaults.ts), [selection.ts](selection.ts)                 |
| Register command flags and apply the user's selection                               | [options.ts](options.ts)                                                 |
| Choose permitted fallback routes; preserve Vercel retry behavior; explain failures  | [generation.ts](generation.ts)                                           |
| Classify errors and attempt each permitted route once                               | [fallback.ts](fallback.ts)                                               |
| Suggest similar models or the same model on another host, without inference         | [alternatives.ts](alternatives.ts)                                       |
| Browse models and run setup diagnostics                                             | [models-command.ts](models-command.ts), [diagnostics.ts](diagnostics.ts) |
| Construct SDK models; authenticate BYOK; submit/poll/download media                 | [../lib/gateway.ts](../lib/gateway.ts)                                   |
| Run jobs, save outputs and report successful routes/attempts                        | [../lib/jobs.ts](../lib/jobs.ts)                                         |

Tests sit beside the behavior they verify. `generation.test.ts` runs the CLI against simulated HTTP responses; `fallback.test.ts` tests recovery safety; `model-preferences.test.ts` tests the editable preference contract. Gateway/media tests remain beside `lib/gateway.ts`.

## Follow one request

For `ai text -m gemini-3.8-flash --fallbacks gpt-5.6-sol "hello"`:

1. `options.ts` checks the flags. `lib/models.ts` expands the preferred alias using `model-preferences.ts`.
2. `commands/text.ts` passes its parsed routing options and the `text` modality explicitly to `runJobs`. The modality controls recovery safety; the output label is only presentation.
3. `generation.ts` builds the ordered candidates and applies any explicit provider or free-only restriction. It does not recursively add the fallback model's own list.
4. `fallback.ts` runs each distinct candidate at most once. `gateway.ts` supplies the model instance and provider-specific transport for each attempt.
5. `jobs.ts` saves the result and reports the requested route, actual successful route and attempts. Diagnostics go to stderr; JSON stays on stdout.

There is no hidden async routing context. The caller passes the options that determine recovery. The existing `AI_CLI_FREE_ONLY` scope remains for the Workers AI billing guard and is restored after the command.

## Behavior to preserve

- Cloudflare AI Gateway `ai-cli` is the default. Provider credentials stay in Cloudflare under alias `default`; requests carry gateway authentication and strip provider headers/query keys.
- **Gateway** is transport; **provider** is the billing host; **creator** made the model. `openrouter/openai/gpt-5.6-sol` selects OpenRouter for an OpenAI model.
- `--provider` constrains every fallback. Explicit conflicting fallback routes fail before inference. `--free` excludes paid or unverified fallback routes.
- Cloudflare recovery owns retry attempts and disables SDK retries. Vercel retains the upstream SDK retry defaults and does not use Cloudflare fallback routes.
- Each generation attempt receives the command timeout. Cancelling stops recovery. An uncertain media submission or failed poll must not create another job; only a confirmed eligible rejection can recover.
- Workers AI remains disabled by choice. Its retained adapter in `workers-ai.ts` still enforces its billing checks if explicitly enabled in the future.

## Documentation and maintenance

[Package README](../../README.md) explains installation and commands. [Provider guide](../../../../docs/providers.md) explains transport and billing. [Handoff](../../../../HANDOFF.md) records verified account state; [Learnings](../../../../LEARNINGS.md) records reusable findings; [Upstream sync](../../../../docs/upstream-sync.md) covers merges. Keep user-facing changes reflected in the package README, website docs and changelog.

[bricks/ai](https://github.com/patricksrail/bricks/tree/main/ai) is a separate, evolving collection of reusable examples. It may lag this implementation. Consult this CLI for current routing, provider behavior and model choices; a change to either repository does not silently change the other.

From the repository root, run `bun install`, `bun run test`, `bun run typecheck`, and `bun run build`. Rebuild before testing the installed `ai`. These commands require no bricks checkout or special Git URL configuration.
