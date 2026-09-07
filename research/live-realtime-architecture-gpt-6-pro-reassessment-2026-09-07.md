---
date_created: 2026-09-07
date_updated: 2026-09-07
summary: Preserved GPT-6 Pro reassessment of the live OpenAI and Gemini session architecture through Cloudflare AI Gateway.
related:
  - "../backlog/tasks/task-1 - Design-implement-and-test-live-model-sessions.md"
  - ../HANDOFF.md
  - live-realtime-architecture-gpt-5.6-pro-review-2026-08-30.md
  - live-realtime-architecture-gpt-6-pro-standalone-addendum-2026-09-07.md
  - https://chatgpt.com/c/6a9ec974-f74c-83e9-b45d-de71e326e5b6
---

# GPT-6 Pro reassessment: live/realtime capability

This is non-authoritative counsel retained for TASK-1. The report below is preserved verbatim except for two trailing-space Markdown hard breaks normalized to `<br>`. The separately preserved standalone-ownership addendum reconciles the two repository commits that landed while this review was running and supersedes only the statements it identifies.

## Provenance

- Conversation: https://chatgpt.com/c/6a9ec974-f74c-83e9-b45d-de71e326e5b6
- Verified model: `gpt-6-pro`
- Reviewed source tree: `05a4978d1294e84a353b7e9a9565caa1598bc11f`
- Synthetic work-kit commit reported inside Pro: `144544ef6df6dda30268a0ac0d089c1c31cbcd0f`
- Result ZIP SHA-256: `3deb0b48ce99c3c047aa4affe5d73dffb9603bf59f18716ec7e7481c5a442bce`
- Source report SHA-256: `3414f2b35a2f929b93df66208b9c9ab2bb2bfe854743389d4954472cdcba9b0a`

## Preserved report

# TASK-1 live/realtime CLI: independent decision report

**Decision date:** September 7, 2026<br>
**Decision:** Retain the architecture and TASK-1’s scope, with the targeted amendments below. Do not treat this decision as implementation or release acceptance.<br>
**Scope:** The supplied ai-cli repository, its preserved GPT-5.6 Pro report, and current first-party interfaces. No code implementation or account changes.

## 1. Executive decision

The existing plan remains the simplest credible approach for this fork: an experimental **`ai live`** command, **two thin provider-native WebSocket adapters through Cloudflare AI Gateway**, a shared session controller, stored BYOK credentials, a packaged JavaScript transport, and local media preflight before connecting. Keep OpenAI Realtime and Gemini Live separate from the finite generation APIs. Keep OpenRouter out of this full-duplex command unless its documented interface changes. No deployed Worker, browser bridge, voice-agent framework, provider SDK migration, or shared-library redesign is justified by the evidence reviewed. These are architectural recommendations, not vendor endorsement of this CLI. [R1–R5; W1–W4, W8–W13]

The preserved report is sound on its main boundaries and unusually explicit about missing proof. Its details should **not** be adopted verbatim against the newer repository. The material amendments are:

| Area | Decision and exact consequence |
| --- | --- |
| Fork integration | Put new code in `src/fork/live/`, not the proposed `src/lib/live/` plus upstream command subtree. Use the current provider registry and advertise `--gateway` / `--provider`, without importing finite-generation selection or fallback behavior. |
| Protocol contract | Implement current OpenAI GA and a dated Gemini Live profile, not Cloudflare’s aging sample payloads. Keep keyless Gemini and actual model compatibility as release gates. |
| Playback correctness | Replace “written/drained samples = exact heard samples.” Require a measured playback position, or an explicitly approximate, bounded and validated position. Do not claim correct interruption from pipe writes alone. |
| Transport proof | Retain Undici-first, but make real rejected-upgrade diagnostics and forced cleanup a concrete early test. Mocked errors do not prove the packaged transport exposes provider error bodies. |
| Spending and acceptance | Do not automatically enable gateway spend limits. Separate basic route/session smoke from audio-input and interruption acceptance, and replace the speculative 32–64-token target with a model-appropriate bounded test budget. |

Most of this is a tightening of existing acceptance criteria, not a new architecture. TASK-1 should remain **To Do** until implemented and evidenced. A functioning OpenAI-only or headless-only preview would be a separately approved partial scope, not completion of the two-provider full-duplex task. [R1; R2:1332–1372]

## 2. Evidence baseline and limits

### Repository identity

The supplied bundle is `ai-cli-05a4978d1294-pstack-work-kit.bundle`, SHA-256:

```text
5e85a15885c14e8c6806cc72e9e8b2224815fa8ccc1cc2db81c26ee248690f24
```

Its advertised branch is `refs/heads/pstack-work-base`, checked out at synthetic commit `144544ef6df6dda30268a0ac0d089c1c31cbcd0f`, tree `ee11786588e96e26ae4211a771bafd560e0e5661`. The commit records source base `05a4978d1294e84a353b7e9a9565caa1598bc11f` on `main`. The synthetic January 1, 2000 timestamp is not a source freshness date. The bundle supplies the tracked tree, not useful upstream merge history; conflict-risk conclusions below are structural.

