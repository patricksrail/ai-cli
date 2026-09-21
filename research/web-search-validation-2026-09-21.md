---
date_created: 2026-09-21
date_updated: 2026-09-21
summary: Live provider search checks for ai-cli and bricks, including failed media checks and successful controls.
related:
  - ../packages/ai-cli/src/fork/web-search.ts
  - https://github.com/patricksrail/bricks/blob/main/ai/src/web-search.ts
---

# Web search validation

All calls used the authenticated Cloudflare gateway and stored BYOK provider credentials. CLI calls disabled fallback so a successful response could not conceal a failing host. Bricks used its public text API and imported image recipes. No saved model preferences or gateway settings changed.

## Independent reference

The test asked what AI safety mechanism the US proposed to China in the Associated Press report published September 21. Expected answer: an AI incident notification mechanism covering incidents with national-security implications. This was researched independently before model calls; the answer and article URL were not supplied in the prompt. [AP syndication](https://www.actionnewsjax.com/news/business/bessent-us-proposes/LK67YIR4PQYOJHSERZOLUXP6XM/?outputType=amp), [Reuters reporting](https://www.thejakartapost.com/business/2026/09/21/bessent-proposes-us-china-ai-safety-notifications-in-talks-with-chinese-vice-premier).

Prompt: “Today is September 21, 2026. Search the web for the Associated Press report published today about Scott Bessent and US-China talks. What new AI safety mechanism did the US propose, and what kind of incidents would it cover? Give a short factual answer and cite the source URL. Do not guess if you cannot find it.”

## Results

| Provider / model | ai-cli | bricks | Evidence |
| --- | --- | --- | --- |
| Google / Gemini 3.8 Flash | Quota error | Quota error | HTTP 429; saved default unchanged. |
| Google / Gemini 2.5 Flash Lite | Pass | Pass | Correct answer with SDK source URLs; bricks also returned grounding queries and chunks. |
| OpenAI / GPT-5.6 Sol | Pass | Pass | Correct answer with AP citation; bricks returned two hosted tool calls and a source. |
| OpenRouter / OpenAI GPT-5.6 Sol | Pass | Pass | Correct answer with a source annotation from the hosted search path. OpenRouter does not expose the same tool-call trace as direct OpenAI. |
| Fal / Nano Banana 2 | Failed news generation | Failed news generation | HTTP 422 `no_media_generated`; response echoed `enable_web_search: true`. |
| Replicate / Nano Banana 2 | Failed news generation | Failed news generation | Failed prediction, sensitivity error E005; recorded input includes `google_search: true`. SDK recipe reports an invalid response because the failed prediction has null output. |
| Fal / Nano Banana Pro | Failed sports-news generation | Failed sports-news generation | HTTP 422 `no_media_generated`, with documented search enabled. |

Media was tested first with a news card about the same AP report, then with a sports infographic asking for current Ole Miss and LSU AP Top 25 rankings. The sports check expected Ole Miss 4 and LSU 10, independently checked in [September 21 reporting](https://sports.yahoo.com/articles/ap-top-25-college-football-040623156.html). Neither news prompt generated an image. No media news test passed, and a schema-valid flag is not evidence of successful grounding.

Matched sailboat control calls through the bricks recipes generated images on both Fal and Replicate with search disabled and with search enabled. They establish that the media routes work with either setting; the failed news prompts do not establish a general search-option failure. Media news grounding remains unverified. A paid provider job may perform its own internal retries even though the client sends only one submission.

## Reproduction and deterministic checks

- CLI: `ai text -m <route> --no-fallback --json --timeout 180 "<prompt>"`; inspect the saved text, `sources`, successful `model` and `attempts`.
- Bricks: `createAI().text({ model: route, fallbacks: false, prompt })`; inspect `value.text`, `value.sources`, `value.toolCalls` and `value.providerMetadata`.
- Media: use `ai image` or the Fal/Replicate recipes with the same prompt. Explicit opt-out is `--no-web-search` / `webSearch: false`.
- The CLI subprocess tests exercise real option parsing, real provider SDK serialization, provider changes on fallback, and explicit opt-out. Bricks tests cover its public text API, streaming/structured SDK options, image recipes, curl reference inputs, auth boundaries and disabled search.

Local raw results and test harnesses are in ignored `.scratchpad/web-search-2026-09-21/`. They include provider error bodies and generated control images. No credential values were saved. The committed report is the portable record; the scratch directory is not required to build or test either project.

## Automated results

315 CLI tests, 20 website tests and 18 bricks tests pass. Typechecks and CLI/bricks builds pass. CLI lint has the same 25 pre-existing warnings and no errors. Website tests must run from `apps/web` (or via its package script); running them from the monorepo root caused two document-path lookup failures, resolved by using the package working directory without changing code.

## Integration notes

The official AI SDK adapters already expose provider search tools. They must be passed on each `generateText`/`streamText` request. The SDK model constructor alone cannot supply the tool registry used to parse tool results, so bricks adds explicit `generationOptions()` instead of hiding tool injection inside a model wrapper. Raw `model()` remains available.

OpenRouter's server-tool API replaces its deprecated web plugin. The installed SDK sends option arguments at the top level while current native examples nest them under `parameters`; using the tool with no arguments selects the documented `auto` default and avoids relying on that discrepancy. Sources: [OpenRouter server tools](https://openrouter.ai/docs/guides/features/server-tools/web-search), [AI SDK search tools](https://ai-sdk.dev/cookbook/node/web-search-agent), [OpenAI search](https://developers.openai.com/api/docs/guides/tools-web-search), [Google grounding](https://ai.google.dev/gemini-api/docs/google-search).

Fal fields are documented at [Nano Banana 2](https://fal.ai/models/fal-ai/nano-banana-2/api), [its edit endpoint](https://fal.ai/models/fal-ai/nano-banana-2/edit/api), and [Nano Banana Pro](https://fal.ai/models/fal-ai/nano-banana-pro/api). Replicate's field is documented in [its Nano Banana 2 schema](https://replicate.com/google/nano-banana-2/api/schema).
