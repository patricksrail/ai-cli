---
date_created: 2026-08-30
date_updated: 2026-08-30
summary: Preserved GPT-5.6 Pro architecture counsel for live OpenAI and Gemini sessions through Cloudflare AI Gateway.
related:
  - "../backlog/tasks/task-1 - Design-implement-and-test-live-model-sessions.md"
  - ../HANDOFF.md
  - https://chatgpt.com/c/6a950b86-8164-83e9-89c0-b18cfa75525e
---

# GPT-5.6 Pro architecture counsel: live/realtime capability

This is non-authoritative counsel retained for TASK-1. The report below is preserved verbatim except for three trailing-space Markdown hard breaks normalized to `<br>`.

## Provenance

- Conversation: https://chatgpt.com/c/6a950b86-8164-83e9-89c0-b18cfa75525e
- Verified model: `gpt-5-6-pro`
- Reviewed source tree: `b67c88fdbe142440d7ed8e13d052389e8731ce79`
- Synthetic work-kit commit reported inside Pro: `70055bf4f25ad1afead613364006efba4f41c42d`
- Result ZIP SHA-256: `9c5202249be0eda9c53e71431fce15b5295728e4044b014faed9e603d7bf8bc3`
- Source report SHA-256: `5b3c15fa5a3f875f1288f5eda902eef94f279c7f2b3529be4de14b209b94dcc0`

## Preserved report

# Upstream-Friendly Live/Realtime Capability for the ai-cli Cloudflare BYOK Fork

**Architecture and implementation counsel**<br>
**As of:** 2026-08-30, America/Los_Angeles<br>
**Repository source:** supplied Git bundle, checked out at `70055bf4f25ad1afead613364006efba4f41c42d` (`refs/heads/pstack-work-base`)<br>
**Deliverable type:** counsel and staged specification, not an implementation

## Executive decision

Implement a new, explicitly experimental top-level command, **`ai live`**, as a provider-native, stateful session facility that is separate from the existing finite text/image/video/audio generation paths.

The first supported live transports should be:

1. **OpenAI Realtime through Cloudflare AI Gateway's `/openai` realtime WebSocket route**, using only Cloudflare gateway authentication in the client and the OpenAI key stored in Cloudflare BYOK.
2. **Google Gemini Live through Cloudflare AI Gateway's `/google` realtime WebSocket route**, using only Cloudflare gateway authentication in the client and the Google AI Studio key stored in Cloudflare BYOK—but only after an empirical protocol spike proves that the route really performs keyless client-side BYOK injection. Cloudflare's general realtime page says BYOK is supported, but its current Google example still includes `api_key` in the WebSocket URL. That discrepancy is a release-blocking proof gap, especially because this repository already records a prior Google query-string credential leak.
3. **No OpenRouter full-duplex live transport in v1.** As of this review, OpenRouter's first-party documentation describes HTTP response streaming using Server-Sent Events and finite speech-to-text requests, not a provider-native, bidirectional realtime voice WebSocket. `ai live -m openrouter/...` should therefore fail locally, before opening a socket or spending provider credit, and direct users to the existing finite OpenRouter text path. Do not silently emulate “live” by chaining STT, chat, and TTS.

The packaging decision is deliberately mixed rather than “package everything” versus “preflight everything”:

- **Package the JavaScript transport.** The package already exact-pins `undici@7.29.0`, and that version's Node WebSocket client accepts custom handshake headers. Use it first. Do not add `ws` unless a Stage 0 spike proves that Undici cannot provide required Cloudflare interoperability or actionable failed-upgrade diagnostics.
- **Do not add native microphone or speaker packages and do not ship static FFmpeg binaries.** Keep the npm artifact native-dependency-free. Put microphone capture and low-latency playback behind a capability-based, no-network runtime preflight that runs before any billable WebSocket is opened. A headless text-in/audio-file-out mode must remain fully self-contained and should be the automated live-smoke mode.

Keep the fork boundary narrow:

- Put almost all new code under `packages/ai-cli/src/lib/live/` plus one `packages/ai-cli/src/commands/live.ts` entry point.
- Reuse the existing exported Cloudflare backend/configuration resolvers from `src/lib/gateway.ts`; do not route live sessions through the finite-generation SDK/provider factories.
- Do not modify `src/lib/models.ts`, current media commands, or `src/lib/progress.ts` for v1.
- The only required existing-code integration should be the `src/index.ts` import and command registration, plus package/docs/test references. If Undici passes the transport spike, no dependency or lockfile edit is required.

The implementation should share lifecycle, cancellation, terminal, and PCM plumbing while preserving **provider-native wire schemas** in thin OpenAI and Google adapters. A “universal realtime event protocol” inside the code would be the wrong abstraction: normalize only what the session controller actually owns and retain native provider semantics for configuration, audio framing, turn completion, interruption, usage, go-away, and error events.

## Decision table

| Question | Recommendation | Confidence | Release gate |
| --- | --- | ---: | --- |
| Product surface | New top-level `ai live [prompt]` command | High | Normal CLI/help tests |
| OpenAI route | Provider-native Realtime over Cloudflare `/openai?model=...` | High on documented route; medium on current header/model details | One BYOK-only protocol spike and one bounded smoke |
| Google route | Provider-native Live API over Cloudflare `/google` | Medium | Must prove no `api_key`/provider credential is needed anywhere in the client request |
| OpenRouter | Keep finite HTTP/SSE use; reject under `ai live` | High, date-bounded to official docs reviewed | Deterministic pre-spend rejection test |
| WebSocket package | Use existing exact-pinned `undici@7.29.0` first | High for custom headers; medium for diagnostics | Failed-upgrade and close/error spike |
| Microphone/speaker | External FFmpeg/ffplay-style capability with automatic preflight | High architectural confidence; OS recipes need proof | Supported-OS device matrix |
| Model selection | Require explicit `openai/<id>` or `google/<id>`; no aliases/default/fallback | High | Parser tests and docs |
| Provider abstraction | Shared session state machine, native wire adapters | High | Fixture tests for both protocols |
| Retry/resume | No automatic retry, reconnect, failover, or session resumption in v1 | High | State-machine tests |
| Release status | Experimental/preview until both provider routes pass real Cloudflare smoke | High | Staged acceptance below |

## 1. Scope and terminology

### 1.1 What “direct” should mean here

“Direct OpenAI Realtime” and “Google Gemini Live through Cloudflare” can sound contradictory. The intended meaning should be stated explicitly:

> The CLI speaks each provider's native realtime protocol through that provider's dedicated Cloudflare AI Gateway WebSocket route. It does not use OpenRouter, a provider-agnostic response schema, or an STT/chat/TTS emulation pipeline. It also does not bypass Cloudflare.

That distinction matters because this repository already has two ways to reach some underlying models: `google/...` selects the Google AI Studio key stored in Cloudflare, while `openrouter/google/...` selects the OpenRouter key stored in Cloudflare. `HANDOFF.md:35-44` documents that both finite text routes worked on 2026-08-30 and that they are materially different provider paths.

### 1.2 What qualifies as `live`

For this capability, `live` should mean all of the following:

- one stateful WebSocket session;
- incremental microphone or typed input;
- incremental model audio output;
- turn lifecycle events rather than one finite response;
- user interruption/barge-in;
- explicit cancellation and graceful close;
- bounded buffering and backpressure;
- provider-native usage and error reporting.

HTTP chunking or SSE alone is streaming, but it is not this product's full-duplex live-session contract. Cloudflare itself separates its realtime provider-native WebSocket API from its non-realtime WebSocket API. That taxonomy should inform the CLI rather than be blurred by a broad use of the word “streaming.”

### 1.3 V1 non-goals

Do not include these in the first release:

- OpenRouter STT/chat/TTS emulation;
- Vercel gateway support for `ai live`;
- automatic model fallback or multi-model fan-out;
- public-catalog model discovery or short-name expansion;
- WebRTC, browser clients, SIP, or remote media relays;
- camera/video input;
- provider tools, search, function calls, or MCP;
- session resumption or transparent reconnect;
- cross-provider continuation;
- recording by default;
- a generalized public realtime library API.

These are all plausible later projects, but each expands the protocol, safety, cost, or upstream-conflict surface before the two foundational BYOK routes are proven.

## 2. Repository findings that constrain the design

### 2.1 Repository authority and verification

The supplied bundle verified as a complete bundle for its advertised `pstack-work-base` ref and checked out cleanly at `70055bf4f25ad1afead613364006efba4f41c42d`. `git fsck --full --no-reflogs` reported no object corruption. The work kit exposes a synthetic current-tree commit rather than useful upstream/fork history, so the code and repository documentation are sufficient for architectural analysis, but empirical conflict-frequency claims are not possible.

The environment used for this report had Node.js `v22.16.0` and npm `10.9.2`; Bun was unavailable. No repository source was changed. Consequently, the repository's required Bun typecheck/test/build/package commands could not be run here. No Cloudflare credentials were available, so no paid or authenticated WebSocket was opened.

### 2.2 Product invariants