I read the repository instructions (`AGENTS.md` → `CLAUDE.md`), SPEC, TASK-1, the preserved report, HANDOFF, LEARNINGS, installation and upstream-sync documentation, and relevant command, routing, provider, configuration, progress and test code. TASK-1 is unimplemented: the entry point registers the existing commands and diagnostics, not `live`. [R1:34–67; R6:1–35]

The current HANDOFF reports 294 CLI, 20 website and 8 library tests, successful builds/typechecking/formatting, and 25 existing lint warnings. Those are **repository-recorded results, not tests rerun for this review**. Its “Live Acceptance Matrix” concerns actual finite provider calls; it does not demonstrate native Realtime or Live WebSockets. The September 7 update supersedes the older spend-limit state, but supplies no new realtime acceptance evidence. [R7:18–28,58–82]

The preserved report reviewed an older source base, `b67c88fdbe142440d7ed8e13d052389e8731ce79`. Its current tracked bytes hash to `710de5212456798e99ee40fe8886c722c2db423f1ad5be23baae6102eba1b11f`. Preserve that historical report; use a new dated decision record and TASK-1 amendments rather than rewriting what the earlier reviewer observed. [R2:1–30]

### What was actually validated here

`git bundle verify` passed; `git fsck --full` completed without reporting corruption; the checked-out tree was clean and contains 164 tracked files. Current official documentation and pinned Undici source were inspected. Node 22.16.0 is available, but Bun and installed repository dependencies are absent. No dependency installation, build, typecheck, application tests, microphone/speaker tests, authenticated WebSocket, provider inference, gateway-log inspection or account-state query was performed. The ZIP is separately integrity-checked at delivery.

## 3. Official routing and authentication: retain the native paths

### Supported route contract

| CLI provider selection | Cloudflare WebSocket endpoint | Provider key and model placement |
| --- | --- | --- |
| `openai/<native-model>` | `wss://gateway.ai.cloudflare.com/v1/{account}/{gateway}/openai?model={encoded-model}` | Stored OpenAI `default` key; native model in the query. |
| `google/<native-model>` | `wss://gateway.ai.cloudflare.com/v1/{account}/{gateway}/google` | Stored Google AI Studio key, conditional on keyless route proof; native model in the Google setup message. |
| `openrouter/<creator>/<model>` | No native full-duplex route admitted by this decision | Reject locally. An OpenAI or Google creator prefix does not change the OpenRouter host or billing account. |

Cloudflare still documents `/openai` and `/google` as provider-native realtime routes and says its realtime WebSocket API supports BYOK. Its Google sample nevertheless contains `api_key`, while its OpenAI sample uses a preview model and beta header. The page’s April 20, 2026 update predates Google’s September 4 Live documentation. This is an **example/evidence mismatch**, not proof that keyless Google fails. Preserve the original release gate: establish a successful `/google` session with no client provider credential before claiming support. Do not “repair” failure by adding a Google key. [W1; W8–W10]

The existing finite Google URL is `/google-ai-studio/v1beta`; it must remain unchanged. Do not derive the Google live URL by substituting `wss` into the finite base URL. Cloudflare’s non-realtime WebSocket endpoint is likewise not an interchangeable native voice protocol. [R5:40–55; R9:81–95; W4]

### Credential policy

Send the Cloudflare gateway token using `cf-aig-authorization: Bearer …`. Request metadata-only logging with `cf-aig-collect-log-payload: false`. Do not send local OpenAI/Google/OpenRouter keys, provider `Authorization`, `x-goog-api-key`, credential query parameters, or a placeholder provider key. A raw WebSocket adapter does not need the placeholder that existing finite SDK constructors require. Build the allowed gateway URL and headers explicitly; do not expose an arbitrary remote endpoint override in the public CLI. [R3:17–24; R9:59–78; W1–W3]

Cloudflare now explicitly documents `cf-aig-byok-alias` for selecting a non-default key on provider-passthrough requests. Thus “there is no documented alias header” would be inaccurate. **No new alias feature is needed here**: the repository’s policy is `default`, and realtime alternate-alias behavior has not been demonstrated. Keep the existing default and verify the stored key path rather than broadening the command. [R3:18; W2]

Offline preflight can establish that configuration is present and locally valid; it cannot establish that the token, stored key, provider credit or model actually works. Do not call inventory/catalog APIs merely to open an explicit live route. The repository already distinguishes Run-only tokens from tokens able to read Provider Keys. A privileged release-time evidence check must not become an ordinary user’s additional credential requirement. [R8; R10:285–289]

### OpenRouter: update the wording, not the architecture

OpenRouter documents audio input and **streamed audio output** through HTTP chat completions; audio output requires streaming and arrives as audio deltas. Its LiveKit integration positions OpenRouter as the LLM component alongside separate STT/TTS/VAD components. Neither establishes a provider-native full-duplex session endpoint matching TASK-1. Cloudflare’s realtime provider list also does not name OpenRouter. [W1, W11–W13]

The accurate statement is: **OpenRouter supports finite HTTP/SSE multimodal requests, including streamed audio on compatible models; no official native full-duplex OpenRouter route was established by this September 7 review.** That is not a claim that OpenRouter can never add one. Do not silently compose an STT → LLM → TTS pipeline or advertise the existing CLI as already implementing every OpenRouter audio capability. Reject `ai live --provider openrouter …` before discovery, WebSocket construction or inference.

## 4. Fit the newer repository without widening the upstream boundary

### Placement and ownership

The earlier report proposed `src/lib/live/` and `src/commands/live.ts`. Since then, SPEC and `src/fork/README.md` have established `src/fork` as the owner of new fork behavior, and `providers.ts` as the executable provider contract. Follow that boundary. [R2:45–55; R3:23–24,37; R4:9–11,40–64]

The intended new implementation boundary is:

```text
packages/ai-cli/src/fork/live/
  command / controller / transport / preflight / audio
  openai adapter / google adapter / colocated tests
packages/ai-cli/src/fork/providers.ts   # small capability metadata extension
packages/ai-cli/src/index.ts           # import + command registration
```

These names describe responsibilities, not a mandate to create one file per noun. Keep the shared controller limited to lifecycle, input/output ownership, deadlines and cleanup. Adapters own native setup, event parsing and interruption semantics. Do not build a universal realtime SDK or relocate existing finite transport code merely to make folders symmetrical.

Add a small optional live capability record to the existing provider definitions: protocol identifier and dedicated WebSocket path, with explicit experimental/unverified status until acceptance. Do not reinterpret finite `speech` or `transcription` modalities as live capability, and do not overwrite Google’s finite `path`. The registry identifies supported hosts; adapters implement their protocols. Model IDs and verified protocol profiles remain explicit and dated, not an inference from a creator name or catalog modality. [R5:1–22,25–70]

Reuse `resolveGatewayBackend` and `resolveCloudflareGatewayConfig`; do not duplicate token precedence or move live protocol policy into the pinned bricks library. Nothing here requires changing existing language/media factories, model catalogs, fallbacks, Workers AI, the Mac auth launcher or shared preferences. [R9:64–95; R3:33–37]

### Preserve the CLI’s selection vocabulary, not its finite policy

Proposed command forms, **not commands available in this checkout**:

```sh
ai live -m openai/<native-realtime-model>
ai live --provider google -m <native-live-model>
ai live --gateway cloudflare --provider openai -m <native-realtime-model> --check
ai live -m google/<native-live-model> --no-mic --no-play --record reply.wav "Say hello."
```

As in the current CLI, `--provider` makes `--model` a native ID; otherwise require a full provider route. Strip only the host segment. Explicit gateway selection overrides the environment; an effective `vercel` selection is rejected for live v1, not silently redirected to Cloudflare. Reject missing/ambiguous models, multiple comma-separated models, unsupported providers and incompatible flags locally. Do not auto-select the finite text default. A retained `AI_CLI_LIVE_MODEL` may provide an explicit full route, but must not import finite defaults or aliases. [R3:23; R11:27–69]

Do **not** attach the current full `addRoutingOptions` wrapper to live: it also adds best/free/cheapest selection and fallback options, and its action invokes selection/recovery policy. Reuse only the narrow gateway/provider semantics, with small live-owned registration. No automatic retry, reconnection, replay, provider switch, catalog discovery or saved fallback is appropriate in this first stateful session command. [R11:71–190; R2:890–901]

The earlier report’s caution about `Progress` remains sensible, but a broad progress refactor is unnecessary: signal handlers are installed by `Progress.start` / `MultiProgress.addLine`, not by merely importing the module. Live should own removable handlers and avoid starting finite-job progress. Complete cleanup before returning to the existing top-level error handler, which calls `process.exit(1)`. [R6:29–35; R12:7–18,50–63,120–132]

## 5. Protocol details that must not be copied from old examples

**OpenAI:** use the GA session shape (`type: "realtime"`, nested audio configuration) and current output event names such as `response.output_audio.delta` and `response.output_audio_transcript.delta`. Wait for effective setup acknowledgement before enabling input. Do not add `OpenAI-Beta: realtime=v1` or silently fall back to beta because Cloudflare’s sample contains it. A requirement for beta on the actual gateway is a compatibility finding to resolve, not a license to mix schemas. OpenAI’s separate Responses WebSocket API is not a replacement for its conversational audio Realtime API. [W5–W7]

Fixture the actual response status, not just an event named “done.” OpenAI’s client reference specifies cancellation completion through `response.done` with cancelled status; its conversation guide also mentions `response.cancelled`. This inconsistency is a reason to use the formal reference plus captured protocol evidence, not to await only the latter spelling. A cancelled, failed or incomplete response is not successful one-turn completion. Audio/transcript completion is also distinct from physical playback drain. [W6, W7]