`CLAUDE.md:16-21` establishes the binding fork model:

- Cloudflare AI Gateway is the default; Vercel is opt-in.
- Provider keys live in Cloudflare under the `default` alias.
- The CLI must not read, persist, or forward local provider keys in Cloudflare mode.
- Fork routing policy is intentionally concentrated so upstream merges remain small.

`HANDOFF.md:24-31` records the current account configuration and the finite request credential boundary: the client sends `cf-aig-authorization`, while provider authorization and `x-goog-api-key` are stripped. It also records logging as enabled and Provider Keys for OpenRouter, Replicate, Google AI Studio, OpenAI, and Fal.

`docs/upstream-sync.md:49-58` makes the same invariants merge policy, while `docs/upstream-sync.md:75-88` requires narrow diffs plus the full Bun validation suite. The new feature should update that runbook to name `src/lib/live/` as the second intentional fork seam, not spread realtime decisions through existing upstream-oriented command and media files.

### 2.3 Current package and runtime shape

`packages/ai-cli/package.json:11-20` declares Node 22+, a single built `dist/index.js` executable, and a package containing only `dist` and the package README. `package.json:34-54` builds a bundled Node target with Bun and already includes exact-pinned `undici@7.29.0` as a runtime dependency.

That has three consequences:

1. A live client must work in the built Node executable, not only under Bun.
2. A JavaScript WebSocket implementation can and should be part of the published artifact.
3. Native audio addons would materially change the install and platform-risk profile; they should not be introduced casually.

The first-party Undici 7.29 documentation says its Node-only `WebSocketInit` accepts custom handshake headers. That satisfies Cloudflare's basic non-browser authentication requirement on paper. The unresolved question is not header support; it is whether failed upgrades expose enough HTTP status/body/header information to give actionable provider and gateway errors.

### 2.4 Existing command layer

`packages/ai-cli/src/index.ts:3-25` statically imports and registers five top-level command groups. Adding `live` should require one import and one registration call.

The custom command parser supports one positional argument, nested commands, options, negated options, and asynchronous actions (`src/lib/command.ts`). Therefore `ai live [prompt]` fits the current parser without introducing Commander or another dependency.

The current progress subsystem installs module-global signal handlers and calls `process.exit(130)` immediately on a signal (`src/lib/progress.ts:4-18`). That is appropriate for finite progress rendering but wrong for a live session that must stop capture, cancel or truncate model output, close child processes, finalize a WAV header, close the socket, restore terminal state, and remove signal handlers. `ai live` needs its own scoped signal controller rather than extending or reusing `Progress`.

### 2.5 Existing model semantics are unsuitable for live

`src/lib/models.ts:230-264` supports defaults, comma-separated multi-model input, public-catalog short-name discovery, and alias expansion. `src/lib/gateway.ts:160-171` also routes unprefixed language model IDs to OpenRouter.

Those behaviors are useful for finite generation but unsafe and confusing for a billable stateful session:

- a default can silently change provider and price;
- a short alias can require public discovery and resolve differently over time;
- a comma implies parallel or fallback behavior that has no clear live-session meaning;
- an unprefixed model currently falls through to OpenRouter, which is not a supported live transport;
- realtime models and event schemas are preview-heavy and change faster than the finite catalog contract.

`ai live` should therefore have a small, local model parser and bypass `resolveCommandModels`, `routeCloudflareModel`, and the finite Vercel AI SDK provider instances.

### 2.6 Existing audio preview code is not a realtime media layer

`src/lib/audio-preview.ts` discovers decoders and finished-file players, launches them with file paths, and renders a completed WAV waveform. It is not designed for continuous microphone capture, raw PCM playback from stdin, backpressure, interruption, or output-queue truncation.

A new live media module can reuse lessons from that file—capability probing, child-process error handling, and terminal restoration—but should not modify it in v1. Reusing it by force would couple an upstream finite-file feature to fork-specific stateful media and create a larger conflict surface.

### 2.7 Current verification baseline and account constraints

`HANDOFF.md:91-104` records a healthy baseline before this task: 213 CLI tests with 537 assertions, 20 web tests, typecheck, build, formatting, lint, MDX serialization, and diff checks.

It also records two material live-test constraints:

- The OpenAI stored key reaches the provider account, but the account had no usable inference credit and no billing change was authorized (`HANDOFF.md:48-54`, `83-89`).
- An earlier Google discovery request placed a Google key in query metadata; rotation remained unverified (`HANDOFF.md:44`).

The implementation agent must not treat a route-level connection error as a software defect until the account state is separated from protocol correctness, and must not place a Google key in a URL even temporarily to “get the smoke test working.”

## 3. Current first-party capability assessment

### 3.1 Cloudflare AI Gateway

Cloudflare's [Realtime WebSockets API](https://developers.cloudflare.com/ai-gateway/usage/websockets-api/realtime-api/) currently lists OpenAI and Google AI Studio among supported realtime providers. For non-browser clients it supports authentication through headers. The same page says provider keys can be configured with Cloudflare [BYOK](https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/) and that `cf-aig-authorization` is still required.

The documented provider routes are:

```text
wss://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/openai?model={openai_model}
wss://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/google
```

Two documentation inconsistencies must be treated as evidence gaps, not implementation instructions:

- The OpenAI example still uses an older preview model and an `OpenAI-Beta: realtime=v1` header, while current OpenAI documentation has newer Realtime models and evolved session schemas.
- The Google example includes `api_key` in the query string despite the page's general BYOK statement. It does not show the exact Google WebSocket request with only Cloudflare authentication and a stored provider key.

Cloudflare's finite REST Google route in this fork is `/google-ai-studio/v1beta`; the realtime route is `/google`. Reusing `cloudflareProviderBaseURL("google", ...)` would therefore be incorrect.

Cloudflare's [spend limits](https://developers.cloudflare.com/ai-gateway/features/spend-limits/) apply to BYOK requests with known pricing, but the documentation explicitly says accounting is eventually consistent and the current request's cost is recorded after completion. Spend limits are defense in depth; they are not a client-side per-session hard stop.

Cloudflare's logging controls should also be part of the design. The current [AI Gateway logging documentation](https://developers.cloudflare.com/ai-gateway/observability/logging/) and changelog document `cf-aig-collect-log-payload: false`, which preserves metadata such as model, status, duration, token counts, and cost while suppressing request/response body storage. The live client should send that header by default, subject to a Stage 0 confirmation that it is honored for realtime WebSockets.

### 3.2 OpenAI Realtime

OpenAI's [Realtime conversations guide](https://developers.openai.com/api/docs/guides/realtime-conversations) describes a stateful session over WebSocket or WebRTC. With WebSocket, the application manually sends base64-encoded audio-buffer events and handles server events. Current examples use a Realtime model such as `gpt-realtime-2.1`, but model names are release-time inputs and must not become an eternal CLI default.

Relevant protocol properties for this CLI include:

- the server emits `session.created`, after which the client sends `session.update` and waits for an acknowledged configuration;
- PCM input can be configured at 24 kHz;
- output audio bytes arrive incrementally in audio-delta events, not only in the terminal response event;
- server VAD emits speech-start events and can cancel an in-progress response;
- a WebSocket client must stop local playback immediately on barge-in and truncate the assistant conversation item to the audio duration actually heard, otherwise future context includes words the user never heard;
- manual push-to-talk flows use explicit buffer commit/response creation and response cancellation;
- sessions have a provider maximum duration, currently documented as 60 minutes.

The CLI should implement the event contract directly rather than depending on the finite `@ai-sdk/openai` model object, because the latter is not the owner of a long-lived provider-native WebSocket session.