**Google:** select one documented Live profile and exercise it through Cloudflare. Current guidance distinguishes Gemini 3.1 Flash Live Preview from 2.5 native-audio profiles: for 3.1, runtime text uses realtime input, initial `clientContent` history has special setup rules, a server event can contain multiple parts, and thinking configuration differs. The original report already anticipated much of this; keep that native handling rather than designing a lowest-common-denominator payload. [W9]

Wait for `setupComplete`; process every relevant part and field of each message. Do not treat `generationComplete` as `turnComplete`, or return early after finding audio and thereby lose transcription/interruption information. Interpret `goAway.timeLeft` as time until disconnection, **not a retry delay**. No automatic resumption in v1. Do not manufacture an OpenAI-style truncation event for Google. [W10]

Keep the PCM plan: signed 16-bit little-endian mono; OpenAI input/output at 24 kHz, Google canonical input at 16 kHz and output at 24 kHz. Framing must tolerate arbitrary source chunk boundaries. Twenty milliseconds corresponds to 960 input bytes at 24 kHz or 640 at 16 kHz; these are chosen client frame sizes, not a claim that providers demand precisely 20 ms. [W6, W8; arithmetic]

Do not silently switch to every newly announced audio model. Dedicated transcription or translation protocols are not automatically conversational Realtime. Examples should name the exact model/profile actually tested, with a date. Provider documentation proves an interface exists; it does not prove that model is supported by this gateway or funded account.

## 6. Installation, preflight and the playback correction

### Keep the package/preflight split

Package the JavaScript transport in the built CLI. Keep typed-input/WAV-output mode independent of system audio tools. For microphone/speaker mode, retain capability-based external media preflight. Do not add native audio npm modules, download binaries during execution, require a Worker or invoke an installer automatically. [R1:39,51; R2:45–46]

Correct the old report’s phrase “native-dependency-free npm artifact” to **“no new native media dependency.”** This package already depends on `sharp`. It also now pins the private `@patricksrail/bricks` Git dependency. That existing installation/access requirement must be included in clean-room package acceptance, rather than claiming an anonymous install of the upstream public package verifies this fork. Preserve the documented invocation-scoped Git credential-helper route; do not introduce global Git changes or printed tokens. [R13:45–56; R10:480–489; R8:108–110]

Homebrew’s current standard `ffmpeg` formula explicitly enables `ffplay`, so the macOS remedy `brew install ffmpeg` remains justified; a compulsory switch to `ffmpeg-full` is not. Nevertheless, executable presence is only one preflight condition. Actual capture backend, selected devices, permission, format and playback launch must work. Test recipes on each advertised OS and provide exact remediation for the failed capability; do not advertise untested Windows or Linux device paths. [W17, W18]

Preflight order should be: parse/validate selection → resolve local Cloudflare configuration → verify input/output files → check the packaged client can load → validate only the requested local audio capabilities → connect. A capability check must **not instantiate a WebSocket**; construction initiates a connection. `--check` makes zero network requests and reports “locally ready, remote access unverified,” never “authenticated.” A bounded local capture probe is discarded, not transmitted; ordinary microphone streaming starts only after provider setup. Headless mode skips device checks. [W14; design recommendation]

### Undici-first is retained, with a specific decision gate

The pinned `undici@7.29.0` documents custom WebSocket headers, so there is no evidence-based reason to replace it solely for authentication. However, its rejected-upgrade source path collapses non-101 responses into a generic failure; the stock WebSocket error alone does not establish access to the HTTP status/body needed by TASK-1. [R13:54; W14–W15]

Before paid probing, exercise the **real installed transport** against a loopback upgrade server returning representative 401/403/429/5xx responses, bounded provider-style error bodies, close failures and delayed upgrades. Establish safe diagnostic extraction through supported public APIs and bounded termination. If that needs private Undici internals or disproportionate machinery, use a dedicated WebSocket client behind the same tiny interface. This preserves the original conditional dependency decision; it does not pretend mocks have resolved it. Never issue a second paid inference request just to recover an error body.

### Required correction: written is not heard

The preserved report, lines 858–873, computes heard duration from samples accepted/written/drained by a playback sink and calls that result exact. **That is not a valid guarantee for a child-process pipe.** Node stream completion describes movement through the stream/underlying system; it does not acknowledge rendering by the audio device. FFplay has further media buffering, and OpenAI can generate audio faster than it is played. [R2:858–873; W6, W16, W18]

Replace that prescription with:

> Track received, queued, submitted and rendered audio separately, by assistant item. Derive OpenAI `audio_end_ms` from the playback adapter’s rendered-position contract. A measured position is preferred. A conservative estimate is acceptable only when its latency/error bound has been demonstrated on the supported backend and is disclosed as approximate; pipe `write`, callbacks and `drain` are not rendering acknowledgements. Stop and clear playback on interruption, ignore late chunks for the interrupted item, and truncate the correct assistant item. Do not label generated transcript as exactly what the user heard.

Retain external playback provisionally; do not mandate a new native dependency before trying the actual backend. But **interactive full-duplex acceptance must wait** if the chosen backend cannot keep interruption/context alignment within a documented tolerance. A passing headless smoke cannot waive this requirement. Headphone-based acceptance is a reasonable initial scope; do not claim acoustic echo cancellation merely because microphone and speaker processes both run.

Bound queues and output size. Keep a short playback submission queue distinct from the larger bounded received-response buffer: rejecting every response that arrives faster than playback would incorrectly reject normal behavior. On graceful one-turn completion, drain the selected output and close normally. On cancellation, stop output promptly and label partial artifacts/transcripts. All exits must terminate children, finalize or remove recordings appropriately, restore terminal/input state, remove handlers and close the transport.

## 7. Credible tests: five distinct evidence levels

The following is the acceptance design, **not a list of tests performed here**.

### A. Deterministic, network-free contract tests

Use injected transport, clock, audio, filesystem and signal dependencies as planned. Cover routing and credential isolation; exact native setup/events; multipart Google messages; PCM chunk boundaries and WAV headers; response statuses; barge-in races; deadlines; provider errors; cleanup and idempotence. Assert zero transport/catalog construction for help, invalid routes and `--check`. Poison provider-key variables and verify neither serialization nor diagnostic output exposes them; test access boundaries rather than merely checking that one known header is absent.

Playback tests must distinguish 10 seconds received, 2 seconds submitted and a smaller rendered duration. Verify truncation uses the rendered contract, not either byte count. Include cancellation after remote generation finishes but while local playback continues. Normal completion, malformed JSON, wrong-rate audio, output-file failures, early remote close, repeated signals and late events all need explicit outcomes.

### B. Real transport and process tests, no external network

Keep the default unit suite entirely network-free. Add a separately labelled loopback-only suite to prove actual handshake headers, failed-upgrade status/body handling, message delivery and teardown. It uses no external service or provider credentials. Fixtures are not a substitute for this transport-level proof.

Spawn the actual command as a child and require normal process exit, not just expected output. Record milestones for process start, local readiness, socket open, setup acknowledgement, first output, terminal turn, close and exit. A timeout must distinguish startup delay from post-output nontermination. Bound close/kill cleanup and retain stdout/stderr plus safe error codes. Give each launch its own budget and ensure enclosing multi-launch tests allow their sum; a valid JSON result followed by a hung process fails.

### C. Built package and installation acceptance

Existing CLI tests launch `bun run src/index.ts`; their published-bin check is metadata, not execution of the packaged artifact. Keep those tests and add a clean-directory installation of the actual fork package, using authorized private-dependency access as necessary. Run the installed built JavaScript under Node at the declared minimum and a current supported LTS, without Bun, repository source, undeclared development dependencies or system FFmpeg in the headless test. Verify transport availability, offline help/check behavior, fake-session execution and exit. [R14:5–35; R13:11–20,34–56]

Separately verify the Mac launcher from a fresh shell without per-command credential sourcing; it must still load only Cloudflare assignments and run the rebuilt command. Do not put that personal launcher’s filesystem assumptions into the portable package. [R10:435–442; R15:1–33]

### D. Explicitly authorized, bounded Cloudflare smoke

Keep the two-part paid gate from the report, explicit model selection, one session per provider in the basic smoke, no client retries/fallback, no microphone/speaker/tools, a short typed prompt, temporary WAV output, short fixed wall-clock deadline and a bounded model-appropriate output allowance. Absence of the opt-in gates is a visible **skip**. Once opted in, missing required configuration is a setup failure, not a passing skip. Provider credit/quota or gateway incompatibility is a **blocked acceptance result**, with safe original diagnostics—not successful inference. [R2:1050–1120]

Success requires a keyless Cloudflare request, provider setup acknowledgement, nonempty correctly framed audio, meaningful output transcription for the requested short utterance, terminal success, finalized artifact and normal process exit. Record the explicit model/profile, OS/Node/package version, input/audio limits, timing phases, native completion reason, usage and available gateway correlation evidence. A 101 upgrade, valid WAV header or cached finite HTTP success alone is insufficient.

Do not adopt 32–64 output tokens as a universal target. The repository already records a finite Gemini probe whose 64-token budget was consumed by reasoning; this does **not** prove the same Live failure, but it disproves the assumption that such a cap is universally safe. Choose the smallest demonstrated sufficient allowance for each tested Live profile, with appropriate supported thinking settings. A token-truncated result must be diagnosed as such, not relabelled an auth failure or rerun until green. [R8:69; W9]

### E. Audio-input and interactive acceptance

A typed-input/audio-output smoke verifies a native session and downlink, **not the audio uplink or barge-in**. Before claiming TASK-1’s full-duplex result, add an owner-authorized bounded prerecorded-PCM test for each provider, and an interactive supported-OS session that verifies microphone capture, intelligible playback, interruption/context alignment, subsequent-turn recovery and Ctrl-C cleanup. Reuse sessions where this preserves unambiguous evidence; do not automatically multiply paid probes. Manual evidence must state what was observed, not simply “audio works.”