Current OpenAI model and pricing pages are useful only for smoke budgeting and release documentation. They are not stable enough to justify a source default. As of this report, OpenAI lists current Realtime models and audio-token pricing in its [model catalog](https://developers.openai.com/api/docs/models), but the implementation should require an explicit model and capture actual provider/gateway usage in live-smoke evidence.

### 3.3 Google Gemini Live

Google's [Live API overview](https://ai.google.dev/gemini-api/docs/live-api) labels the API Preview and describes a stateful WebSocket with raw little-endian PCM16 input at 16 kHz and output at 24 kHz. Current Google documentation identifies `gemini-3.1-flash-live-preview` as a live audio model, but the preview identifier and event details are subject to change.

The first-party [Live WebSocket reference](https://ai.google.dev/api/live) matters more than an SDK example for a self-contained fork implementation:

- the first client message must be setup;
- client messages are one of setup, client content, realtime input, or tool response;
- the client should wait for setup completion before sending conversation input;
- server messages can include setup completion, server content, tool calls/cancellation, go-away, session-resumption updates, and usage metadata;
- server content carries turn completion and interruption state;
- Gemini 3.1 can place multiple content parts in one server event, so the adapter must process every part rather than using only the first;
- automatic activity handling supports barge-in, and an interruption requires immediately stopping and clearing queued output audio;
- current 3.1 guidance uses realtime input for conversational text after setup rather than treating client content as the universal update mechanism.

Google's [pricing page](https://ai.google.dev/gemini-api/docs/pricing) currently publishes both token and approximate per-minute audio prices for the preview model. Those figures can inform a smoke-test advisory ceiling, but the test should rely on duration, output-token limits, no retries, and captured actual usage—not a permanently hard-coded dollar calculation.

### 3.4 OpenRouter

OpenRouter's [streaming documentation](https://openrouter.ai/docs/api_reference/streaming) describes `stream: true` on HTTP generation endpoints and SSE parsing. Its [speech-to-text documentation](https://openrouter.ai/docs/guides/overview/multimodal/stt) describes a finite `/api/v1/audio/transcriptions` request with base64 or multipart audio and a JSON result.

The reviewed official OpenRouter documentation does not specify a provider-native, bidirectional, full-duplex voice WebSocket equivalent to OpenAI Realtime or Gemini Live. Cloudflare's current realtime provider list also does not include OpenRouter.

This is necessarily a date-bounded conclusion, not a claim about undocumented or future capabilities. The correct supported role in this fork is:

- continue using OpenRouter for existing finite text/media capabilities already implemented and tested;
- potentially add OpenRouter's finite STT endpoint in a separate backlog item if desired;
- reject OpenRouter under `ai live` until both OpenRouter and Cloudflare document a compatible realtime path and a new protocol spike proves it.

Using Cloudflare's non-realtime WebSocket transport to carry a standard OpenRouter request would not change that answer: it could be a transport variation for a finite request, but it would not produce the session and interruption semantics promised by `ai live`.

## 4. User-facing command and session contract

### 4.1 Command shape

Recommended v1 syntax:

```bash
ai live -m openai/gpt-realtime-2.1
ai live -m google/gemini-3.1-flash-live-preview
ai live -m openai/gpt-realtime-2.1 "Say hello in one sentence"
ai live -m google/gemini-3.1-flash-live-preview \
  --no-mic --no-play --record reply.wav \
  "Say exactly: LIVE SMOKE OK"
ai live --check -m openai/gpt-realtime-2.1
```

The model examples above reflect first-party documentation at report time; they should be labeled examples, not defaults.

Recommended options:

```text
-m, --model <provider/model>  Required unless AI_CLI_LIVE_MODEL is set
-s, --system <text>           Session instructions
--voice <id>                  Provider voice identifier; validated by adapter
--no-mic                      Do not capture microphone input
--no-play                     Do not play model audio
--record <path.wav>           Persist model output as PCM WAV
--input-device <id>           Capture backend device selector
--output-device <id>          Playback backend device selector
--turn-detection <mode>       server (v1 default); manual only after proven
--max-output-tokens <n>       Provider-supported response ceiling
--timeout <seconds>           Total client session deadline
--idle-timeout <seconds>      No-progress deadline
--check                       Run the complete no-network preflight and exit
--trace <path.jsonl>          Write redacted event/timing diagnostics
-q, --quiet                   Suppress human status messages on stderr
--json                        Emit one final machine-readable summary on stdout
```

Do not automatically inherit every common finite-generation option. `--count`, `--concurrency`, comma-separated models, output-directory fan-out, and finite-request fallback are conceptually wrong for one live conversation.

### 4.2 Selection rules

`ai live` should accept exactly one explicit provider-qualified model:

- `openai/<non-empty-provider-model>`
- `google/<non-empty-provider-model>`

The parser should reject, before preflight and before a socket factory is called:

- no model and no `AI_CLI_LIVE_MODEL`;
- unprefixed or short aliases;
- comma-separated values;
- `openrouter/...`, `replicate/...`, `fal/...`, or creator-style IDs;
- `AI_CLI_GATEWAY=vercel`;
- whitespace, control characters, fragments, or query material in model IDs;
- provider model IDs containing `?`, `#`, backslashes, or percent-encoded credential-like components if they could affect URL construction.

The model parser may reuse the same printable-ASCII principle as `src/lib/models.ts:266-275`, but duplicating ten lines inside the isolated live subtree is preferable to changing the upstream-sensitive finite model module solely for code reuse. It should additionally apply URL-component restrictions appropriate to a WebSocket route.

There should be **no model default** in v1. The no-model convenience of existing commands is a poor trade for an experimental, potentially expensive, protocol-sensitive session. Documentation and smoke tests can supply current known-good model IDs at release time.

### 4.3 Prompt and microphone behavior

- With a positional prompt, connect and configure first, then submit that text as the first user turn. Unless `--no-mic` is set, microphone capture begins only after the initial typed turn has been sent and the session is ready for audio.
- Without a prompt, microphone input is required. `ai live --no-mic` with no prompt is a usage error.
- `--no-mic` is a first-class typed-session mode, not only a test hook.
- `--no-play` discards live playback but still permits `--record` and transcript output.
- If both playback and recording are disabled, the command may still run for transcript-only debugging, but it should warn in human mode that model audio is being discarded.

### 4.4 Terminal output contract

Use the repository's existing convention of separating result data and status:

- **stdout:** assistant transcript as it becomes final in human mode; a single final summary object in `--json` mode.
- **stderr:** connection state, microphone state, interruption notices, preflight diagnostics, warnings, and errors.
- **audio:** speaker device only; never raw bytes on stdout.
- **recording:** only when explicitly requested.
- **trace:** only when explicitly requested, redacted by construction.

Avoid printing partial transcripts with terminal cursor tricks in v1. Final transcript segments are deterministic, pipe-friendly, and less likely to conflict with speaker status. Partial transcript rendering can be added later as a TTY-only feature.

A final JSON summary should include only safe fields such as:

```json
{
  "provider": "google",
  "model": "gemini-3.1-flash-live-preview",
  "status": "completed",
  "turns": 1,
  "inputTranscript": null,
  "outputTranscript": "Live smoke ok.",
  "audioBytes": 48000,
  "audioDurationMs": 1000,
  "usage": {},
  "recording": "reply.wav",
  "elapsedMs": 1840
}
```

Do not include the Cloudflare token, provider credentials, full handshake headers, base64 audio, or unredacted provider error bodies.

### 4.5 Cancellation and process semantics

Recommended controls:

- First `Ctrl-C`: transition to cancelling, stop microphone capture, prevent new sends, cancel the current provider response where supported, clear or drain playback according to cancellation reason, finalize any recording, close the WebSocket, restore terminal state, and exit 130.
- Second `Ctrl-C`: hard-stop child processes and socket, restore terminal state best-effort, exit 130.
- `Ctrl-D` on an interactive stdin control channel: stop accepting new turns, let the current turn finish, then close and exit 0.
- Normal provider turn completion does not automatically end an interactive session. A typed-only session with an initial prompt and no TTY can default to one turn and close, which makes shell use and live-smoke behavior predictable.

Signal listeners must be installed per session and removed in a `finally` path. Do not reuse the module-global immediate-exit handler in `src/lib/progress.ts`.

### 4.6 Error language

Unsupported routes should be explicit and actionable. For example:

```text
error: ai live does not support openrouter/... models.
OpenRouter currently documents HTTP/SSE generation streaming and finite audio
transcription, not a provider-native full-duplex Realtime WebSocket through
Cloudflare AI Gateway. Use `ai text -m openrouter/...` or select an explicit
`openai/...` or `google/...` live model. No network request was made.
```

Preflight errors must end with “No network request was made” when that is true. This is both user trust and an acceptance-testable spend-safety property.

## 5. Proposed code boundary

### 5.1 File layout

```text
packages/ai-cli/src/
  commands/
    live.ts                         # CLI mapping only
  lib/
    live/
      types.ts                      # small internal contracts
      model.ts                      # strict provider/model parser
      preflight.ts                  # no-network capability checks
      cloudflare.ts                 # exact WSS URL/header construction
      transport.ts                  # Undici wrapper and injected factory
      session.ts                    # lifecycle/state machine owner
      terminal.ts                   # scoped signals and TTY controls
      errors.ts                     # bounded/redacted diagnostics
      providers/
        openai.ts                   # native event encoder/decoder
        google.ts                   # native event encoder/decoder
      audio/
        formats.ts                  # PCM format and frame math
        capture.ts                  # external process adapter
        playback.ts                 # external process adapter
        wav.ts                      # streaming writer/header finalization
      fixtures/
        openai/*.json               # sanitized native event fixtures
        google/*.json
```

Co-locate `*.test.ts` files beside the modules, matching the repository's Bun-test style.

### 5.2 Existing files that should change

Required:

- `packages/ai-cli/src/index.ts`: one import and one registration call.
- `packages/ai-cli/README.md` and all relevant `apps/web/docs/*.mdx` surfaces.
- `CHANGELOG.md`, `HANDOFF.md`, `LEARNINGS.md`, `docs/upstream-sync.md`.
- The backlog task status/acceptance evidence when implementation is complete.

Likely but small:

- `packages/ai-cli/package.json`: only if adding an explicit opt-in smoke script. No dependency edit if Undici passes.
- A new package-level or live-specific CLI integration test. The existing `cli.test.ts` does not assert an exact subcommand set, so it need not be edited merely to add `live`.

Avoid in v1:

- `src/lib/gateway.ts`: reuse its exported backend and Cloudflare config resolvers, but do not mix WebSocket protocol logic into its finite provider factory.
- `src/lib/models.ts`: no live aliases, defaults, or catalog capability changes.
- current command implementations;
- `audio-preview.ts`;
- `progress.ts`.

This creates a stable merge rule: **upstream changes outside `src/index.ts` should almost never conflict with the live implementation.** Fork maintainers review the live subtree independently and resolve only the small command-registration hunk during upstream sync.

### 5.3 Why not put everything in `gateway.ts`

The repository instruction to keep Cloudflare policy concentrated in `gateway.ts` is correct for finite SDK routing, but literally placing a second protocol family in that already large file would undermine the upstream objective it is meant to serve.

The stronger interpretation is:

- shared Cloudflare backend/auth configuration remains owned by `gateway.ts`;
- live-only Cloudflare WebSocket route construction and headers live in `lib/live/cloudflare.ts`;
- `docs/upstream-sync.md` names both intentional seams.

That preserves a single source for account ID, gateway ID, token precedence, and default backend while preventing native provider event schemas from contaminating the finite SDK layer.

## 6. Internal interfaces and ownership

### 6.1 Do not invent one universal wire protocol

OpenAI and Google have materially different state and interruption models. A large normalized event schema would either lose important semantics or continually expand until it mirrors both providers badly.

Normalize only the lifecycle facts the session controller must act on:

```ts
type LiveProvider = "openai" | "google";

type LiveEvent =
  | { type: "configured" }
  | { type: "input-speech-started" }
  | { type: "input-speech-stopped" }
  | { type: "output-audio"; pcm: Uint8Array; format: PcmFormat; item?: string }
  | { type: "output-transcript-delta"; text: string }
  | { type: "output-transcript-final"; text: string }
  | { type: "input-transcript-final"; text: string }
  | { type: "turn-complete" }
  | { type: "interrupted"; item?: string }
  | { type: "usage"; value: unknown }
  | { type: "go-away"; retryAfterMs?: number }
  | { type: "provider-error"; error: SafeProviderError }
  | { type: "unknown"; providerType: string };
```

Keep provider-specific raw parsing and command generation behind an adapter:

```ts
interface LiveProtocolAdapter {
  readonly provider: LiveProvider;
  readonly inputFormat: PcmFormat;
  readonly outputFormat: PcmFormat;
  readonly preferredFrameMs: number;

  setup(options: ProviderSessionOptions): readonly JsonValue[];
  textTurn(text: string): readonly JsonValue[];
  audioFrame(frame: Uint8Array): JsonValue;
  endAudioTurn(): readonly JsonValue[];
  cancel(context: CancelContext): readonly JsonValue[];
  truncatePlayback?(context: PlaybackContext): readonly JsonValue[];
  decode(raw: string): readonly LiveEvent[];
}
```

The session controller should not inspect provider message field names. The adapters should not own terminal state, child processes, deadlines, or output files.

### 6.2 Transport seam

Define a minimal transport rather than expose the concrete WebSocket throughout the code:

```ts
interface LiveTransport {
  readonly bufferedAmount: number;
  sendText(value: string): void;
  close(code?: number, reason?: string): void;
  onOpen(listener: () => void): Disposer;
  onMessage(listener: (value: string) => void): Disposer;
  onError(listener: (error: unknown) => void): Disposer;
  onClose(listener: (event: CloseInfo) => void): Disposer;
}

type LiveTransportFactory = (
  url: URL,
  headers: Readonly<Record<string, string>>
) => LiveTransport;
```

The production factory wraps `undici.WebSocket`. Tests inject a fully in-memory transport. This avoids paid/network tests for almost all lifecycle logic and makes provider fixtures deterministic.

### 6.3 Other injected boundaries

Inject these small capabilities into `LiveSession`:

- `Clock` and timer scheduler;
- `AudioSource` and `AudioSink`;
- `WavSink`;
- `SignalSource`;
- `TerminalIO`;
- `TraceSink`;
- logger;
- transport factory.

This is not abstraction for its own sake. Every one of these is required to deterministically test timeout races, backpressure, signals, subprocess failures, interruption, cleanup, and file finalization without a real device or provider.

### 6.4 State machine

Recommended states:

```text
new
  -> preflighting
  -> connecting
  -> configuring
  -> ready
  -> active
  -> draining
  -> closing
  -> closed

Any nonterminal state -> cancelling -> closing -> cancelled
Any nonterminal state -> failed -> closing -> closed
```

Rules:

- One object owns transitions and cleanup.
- Cleanup is idempotent and runs once.
- The socket is not constructed until preflight succeeds.
- Audio capture does not start until provider setup succeeds.
- Sends after cancelling/closing are rejected locally.
- Provider errors and socket close races resolve to one terminal result.
- A normal close code without a completed requested turn is not automatically success.
- No automatic reconnect or provider fallback occurs in v1.

A single serialized event queue is preferable to many independent async callbacks mutating state. WebSocket, audio-source, signal, timer, and child-process events should enqueue work into the same controller.

## 7. Cloudflare transport and credential boundary

### 7.1 Reuse existing configuration

`lib/live/cloudflare.ts` should call:

```ts
resolveGatewayBackend(env)
resolveCloudflareGatewayConfig(env)
```

from `src/lib/gateway.ts`. It should require `cloudflare` and reject `vercel` before media preflight.

Construct URLs with `URL` and encoded path segments rather than string concatenation. The host, scheme, and route are fixed constants:

```ts
const base = new URL("wss://gateway.ai.cloudflare.com/");
base.pathname = `/v1/${encodeURIComponent(accountId)}/${encodeURIComponent(gatewayId)}/${route}`;
```

The provider model is:

- an encoded `model` query value on the OpenAI route;
- `models/<providerModel>` inside Google's setup message, not in a credential-bearing URL.

### 7.2 Header allowlist

Initial handshake headers should be an allowlist, not a merge of process environment or SDK headers:

```text
cf-aig-authorization: Bearer <Cloudflare token>
cf-aig-collect-log-payload: false
```

Optionally add safe Cloudflare metadata only after Stage 0 proves its realtime support and exact constraints. Do not invent or depend on an alias-selection header until current Cloudflare documentation or empirical evidence confirms it for WebSockets. The repository's established `default` Provider Key alias should be the v1 operational assumption.

Forbidden client material in Cloudflare mode:

- `Authorization` provider bearer header;
- `x-goog-api-key`;
- `key`, `api_key`, or `access_token` query parameters;
- `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `GEMINI_API_KEY`, or similar values;
- arbitrary caller-supplied WebSocket endpoint, host, headers, or query string.

A unit test should fill every known provider-key environment variable with a distinctive poison value and assert that the value appears nowhere in the URL, header map, trace, error, or sent setup messages.

### 7.3 OpenAI handshake uncertainty

Cloudflare's current example includes the historical `OpenAI-Beta: realtime=v1` header. Current OpenAI Realtime documentation has evolved beyond the original preview. Do not cargo-cult the header either way.

Stage 0 must try the smallest matrix through Cloudflare BYOK:

1. current model, no beta header;
2. current model, beta header only if the first fails with evidence that requests it.

The committed implementation should send only the headers required by the tested route. Record the result in `HANDOFF.md` with the test date and model.

### 7.4 Google BYOK uncertainty is a hard stop

The following are insufficient proof:

- Cloudflare's generic sentence that provider keys “can” use BYOK;
- a successful finite Google REST request;
- a direct Google WebSocket using a local key;
- a Cloudflare Google WebSocket using an `api_key` query parameter.

Acceptance requires a successful Cloudflare `/google` WebSocket session where the client request contains **no Google credential at all**, and a post-run inspection verifies that Cloudflare selected the stored `google-ai-studio/default` key.

If Cloudflare's current implementation requires a Google key in the URL, stop. Do not ship a weakened exception to the repository's BYOK invariant. File or track the platform gap and release OpenAI-only only if Patrick explicitly changes the task scope; do not silently claim both providers.

### 7.5 Logging and redaction

Send `cf-aig-collect-log-payload: false` by default. Treat this as privacy minimization, not “no logging”: metadata can still include provider, model, timing, usage, cost, status, and request identifiers.

Safe trace policy:

- event type, monotonic timestamp, byte count, sample count, queue depth, state transition, close code, provider request ID, and one-way hashes are allowed;
- raw/base64 audio, Cloudflare token, headers, query strings, provider credentials, complete raw error payloads, and transcripts are excluded by default;
- transcript inclusion, if ever added, requires a separate explicit flag and documentation;
- trace files should be created with user-only permissions where the platform permits;
- error formatting must cap lengths and recursively redact keys matching token/key/authorization patterns.

## 8. Provider adapter requirements

### 8.1 OpenAI adapter

The OpenAI adapter should own:

1. **Setup:** wait for `session.created`; send current-schema `session.update`; wait for `session.updated` or an error before marking configured.
2. **Audio input:** emit base64 PCM events at the configured 24 kHz mono PCM16 format. Under server VAD, append continuously. Under a later manual mode, append, commit, then request a response.
3. **Typed input:** create a user conversation item and request a response using the current native event schema.
4. **Audio output:** decode every audio delta immediately; do not expect terminal response events to contain replayable audio.
5. **Transcripts:** normalize only final/partial transcript events needed by the session output contract.
6. **Completion:** recognize response completion and usage without assuming it means the overall interactive session should close.
7. **Interruption:** on provider speech-start/interruption:
   - stop and clear queued model playback immediately;
   - measure audio actually written to the device by sample count, not wall-clock guesses;
   - send the provider's truncate event for the assistant item/content index at the exact played duration;
   - cancel an in-progress response when required by the selected turn-detection mode.
8. **Errors:** preserve provider error code/type/request ID in a bounded `SafeProviderError`; never dump arbitrary payloads.

The most important correctness property is transcript/context alignment after barge-in. Merely muting local output is not enough: if the server retains unheard assistant audio in conversation history, the next turn is semantically wrong.

### 8.2 Google adapter

The Google adapter should own:

1. **Setup-first:** the first sent message is setup with `models/<model>`, audio response modality, system instruction, transcription options, voice, thinking level, and output limits as supported by the tested model. Wait for setup completion.
2. **Audio input:** send raw PCM16 at 16 kHz in realtime-input messages. The media layer should produce the provider rate directly; do not resample inside the event adapter.
3. **Typed input:** for current Gemini 3.1 behavior, use realtime input for conversational text after setup. Do not assume older client-content patterns remain universally correct.
4. **Audio output:** extract every inline audio part and validate/derive its MIME sample rate. Expect 24 kHz PCM16 for the initial supported model.
5. **Multiple parts:** iterate all parts in every server-content event. A “first part only” implementation is an acceptance failure.
6. **Interruption:** when server content reports interruption, stop and clear queued model audio immediately. Unlike OpenAI, do not invent a truncate event that Google does not define.
7. **Turn completion:** distinguish generation completion, interruption, and turn completion. An interrupted turn can proceed to turn-complete without normal generation-complete.
8. **Usage/go-away:** capture usage metadata and surface go-away/session-resumption information. Do not automatically resume in v1; close cleanly with a clear message and evidence.
9. **Input end:** send the documented audio-stream-end/activity-end message when capture pauses or the user closes, as required by the selected automatic activity handling.

### 8.3 Provider capabilities should remain data, not conditionals everywhere

Each adapter should expose a compact tested capability object:

```ts
{
  supportsServerVad: true,
  supportsManualTurn: false,       // until implemented and proven
  supportsOutputTranscript: true,
  supportsInputTranscript: true,
  supportsTruncate: true | false,
  supportsUsage: true,
  inputFormat: { encoding: "pcm_s16le", rate: 24000 | 16000, channels: 1 },
  outputFormat: { encoding: "pcm_s16le", rate: 24000, channels: 1 }
}
```

The session controller acts on capabilities; it does not switch on provider names except at adapter construction.

## 9. Audio, packaging, and preflight

### 9.1 The false dichotomy

The backlog asks whether a normal install should contain all runtime clients/media dependencies or perform a preflight. The strongest design uses both at the appropriate layer:

- the npm artifact contains all JavaScript protocol/session code and a header-capable WebSocket client;
- device I/O uses a system capability that is probed before connecting;
- headless operation requires no external media executable;
- interactive operation fails before spend with an exact remedy when the capability is missing.

### 9.2 Use existing Undici before adding `ws`

The package already exact-pins Undici 7.29. Its WebSocket API supports custom headers in Node. Using it avoids:

- another dependency and lockfile churn;
- another bundled implementation;
- a larger security/update surface;
- an unnecessary fork-only package edit.

Stage 0 must still prove:

- Cloudflare accepts its upgrade request and headers for both provider routes;
- text messages, close codes/reasons, and large provider events are handled correctly;
- the client can distinguish DNS/TLS failure, gateway authentication failure, provider/BYOK failure, and protocol close sufficiently for actionable errors;
- `bufferedAmount` behaves well enough for backpressure;
- no required Cloudflare control frame or proxy behavior is missing.

Only if those checks fail should the implementation add `ws`. At that point, follow `CLAUDE.md:63-71`: query the current npm version, exact-pin it, update the lockfile, and document why the existing runtime dependency was insufficient. The decision should be evidence-driven, not based on Cloudflare examples importing `ws`.

### 9.3 Media backend recommendation

Use external processes that stream raw PCM over stdio. The initial production backend should target a validated FFmpeg/ffplay installation because it can provide consistent format conversion across operating systems without native Node addons.

Conceptual pipelines:

```text
microphone/device -> ffmpeg -> mono PCM16 at provider input rate -> frame queue -> WebSocket
WebSocket audio -> bounded PCM queue -> ffplay (or validated raw sink) -> speaker/device
WebSocket audio -> streaming WAV writer -> optional record file
```

The capture command is platform-specific at the device-input boundary but should always emit exact raw PCM on stdout. Playback should accept exact raw PCM on stdin. The Node process should not decode compressed audio or resample in JavaScript.

Do not claim support for an operating system until its device enumeration, permission behavior, capture command, playback command, interruption latency, and process cleanup have been tested. If the first implementation is macOS-only for interactive devices, say so explicitly while retaining cross-platform typed/headless mode. A vague “FFmpeg is cross-platform” claim is not sufficient.

### 9.4 Preflight contract

The same `runLivePreflight()` function should back both `ai live --check` and the automatic pre-connect check.

Order matters:

1. Parse and validate backend, provider, model, options, timeouts, and incompatible flags.
2. Resolve Cloudflare account/gateway auth; never print token values.
3. Validate recording/trace paths by creating and deleting an atomic temporary sibling file.
4. If microphone is enabled:
   - locate the supported capture executable;
   - enumerate or validate the selected device;
   - perform a no-network, bounded format/permission probe;
   - stop the probe cleanly.
5. If playback is enabled:
   - locate the supported playback executable;
   - validate that it accepts the exact raw format from stdin;
   - perform a silent/short no-network launch probe without audible output where feasible.
6. Check TTY requirements for interactive controls; choose one-turn noninteractive behavior when stdin is not a TTY.
7. Import/instantiate the production WebSocket factory without connecting.
8. Report success and only then allow connection.

The check should normally finish in a few seconds, except when the operating system is presenting a microphone permission prompt. That prompt must occur before a paid socket opens.

Example output:

```text
Cloudflare backend: configured (gateway ai-cli)
Live provider/model: google/gemini-3.1-flash-live-preview
WebSocket client: undici 7.29.0
Microphone capture: ffmpeg, device validated, PCM16/16000/mono
Playback: ffplay, PCM16/24000/mono
Recording: disabled
Payload logging: disabled by request header
Network/provider: not contacted
Preflight passed; no network request was made.
```

### 9.5 Exact remedies

Acceptance criterion #4 requires an exact remedy, not “install an audio tool.” Documentation should include commands validated on each claimed platform, for example a tested package-manager command and a post-install verification command. The implementation agent must verify current recipes rather than copying assumptions into the product.

A failure should name:

- missing executable or permission;
- affected capability (capture versus playback);
- whether `--no-mic`, `--no-play`, or `--record` can provide a no-install path;
- exact installation/permission remedy for the detected supported OS;
- a re-run command using `ai live --check`;
- confirmation that no network request was made.

### 9.6 Headless mode is part of the product, not a compromise

This command must work with no microphone or speaker dependency:

```bash
ai live \
  -m google/gemini-3.1-flash-live-preview \
  --no-mic --no-play --record response.wav \
  "Explain photosynthesis in one sentence"
```

That mode enables servers, agents, CI smoke tests, remote shells, accessibility workflows, and deterministic evidence. It also ensures an npm installation is useful even before interactive device support is available on every OS.

## 10. Buffering, timing, and reliability

### 10.1 PCM framing

Use explicit format objects and sample math:

```ts
interface PcmFormat {
  encoding: "pcm_s16le";
  sampleRate: 16000 | 24000;
  channels: 1;
  bytesPerSample: 2;
}
```

A 20 ms mono PCM16 frame is:

- 640 bytes at 16 kHz;
- 960 bytes at 24 kHz.

Choose a provider-adapter preferred frame duration, initially 20 ms unless the protocol spike shows a better supported size. The media layer must preserve even-byte sample boundaries and should accumulate arbitrary child-process chunks into whole frames before base64 encoding.

### 10.2 Backpressure

The WebSocket send path must not read microphone PCM indefinitely while the network is slow.

Recommended behavior:

- pause the capture stream when `bufferedAmount` exceeds a tested high-water mark;
- resume below a low-water mark;
- impose a maximum pause duration and fail clearly rather than building unbounded latency;
- count queued input milliseconds, not only bytes;
- never retry or duplicate an audio frame after an uncertain send.

Output playback should use a duration-bounded queue. A small queue smooths scheduling, but a large queue destroys barge-in latency. Start with a maximum around 1–2 seconds, tune empirically, and expose queue depth in redacted traces. On unexpected overflow, fail or drop the entire current response with a clear warning; silently dropping arbitrary PCM chunks corrupts speech.

### 10.3 Interruption accuracy

For OpenAI truncation, calculate heard duration from samples accepted by the playback sink:

```text
audio_end_ms = floor(played_samples * 1000 / sample_rate)
```

Do not use the time since the first delta arrived. Network buffering, event-loop stalls, and speaker queues make wall-clock estimates wrong.

The playback adapter therefore needs acknowledgement of bytes/samples written or drained, not only a fire-and-forget `write()` call. On barge-in:

1. stop accepting new output chunks for the interrupted item;
2. terminate or flush the playback process in a tested way;
3. clear queued chunks;
4. report exact played samples to the OpenAI adapter;
5. send truncate/cancel events;
6. restart or reset the sink for the next turn.

Google requires the same local stop/clear behavior but no invented truncate event.

### 10.4 Deadlines

V1 defaults should be deliberately below provider maxima:

- connection/open: 10 seconds;
- provider setup acknowledgement: 10 seconds;
- no-progress/idle: 45 seconds in one-turn noninteractive mode; a documented longer value for interactive listening;
- total session: 300 seconds by default;
- graceful close: 2 seconds before force close;
- live smoke: much lower fixed limits, discussed below.

Use monotonic time for deadlines and durations. A timeout should identify the state (`connecting`, `configuring`, `waiting for first audio`, `idle`, or `closing`) and preserve safe request/close identifiers.

### 10.5 No hidden recovery in v1

Do not automatically:

- reconnect a dropped socket;
- resume a Gemini session;
- recreate an OpenAI session;
- retry a setup event;
- switch models or providers;
- replay microphone frames.

Realtime recovery can double-spend, duplicate user speech, and create inconsistent conversation state. Surface the failure and let the user start a new session. Parse and report Gemini go-away/resumption data so a later feature can be designed from evidence.

## 11. Deterministic no-network test strategy

The deterministic suite should prove nearly everything except real Cloudflare/provider interoperability and physical device behavior.

### 11.1 Model and command tests

Cover:

- required explicit model;
- `AI_CLI_LIVE_MODEL` precedence;
- only `openai/` and `google/` accepted;
- OpenRouter and all other providers rejected before transport construction;
- no short aliases, commas, whitespace, control characters, query injection, fragments, or empty provider model;
- `AI_CLI_GATEWAY=vercel` rejected;
- incompatible flag combinations;
- prompt/no-mic requirements;
- `--check` never calls the transport factory;
- help output and root command listing;
- noninteractive one-turn selection.

Use a spy transport factory and assert zero calls on every unsupported/preflight failure.

### 11.2 Cloudflare route/auth tests

Table-drive exact URL and header assertions for both providers:

- encoded account and gateway path components;
- OpenAI model query encoding;
- Google model absent from URL and present only in setup;
- fixed `wss:` scheme and exact host;
- `cf-aig-authorization` present;
- payload logging header false;
- no provider authorization or key query parameters;
- no arbitrary headers copied from environment;
- poison provider keys absent from every serialized artifact;
- secrets redacted from error messages.

Include special-character and Unicode rejection tests rather than relying only on URL encoding.

### 11.3 Native protocol fixture tests

Store sanitized first-party-shaped JSON fixtures for:

**OpenAI**

- session created/updated;
- typed turn creation;
- audio append/commit;
- audio deltas and final transcript;
- usage/completion;
- server VAD speech start/stop;
- interruption/cancel/truncate;
- provider error;
- unknown future event.

**Google**

- setup complete;
- realtime text and audio input encoding;
- server content with one part and multiple parts;
- output audio/transcript together;
- input transcript;
- interrupted then turn complete;
- usage metadata;
- go-away/session-resumption update;
- provider error/close;
- unknown future field.

Tests should assert native outgoing JSON and normalized incoming events separately. Unknown events should be traceable and ignored safely unless they violate state, not treated as fatal by default.

### 11.4 PCM and WAV tests

Cover:

- exact 16 kHz/24 kHz frame byte counts;
- arbitrary source chunk boundaries coalesced to whole PCM16 samples;
- base64 round trip;
- rejection of odd final bytes;
- sample-duration calculations;
- output format switch rejection mid-session unless explicitly supported;
- golden WAV header and data length;
- streaming file finalization after normal close, cancellation, provider error, and process error;
- cleanup of incomplete temp files;
- exact OpenAI truncate duration from played sample count.

### 11.5 State-machine and race tests

Use a fake clock and injected transport/audio components to cover:

- every valid transition;
- illegal sends before configured or after close;
- connect timeout;
- setup timeout;
- idle timeout;
- total timeout;
- close timeout;
- socket error plus close race;
- provider error plus user signal race;
- first and second `Ctrl-C`;
- listener removal and terminal restoration;
- cleanup exactly once;
- input backpressure pause/resume/failure;
- output queue bounds;
- OpenAI barge-in truncate sequence;
- Google barge-in queue clear;
- child capture/playback exit;
- record/trace write failure;
- normal one-turn headless close.

### 11.6 Subprocess/preflight tests

The executable locator and child-process layer should be injectable. Simulate:

- missing FFmpeg/ffplay;
- executable found but returns unsupported version;
- device not found;
- permission denied;
- process starts but emits malformed/odd PCM;
- broken pipe on playback;
- process refuses to exit;
- PATH containing spaces;
- Windows/macOS/Linux command construction;
- `--no-mic` and `--no-play` bypass only the appropriate checks;
- exact remediation text and “no network request” statement.

Do not require actual audio hardware for the default suite.

### 11.7 Package-level tests

Because the package publishes only `dist` and README, add a clean-room package check:

1. `bun install --frozen-lockfile`.
2. typecheck, format, lint, test, and build.
3. `npm pack` or `bun pm pack` the CLI package.
4. install/extract it in a temporary directory with no repository `node_modules` resolution.
5. run `ai --help`, `ai live --help`, and `ai live --check` in headless mode with dummy Cloudflare configuration and no network.
6. verify `undici` transport construction is available from the built artifact.
7. run an unsupported OpenRouter invocation and prove it exits before network.
8. scan the tarball and built JavaScript for credentials and accidental fixture/trace content.

If Bun externalizes Undici rather than embedding it, the package's runtime dependency must still install normally; the clean-room check is the source of truth. The acceptance criterion is a working normal package install, not a particular bundle-internal arrangement.

## 12. Opt-in live smoke tests with bounded cost

### 12.1 Purpose and gating

Live smoke tests prove only the small set of facts deterministic tests cannot:

- Cloudflare WebSocket upgrade and authenticated gateway path;
- stored BYOK key injection with provider keys absent locally;
- current provider model acceptance;
- setup/event interoperability;
- one text-in/audio-out turn;
- payload-log suppression and gateway observability;
- actual usage/cost evidence.

They must not run in the normal test suite by accident. Recommended gate:

```text
AI_CLI_LIVE_SMOKE=1
AI_CLI_LIVE_SMOKE_ACK=PAID
AI_CLI_LIVE_OPENAI_MODEL=<explicit current model>
AI_CLI_LIVE_GOOGLE_MODEL=<explicit current model>
```

Without both gate variables, tests report a clear skip. When enabled, missing Cloudflare auth/model variables are failures, not silent skips. Provider-account limitations should produce a distinct documented blocked result.

### 12.2 One-turn headless scenario

Run one provider at a time with:

- all local provider-key variables unset, then additionally set to known poison values in a child environment to prove they are ignored;
- `--no-mic --no-play`;
- a temporary `--record` WAV;
- typed prompt: `Say exactly: LIVE SMOKE OK.`;
- output transcription enabled;
- tools/search/vision disabled;
- provider reasoning/thinking set to the lowest-latency supported value;
- the lowest proven safe output-token cap, initially targeting 32–64;
- 10-second connection timeout;
- 10-second setup timeout;
- 20–30-second total hard deadline;
- close immediately after the first completed or interrupted turn;
- no client retry and no automatic reconnect.

Assertions:

- configured event received;
- at least one nonempty audio chunk;
- valid PCM/WAV format and plausible duration;
- final output transcript normalizes to the token sequence `LIVE SMOKE OK` (allow punctuation and spoken spacing rather than requiring underscores);
- turn-complete received;
- provider usage captured when available;
- close status is expected;
- no provider poison key appears in artifacts;
- Cloudflare log identifies the intended provider/model and stored-key route without stored payload body.

Audio-byte presence alone is weak proof. Transcript plus valid audio is stronger; an occasional human listen remains useful before release but should not be the automated oracle.

### 12.3 Cost controls

Use multiple independent controls:

1. Exactly one session and one turn per provider.
2. Text input only; no billed microphone listening window.
3. Fixed small output-token ceiling.
4. Fixed hard wall-clock deadline.
5. No retries, reconnect, tools, search, images, or video.
6. Close on first turn completion.
7. Dedicated Cloudflare metadata or, preferably if operationally practical, a dedicated smoke gateway with a very small spend rule.
8. Capture actual Cloudflare/provider usage and cost after completion.
9. Require explicit paid-test acknowledgement.

At current published Google pricing, 30 seconds of output audio at the per-minute figure is below one cent, before text/thinking and any gateway/provider nuances. OpenAI publishes audio-token rather than a directly interchangeable per-minute ceiling, so a credible client-side dollar hard cap cannot be derived without measured token behavior. Use a conservative advisory threshold such as `$0.05` per provider run and fail evidence review if actual cost exceeds it, but do not describe that as pre-spend enforcement.

Cloudflare spend limits should be enabled as a second guard. Because their accounting is eventually consistent and records the current request after it completes, they cannot guarantee that a single long session stops exactly at the configured dollar value. The client's one-turn/token/time limits remain primary.

### 12.4 Evidence artifact

Write a redacted JSON record outside the repository, for example:

```json
{
  "schema": 1,
  "timestamp": "2026-08-30T00:00:00Z",
  "commit": "<result-sha>",
  "cliVersion": "0.4.x",
  "provider": "openai",
  "model": "gpt-realtime-2.1",
  "gateway": "ai-cli",
  "payloadLoggingRequested": false,
  "providerKeysPresentLocally": false,
  "connectMs": 310,
  "setupMs": 145,
  "firstAudioMs": 540,
  "totalMs": 2100,
  "audioBytes": 62400,
  "audioSamples": 31200,
  "wavSha256": "...",
  "normalizedTranscript": "LIVE SMOKE OK",
  "usage": {},
  "reportedCostUsd": 0.00,
  "closeCode": 1000,
  "requestIds": ["..."],
  "result": "pass"
}
```

Do not commit generated audio or logs. Summarize sanitized proof in `HANDOFF.md` and `LEARNINGS.md` with the date, model, route, cost, and remaining uncertainty.

### 12.5 Current blockers

- The repository handoff says the OpenAI provider account had zero usable credit and no billing change was authorized. A successful OpenAI smoke requires Patrick's explicit billing/funding decision; the implementation agent must not purchase credit autonomously.
- Google live BYOK without a client-side key remains unproven. This is a protocol/platform gate, not merely missing test data.

## 13. Staged specification-to-implementation sequence

### Stage 0 — Disposable protocol spike; no product merge

**Goal:** resolve platform and transport unknowns before building terminal media.

Build a minimal script outside production command registration using the exact existing `undici@7.29.0` dependency and shared Cloudflare config resolver.

Acceptance:

- OpenAI route upgrades through Cloudflare with only Cloudflare auth and stored BYOK, or fails solely for the documented zero-credit account after demonstrably reaching OpenAI.
- Google route upgrades and completes one text-in/audio-out turn with no Google key/header/query value in the client request.
- Current model IDs are supplied explicitly and recorded.
- Required/obsolete OpenAI beta-header behavior is established.
- `cf-aig-collect-log-payload: false` behavior is checked in Cloudflare logs.
- Undici error/close diagnostics are evaluated against invalid gateway auth, missing BYOK alias/key, invalid model, and provider error.
- No provider keys appear in client environment, URL, headers, trace, or logs generated by the client.

Stop conditions:

- If Google requires `api_key` in the URL, do not implement Google in product code under the current invariant.
- If Undici cannot support the route or actionable diagnostics, document the exact deficiency, then evaluate and exact-pin `ws`.
- If Cloudflare's route does not support current provider protocol/model versions, stop and track the platform gap rather than coding around it with direct-provider credentials.

### Stage 1 — Headless live core

**Goal:** ship the protocol/session architecture without physical media dependencies.

Implement:

- strict model parser;
- Cloudflare WSS builder/header allowlist;
- transport wrapper;
- session state machine;
- OpenAI and Google adapters;
- typed input;
- output PCM recording;
- final transcript/stdout/JSON behavior;
- scoped signals and deadlines;
- no-network preflight and `--check`;
- deterministic unit/fixture/package tests;
- opt-in one-turn headless live smoke.

Acceptance:

- all deterministic tests pass with no network;
- clean-room built package works;
- OpenRouter and unsupported combinations fail before transport creation;
- one provider smoke per supported route passes or is explicitly blocked by a named external account/platform condition;
- no local provider credential is read or forwarded.

This stage is valuable on its own and should be reviewed before adding microphone/speaker complexity.

### Stage 2 — Interactive media and barge-in

**Goal:** add microphone capture and live playback behind the existing interfaces.

Implement:

- supported OS capture/playback process adapters;
- capability and permission preflight with exact remedies;
- PCM framing and backpressure;
- bounded output queue;
- OpenAI played-sample truncation;
- Google interruption queue clear;
- interactive terminal controls;
- device selection;
- optional recording alongside playback.

Acceptance per claimed OS:

- clean install plus documented system dependency setup;
- `ai live --check` passes before network;
- microphone capture and speaker playback use exact expected PCM formats;
- first audio latency and queue depth are measured;
- barge-in audibly stops output promptly;
- OpenAI subsequent context excludes unheard audio;
- Google next turn behaves correctly after interruption;
- first and second `Ctrl-C` clean up every process/file/socket;
- permission denial and missing-device cases are actionable and pre-spend.

If Windows or Linux is not proven, advertise a narrower interactive support matrix rather than extrapolating from macOS.

### Stage 3 — Security, package, documentation, and upstream-sync hardening

Acceptance:

- poison-secret suite passes;
- payload/body logging suppression is documented and empirically checked;
- trace/recording privacy behavior is documented;
- package tarball clean-room test passes;
- all repository-required Bun checks pass;
- README, website command/configuration/installation/models/troubleshooting docs, changelog, handoff, learnings, backlog, and upstream-sync runbook are updated;
- `docs/upstream-sync.md` names `src/lib/live/` and the tiny `src/index.ts` registration hunk as the intended conflict boundary;
- staged diff contains no unrelated formatting or generated files.

### Stage 4 — Experimental release gate

Acceptance:

- OpenAI and Google headless BYOK smoke tests pass on current explicit models with bounded duration/cost and redacted evidence;
- at least one manual interactive end-to-end run per advertised OS passes, including interruption and cancellation;
- OpenAI account funding was explicitly authorized and cost recorded;
- known preview/model/Cloudflare discrepancies are in troubleshooting and handoff docs;
- release notes call the command experimental and state exact supported providers/OS/media dependencies;
- no claim is made for OpenRouter full-duplex live support.

Only after this stage should the backlog task be marked complete.

## 14. Prioritized implementation worklist

### P0 — Resolve before production coding

1. Run the two-provider Cloudflare BYOK WebSocket spike with local provider credentials absent.
2. Prove or disprove keyless Google `/google` BYOK.
3. Determine current OpenAI header/model requirements through Cloudflare.
4. Evaluate Undici upgrade diagnostics; make the evidence-based `undici` versus `ws` decision.
5. Decide and document the initial interactive OS support claim.
6. Obtain Patrick's explicit decision on OpenAI test funding and a paid-smoke ceiling.

### P1 — Build the no-device core

1. Add strict live model/backend parser.
2. Add Cloudflare live URL/header builder with poison-secret tests.
3. Add injected transport and serialized session state machine.
4. Add OpenAI native adapter and fixtures.
5. Add Google native adapter and fixtures, including multi-part events.
6. Add PCM/WAV primitives and headless recording.
7. Add scoped cancellation/deadlines and final output contract.
8. Add `ai live --check`, command help, and package-level tests.
9. Add opt-in headless smoke test with fixed bounds and evidence.

### P2 — Add interactive media

1. Implement one validated capture/playback backend behind interfaces.
2. Add device/permission preflight and exact OS remedies.
3. Add backpressure and bounded playback queue.
4. Add OpenAI sample-accurate truncate and Google queue-clear interruption.
5. Add terminal controls and robust child cleanup.
6. Expand to additional OSes only with the acceptance matrix.

### P3 — Documentation and maintenance boundary

1. Update all required user docs and release/history files in the same PR.
2. Add live-provider/model/preflight troubleshooting tables.
3. Add a dated live-smoke section to `HANDOFF.md`.
4. Record protocol discoveries and provider quirks in `LEARNINGS.md`.
5. Update `docs/upstream-sync.md` with exact live files and smoke command.
6. Run secret scans, clean package validation, and full Bun suite.

## 15. Decisions still requiring Patrick

The architecture has strong defaults, but these operational/product choices require owner authorization:

1. **OpenAI funding:** authorize a minimal credit/top-up or other usable account capacity for Stage 0 and release smoke, with a stated ceiling. The current handoff explicitly says no OpenAI billing change was authorized.
2. **Initial interactive platform claim:** choose between a narrower, evidence-backed first release (for example macOS interactive plus cross-platform headless) and delaying until macOS/Linux/Windows device matrices all pass. Recommendation: do not delay the headless core; advertise only proven interactive platforms.
3. **Smoke isolation:** approve a dedicated `ai-cli-live-smoke` gateway/spend rule if Cloudflare Provider Key attachment and operational overhead are acceptable. Recommendation: use one if it can share/attach the stored-key configuration cleanly; otherwise use metadata plus strict client bounds on `ai-cli`.
4. **Command stability:** accept `ai live` as experimental with required explicit model and no default. Recommendation: yes; convenience defaults can be added only after model/route stability is demonstrated.
5. **Privacy posture:** confirm payload logging disabled by request for live sessions and no audio recording by default. Recommendation: make both non-negotiable defaults.
6. **Release response to a Google platform gap:** if keyless Google BYOK is not supported, decide whether to ship an explicitly OpenAI-only preview or hold the command. Recommendation: hold task completion and do not create a local-key exception; an OpenAI-only preview can be a separately scoped decision.

## 16. Acceptance-criteria traceability

| Backlog criterion | Specification in this report | Required proof |
| --- | --- | --- |
| #1 workflow, selection, terminal audio, cancellation, interruption, errors | Sections 4, 8, 9, 10 | CLI/help tests, state-machine fixtures, manual media matrix |
| #2 OpenAI and Google through Cloudflare stored keys; no local provider credentials | Sections 3, 7, Stage 0 | Poison-secret tests plus successful BYOK-only Cloudflare smoke for both |
| #3 OpenRouter only where documented; unsupported routes pre-spend | Sections 3.4 and 4.6 | Transport-factory spy proves zero network; dated docs review |
| #4 package dependencies or fast exact preflight | Sections 9 and 11.7 | Clean-room package test and supported-OS `--check` evidence |
| #5 deterministic tests for routing/auth/events/audio/interruption/cancel/timeouts/disconnect/errors | Section 11 | Complete no-network Bun suite with fixture coverage map |
| #6 bounded opt-in Cloudflare smoke | Section 12 | Two redacted one-turn evidence records, explicit skip/gate behavior, actual cost |
| #7 all docs and governance files | Stage 3 | Diff review of every named surface and MDX/build checks |
| #8 narrow fork code and upstream-sync boundary | Sections 5 and 13 | Diff confined to live subtree, registration/docs/tests; runbook updated |

## 17. Explicit proof gaps and risks

These are not implementation details to hand-wave; they are the evidence backlog.

1. **Google keyless BYOK WebSocket:** Cloudflare's generic BYOK statement and key-bearing Google example conflict. No successful `/google` session without a client-side provider key was available in this review.
2. **OpenAI account capacity:** the stored key reaches an account with zero usable inference credit according to the repository handoff. Route correctness and account billing errors must be separated.
3. **Current model support through Cloudflare:** provider docs list newer models than Cloudflare's examples. Current explicit model compatibility is unproven for both routes.
4. **OpenAI beta header:** Cloudflare's example still includes it; current provider requirements need an empirical answer.
5. **Realtime payload-log control:** `cf-aig-collect-log-payload: false` is documented generally, but its exact effect on provider-native realtime WebSocket frames needs log inspection.
6. **Realtime BYOK alias behavior:** the repository uses `default`; no alternate alias selection should be promised until documented/tested.
7. **Undici failed-upgrade diagnostics:** custom headers are documented; availability of HTTP response status/body/headers on rejected upgrades is not yet proven sufficient.
8. **Undici/Cloudflare interop under sustained audio:** backpressure, close, message sizes, and long-lived behavior need a spike and live smoke.
9. **Cross-platform media:** exact microphone device discovery, permission prompts, raw playback, and interruption latency have not been tested here.
10. **Package validation:** Bun was unavailable in this report environment, so no typecheck, test, build, or clean-room pack was run.
11. **No live credentials:** no authenticated Cloudflare WebSocket or gateway log was examined here.
12. **Synthetic work-kit history:** source state is available, but useful git history was not, so likely conflict hotspots are inferred structurally rather than measured from prior upstream merges.
13. **Gemini Preview churn:** model ID, thinking configuration, text-input behavior, and event-part behavior may change. Fixtures must be dated and release-time verified.
14. **OpenAI protocol churn:** current event/session field names must be captured from the release-time first-party schema and Stage 0 evidence.
15. **OpenRouter conclusion is date-bounded:** no reviewed official full-duplex WebSocket exists as of 2026-08-30; this must be rechecked before future releases.
16. **Dollar cap limitations:** Cloudflare spend limits are eventually consistent; a client cannot promise an exact pre-spend dollar ceiling for one session solely from the gateway rule.
17. **Audio semantic proof:** valid bytes do not prove the model spoke the requested words. Automated smoke needs output transcription; release still benefits from one human listen.
18. **Accessibility/TTY behavior:** screen readers, non-TTY shells, remote sessions, and terminal control conflicts need explicit manual checks.
19. **System-package remedies:** package-manager commands and executable capabilities change; every advertised install recipe needs validation at implementation time.
20. **Cloudflare retry behavior for WebSockets:** do not assume REST retry settings apply or do not apply; client v1 must remain no-retry regardless.

## 18. Safe stop conditions for the implementation agent

Stop and report rather than weakening requirements when:

- Google requires a provider key in the client URL/header;
- Cloudflare cannot route a current supported OpenAI or Gemini live model;
- the only way to proceed is bypassing Cloudflare;
- an SDK or media library reads local provider keys implicitly;
- a dependency would require unreviewed native postinstall binaries;
- preflight cannot verify a claimed device path before connection;
- an interruption implementation cannot keep provider context aligned with heard audio;
- paid tests would exceed the owner-approved ceiling or require unauthorized billing changes;
- package tests show the published artifact lacks the transport/runtime dependency;
- secrets, raw audio, or transcripts appear in default traces/log payloads.

A partial, accurately scoped OpenAI headless preview is better than a nominal two-provider feature that violates BYOK, but changing the task to that scope is an explicit Patrick decision—not an implementation shortcut.

## 19. Suggested PR sequence

Keep reviews and reversibility strong by using coherent, narrow changes:

1. **Protocol-evidence PR or evidence-only branch:** no user command; Stage 0 scripts/results, then remove disposable scripts or place sanitized findings in `LEARNINGS.md`/`HANDOFF.md`.
2. **Live core PR:** command, strict parser, Cloudflare builder, transport, state machine, provider adapters, headless WAV, deterministic tests, `--check`, experimental docs.
3. **Interactive media PR:** capture/playback/preflight, barge-in, terminal controls, supported-OS docs/tests.
4. **Release-evidence PR:** current model examples, live smoke evidence, final troubleshooting, changelog, backlog completion.

Do not combine an unproven transport dependency change, two provider protocols, three operating-system media stacks, documentation, and paid evidence into one opaque patch.

## 20. First-party references reviewed

Cloudflare:

- [Realtime WebSockets API](https://developers.cloudflare.com/ai-gateway/usage/websockets-api/realtime-api/)
- [WebSockets API overview](https://developers.cloudflare.com/ai-gateway/usage/websockets-api/)
- [BYOK (Store Keys)](https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/)
- [Google AI Studio provider route](https://developers.cloudflare.com/ai-gateway/usage/providers/google-ai-studio/)
- [AI Gateway logging](https://developers.cloudflare.com/ai-gateway/observability/logging/)
- [Spend limits](https://developers.cloudflare.com/ai-gateway/features/spend-limits/)

OpenAI:

- [Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations)
- [Realtime API guide](https://developers.openai.com/api/docs/guides/realtime)
- [Model catalog](https://developers.openai.com/api/docs/models)
- [API pricing](https://developers.openai.com/api/docs/pricing)

Google:

- [Gemini Live API overview](https://ai.google.dev/gemini-api/docs/live-api)
- [Live API capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities)
- [Live API WebSocket reference](https://ai.google.dev/api/live)
- [Get started with Live API WebSockets](https://ai.google.dev/gemini-api/docs/live-api/get-started-websocket)
- [Gemini 3.1 Flash Live Preview model](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-live-preview)
- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)

OpenRouter:

- [HTTP/SSE streaming](https://openrouter.ai/docs/api_reference/streaming)
- [Speech-to-text](https://openrouter.ai/docs/guides/overview/multimodal/stt)

Runtime transport:

- [Undici 7.29 WebSocket documentation](https://raw.githubusercontent.com/nodejs/undici/v7.29.0/docs/docs/api/WebSocket.md)

## Final recommendation

Proceed, but in the following order: **prove Cloudflare's two BYOK WebSocket handshakes; retain Undici unless evidence disqualifies it; ship the isolated headless session core; then add preflighted interactive media.** Treat OpenRouter as a finite streaming provider, not a live transport. Require explicit provider-qualified models, ban fallback, keep local provider keys out of the process boundary, and make “no network request was made” a tested property of every unsupported or failed-preflight path.

That design is faithful to the fork's product model, materially limits upstream merge conflicts, and creates a testable path from deterministic protocol correctness to bounded paid evidence without turning an experimental realtime feature into a dependency or credential exception.