The prerecorded fixture must have known speech, correct provider rate and realistic pacing, plus an explicit end-of-input policy. Pure tones or valid base64 prove framing, not speech understanding. A human listen can validate intelligibility; it does not replace deterministic event/lifecycle coverage.

## 8. Spending, privacy and unresolved release gates

### Do not assume an enabled spending control

The preserved report recommends enabling Cloudflare spend limits as a second guard. The newer HANDOFF records `spend_limits.enabled: false`, with authentication still enabled. LEARNINGS records a Workers AI-filtered rule producing cross-provider HTTP 403/code 2040 model-resolution failures; that is not the documented 429 exhausted-budget response. These are historical repository observations, not current account queries made here. [R7:22–28; R8:93–105]

**Replacement policy:** leave existing account settings alone. Obtain owner approval for the exact paid-test allowance. Use one-turn/input/output/time bounds and no retries. A separately authorized, verified gateway/provider budget is an optional additional control, not a CLI-created prerequisite. Do not enable Workers AI, change plans, buy credits, create a gateway, attach keys or weaken authentication automatically. A dedicated smoke gateway is optional operational isolation, not necessary architecture.

Cloudflare says spend accounting is eventually consistent and a request’s usage is recorded after completion. A timeout, token limit or after-the-fact cost assertion is not a guaranteed per-session dollar hard cap. The runner should report bounds and actual/estimated usage honestly, stop further attempts on unexpected usage, and require explicit approval where no hard account-side cap exists. Do not reuse the old report’s illustrative dollar amounts as current pricing. [W19]

The old OpenAI zero-credit finding is still a **recorded acceptance blocker**, not proof of the account’s balance today. Confirm authorized capacity before a paid test; do not infer it from a listed key or successful catalog. [R7:60–66]

### Privacy requires evidence beyond sending a header

Cloudflare documents `cf-aig-collect-log-payload: false` as retaining metadata while suppressing request/response payload collection. Keep the header, default local recording off, and default traces limited to event types/timings/safe codes. But verify its actual effect on realtime frames before advertising payload suppression for these routes. Sending the header is evidence of intent, not evidence that the gateway honored it. [W3]

The owner’s release evidence should establish stored-key selection and relevant gateway log behavior without exporting secrets or full sensitive configuration. Use correlation data only where actually exposed. Provider retention is a separate policy; metadata-only gateway logging is not a zero-retention promise. Failure to prove keyless Gemini or required privacy behavior remains a release blocker, not a reason to bypass Cloudflare.

Remaining owner decisions are those TASK-1 already names: approval of experimental UX, supported interactive OS/backend scope, recording/privacy policy, funding/gateway for paid evidence, and whether to authorize an explicitly narrower preview if a route is blocked. No additional platform or framework choice needs to be invented now. [R1:67]

## 9. Exact proposed changes — not applied

### 9.1 TASK-1

Keep the title, description, status, provider scope and all eight acceptance obligations. Replace the six-item Implementation Plan with:

1. **Prove transport locally, then prove native routing with authorization.** Exercise the pinned Undici client against loopback upgrade/error/cleanup fixtures. Use an explicitly paid-authorized disposable spike to establish the current OpenAI GA and Google Live routes through Cloudflare, especially Google keyless BYOK. Keep original errors and stop rather than introducing provider credentials or bypasses.
2. **Add the experimental command behind the current fork boundary.** Put live command/controller/adapters/tests under `packages/ai-cli/src/fork/live/`, use a small registration hook and the central provider registry, and reuse existing Cloudflare configuration. Accept explicit full routes or `--provider` plus a native model ID; advertise `--gateway` and reject unsupported effective gateways. Do not inherit finite defaults, catalogs, aliases or recovery.
3. **Package the client and preflight media locally.** Keep typed-input/WAV-output mode self-contained, add no new native media dependency by default, and validate requested external device capabilities before WebSocket construction. Establish a truthful rendered-position contract for interruption; written/drained bytes are not heard samples.
4. **Prove protocol and lifecycle deterministically.** Retain injected network-free tests, add separate real loopback transport tests, and cover native schemas, auth isolation, framing, interruption/playback accounting, cancellation, phase deadlines, provider errors and normal process exit. Exercise both the source entry point and installed built artifact.
5. **Run separately authorized acceptance tiers.** Use one bounded headless Cloudflare smoke per provider with no client retries, microphone, playback or tools. Use model-appropriate output limits and request payload suppression. Before full-duplex acceptance, also prove prerecorded audio input and supported-OS microphone/playback/interruption. Record skips, blocked results and failures distinctly. Do not mutate gateway or billing settings.
6. **Document verified behavior and the narrow merge boundary.** Update README/package and website docs, CHANGELOG, HANDOFF, LEARNINGS and upstream-sync guidance; preserve the historical Pro report and link the dated reassessment. Mark models, OS/backend coverage, BYOK and privacy claims according to evidence, not planned support.

Append these clarifying sentences to the corresponding existing acceptance criteria:

- **#1:** “Selection follows the current gateway/provider vocabulary without finite-session defaults or automatic recovery; playback accounting distinguishes submitted audio from rendered audio.”
- **#4:** “Headless mode is exercised from the installed built artifact without system audio tools; `--check` performs no network request and does not claim remote authentication.”
- **#5:** “Network-free fixture coverage is supplemented by separately labelled loopback transport tests and subprocess normal-exit tests; fixture errors alone do not prove real rejected-upgrade diagnostics.”
- **#6:** “A typed-output smoke is not full-duplex acceptance: audio input and supported-OS interruption require their own evidence. Model-appropriate bounds, terminal outcomes and cleanup are recorded; account settings are never changed automatically.”
- **#8:** “The intended boundary is `src/fork/live/`, the central provider registry and a small entry-point registration hook; existing finite factories and shared-library policy are not refactored for this feature.”

Keep acceptance criteria #2, #3 and #7 unchanged. Retain Undici-first in Implementation Notes, adding “including real failed-upgrade diagnostics and bounded cleanup.” Clarify OpenRouter’s note to include finite streamed audio, and change “payload logging off” to “request payload suppression and verify realtime log behavior before claiming it.” Add this report to task references. These edits strengthen the task without removing any existing coverage or deciding unresolved owner permissions.

### 9.2 Documentation and future implementation touch points

| File/surface | Proposed change |
| --- | --- |
| Preserved `research/live-realtime-architecture-gpt-5.6-pro-review-2026-08-30.md` | Leave historical body unchanged. Link a separate dated reassessment from TASK-1 and current handoff. |
| `src/fork/README.md`, `docs/upstream-sync.md` | Document live ownership and the narrow registry/entry-point hooks. Do not promise conflict-free upstream merges. |
| `src/fork/providers.ts` | Small optional live protocol/path metadata, separate from existing finite paths and modalities; advertise implemented coverage only. |
| `src/index.ts` | One import/registration seam; no live lifecycle, credential or fallback logic here. |
| `package.json`, `bun.lock` | No dependency change now. Change only if the transport spike justifies a different client; preserve exact pinning and package verification. |
| Root/package README and relevant website command/model/troubleshooting pages | Experimental UX, gateway/provider forms, exact tested models, honest OpenRouter role, headless versus interactive requirements, tested install remedies and privacy limitations. |
| HANDOFF / LEARNINGS / CHANGELOG | Record actual implementation and acceptance outcomes when performed. Do not turn current research into a release-success claim. Preserve historical billing/auth findings. |

No edits are recommended to existing finite routing defaults, the canonical bricks preferences, Workers AI’s disabled state, the local auth launcher or finite progress machinery as a prerequisite for TASK-1.

## 10. Release decision and evidence references

**Architecture approved with amendments; implementation and release not approved by this review.** The remaining gates are concrete: real transport diagnostics/cleanup, keyless current-model sessions on both native Cloudflare routes, built-package readiness, audio-input and supported-OS interruption proof, and verified privacy behavior under an owner-authorized spending arrangement. Preserve the original design wherever those tests support it; revisit only the failing boundary, not the entire architecture.

### Repository references

All paths and line numbers below refer to the supplied synthetic checkout identified in section 2. They are reproducible local evidence, not claims about a different remote revision.

| ID | Evidence location |
| --- | --- |
| R1 | `backlog/tasks/task-1 - Design-implement-and-test-live-model-sessions.md`, lines 28–67: description, eight criteria, plan and unresolved decisions. |
| R2 | `research/live-realtime-architecture-gpt-5.6-pro-review-2026-08-30.md`: provenance 1–30; main decision 35–68; playback 858–875; deadlines/recovery 877–901; testing 903–1120; proof gaps and stop conditions 1332–1372. |
| R3 | `SPEC.md`, lines 17–24 and 31–37: BYOK, selection vocabulary, fork ownership, shared preferences and central provider registry. |
| R4 | `packages/ai-cli/src/fork/README.md`, lines 9–20 and 40–79: fork responsibilities, source ownership and existing integration boundaries. |
| R5 | `packages/ai-cli/src/fork/providers.ts`, lines 1–70: executable provider metadata, finite paths and authentication distinctions; 102–125: Workers AI disabled. |
| R6 | `packages/ai-cli/src/index.ts`, lines 1–35: current registrations and top-level error exits. |
| R7 | `HANDOFF.md`, lines 18–43 and 58–82: installed command, September 7 validation/account update, stored keys and finite acceptance matrix. |
| R8 | `LEARNINGS.md`, provider discovery discussion and lines 65–69, 93–110: Run/read distinctions, short Gemini probe, gateway-update hazards, spend-limit finding and private dependency installation. |
| R9 | `packages/ai-cli/src/lib/gateway.ts`, lines 59–95: finite SDK placeholder, exported config resolvers and finite provider URL construction. |
| R10 | `README.md`, lines 285–307, 435–442 and 480–489: routing, Run-only tokens, Mac launcher and private-library install. |
| R11 | `packages/ai-cli/src/fork/options.ts`, lines 27–190: scoped gateway override, native ID qualification, aliases and combined selection/recovery wrapper. |
| R12 | `packages/ai-cli/src/lib/progress.ts`, lines 7–18, 50–63 and 120–132: lazy global signal registration and finite progress lifecycle. |
| R13 | `packages/ai-cli/package.json`, lines 11–20 and 34–63: Node range, packaged files, scripts, pinned Undici/sharp/private bricks dependencies. |
| R14 | `packages/ai-cli/src/cli.test.ts`, lines 5–35: Bun source execution and package metadata assertions. |
| R15 | `scripts/mac-ai.mjs`, lines 1–33: local-only launcher, Cloudflare assignment filtering and built entry point. |

### Current first-party references

All sources below were retrieved on **September 7, 2026**. A source establishes its documented interface, not successful execution in this environment. The dates noted for W1/W8/W9 help distinguish older gateway examples from current provider schemas. No third-party tutorial is used as API authority.

| ID | Source and use |
| --- | --- |
| W1 | [Cloudflare: Realtime WebSockets](https://developers.cloudflare.com/ai-gateway/usage/websockets-api/realtime-api/) — native routes, provider list, BYOK/authentication statement and key-bearing/stale samples; page updated April 20, 2026. |
| W2 | [Cloudflare: Bring Your Own Keys](https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/) — stored keys, default alias and documented `cf-aig-byok-alias`; updated July 31, 2026. |
| W3 | [Cloudflare: Logging](https://developers.cloudflare.com/ai-gateway/observability/logging/) — metadata and payload collection, `cf-aig-collect-log-payload`. |
| W4 | [Cloudflare: Non-realtime WebSockets](https://developers.cloudflare.com/ai-gateway/usage/websockets-api/non-realtime-api/) — separate non-realtime protocol. |
| W5 | [OpenAI: Realtime and audio](https://developers.openai.com/api/docs/guides/realtime) and [Responses WebSocket mode](https://developers.openai.com/api/docs/guides/websocket-mode) — GA migration and separate API purposes. |
| W6 | [OpenAI: Realtime client events](https://developers.openai.com/api/reference/resources/realtime/client-events/) — GA configuration, PCM format, cancel and truncate contracts. |
| W7 | [OpenAI: Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations) and [Realtime over WebSocket](https://developers.openai.com/api/docs/guides/realtime-websocket) — native event lifecycle, playback responsibilities and server-side connection approach. |
| W8 | [Google: Live API overview](https://ai.google.dev/gemini-api/docs/live-api) — stateful streaming, audio formats and Preview scope; updated September 4, 2026. |
| W9 | [Google: Live capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities) — 3.1/2.5 profile differences, realtime text and multipart handling; updated September 4, 2026. |
| W10 | [Google: Live WebSockets reference](https://ai.google.dev/api/live) and [raw WebSocket quickstart](https://ai.google.dev/gemini-api/docs/live-api/get-started-websocket) — setup, turn semantics, history and `goAway.timeLeft`. |
| W11 | [OpenRouter: Audio](https://openrouter.ai/docs/guides/overview/multimodal/audio) — finite audio input and streaming output. |
| W12 | [OpenRouter: Streaming](https://openrouter.ai/docs/api_reference/streaming) — HTTP/SSE response streaming. |
| W13 | [OpenRouter: LiveKit integration](https://openrouter.ai/docs/guides/community/livekit) — LLM role within a larger voice pipeline, not a native full-duplex API claim. |
| W14 | [Undici 7.29.0 WebSocket documentation](https://raw.githubusercontent.com/nodejs/undici/v7.29.0/docs/docs/api/WebSocket.md) — pinned client constructor, options and custom headers. |
| W15 | [Undici 7.29.0 connection source](https://raw.githubusercontent.com/nodejs/undici/v7.29.0/lib/web/websocket/connection.js) — non-101 failure path and the diagnostic limitation to test. |
| W16 | [Node 22 stream documentation](https://nodejs.org/docs/latest-v22.x/api/stream.html) — write, drain and finish semantics; not audio rendering acknowledgements. |
| W17 | [Homebrew FFmpeg formula](https://raw.githubusercontent.com/Homebrew/homebrew-core/master/Formula/f/ffmpeg.rb) and [installation page](https://formulae.brew.sh/formula/ffmpeg) — standard formula enables FFplay; current installation remedy. |
| W18 | [FFplay documentation](https://ffmpeg.org/ffplay.html) — SDL player, buffering and playback controls; no inference that pipe completion proves rendered samples. |
| W19 | [Cloudflare: Spend limits](https://developers.cloudflare.com/ai-gateway/features/spend-limits/) — BYOK coverage, 429 exhaustion and eventually consistent post-request accounting. |

**Final recommendation:** Keep TASK-1’s native-first design. Correct its current-repository fit and the few unsound or unproven details; do not replace it with a more elaborate platform, relax BYOK, or describe documentation and mocks as live acceptance.
