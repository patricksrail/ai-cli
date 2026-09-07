---
id: TASK-1
title: 'Design, implement, and test live model sessions'
status: To Do
assignee: []
created_date: '2026-08-31 05:04'
updated_date: '2026-09-07 14:58'
labels:
  - needs-patrick
dependencies: []
references:
  - >-
    https://developers.cloudflare.com/ai-gateway/usage/websockets-api/realtime-api/
  - 'https://developers.openai.com/api/docs/models/gpt-realtime'
  - 'https://ai.google.dev/gemini-api/docs/live-api'
  - 'https://openrouter.ai/docs/guides/overview/multimodal/audio'
  - research/live-realtime-architecture-gpt-5.6-pro-review-2026-08-30.md
  - 'https://chatgpt.com/c/6a950b86-8164-83e9-89c0-b18cfa75525e'
  - research/live-realtime-architecture-gpt-6-pro-reassessment-2026-09-07.md
  - 'https://chatgpt.com/c/6a9ec974-f74c-83e9-b45d-de71e326e5b6'
  - >-
    research/live-realtime-architecture-gpt-6-pro-standalone-addendum-2026-09-07.md
documentation:
  - HANDOFF.md
  - docs/upstream-sync.md
  - packages/ai-cli/README.md
priority: medium
type: feature
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add an upstream-friendly live/realtime capability to ai-cli for full-duplex provider-native sessions through the default Cloudflare AI Gateway backend. Cover OpenAI Realtime and Google Gemini Live, establish the supported role of OpenRouter from current official capabilities, and decide whether installation packaging or a runtime preflight is needed. Keep provider credentials in Cloudflare BYOK and isolate fork-specific integration so upstream updates remain easy to merge.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The design documents the user-facing session workflow, model/provider selection, terminal audio behavior, cancellation, interruption handling, error recovery, and unsupported combinations. Selection follows the current gateway/provider vocabulary without finite-session defaults or automatic recovery; playback accounting distinguishes submitted audio from rendered audio.
- [ ] #2 OpenAI Realtime and Google Gemini Live sessions route through Cloudflare AI Gateway using stored provider keys; ai-cli does not read, persist, or forward local provider credentials in Cloudflare mode.
- [ ] #3 OpenRouter support is implemented only for realtime capabilities documented by OpenRouter; unsupported full-duplex model routes fail before spending credits with an actionable explanation.
- [ ] #4 A normal ai-cli install contains every required runtime client and media dependency, or the command performs a fast preflight that names the missing system capability and exact remedy; users do not discover missing clients after a paid session starts. Headless mode is exercised from the installed built artifact without system audio tools; `--check` performs no network request and does not claim remote authentication.
- [ ] #5 Deterministic tests cover provider routing, WebSocket authentication, event translation, audio framing, interruption, cancellation, timeouts, disconnects, and provider error bodies without network access or paid inference. Network-free fixture coverage is supplemented by separately labelled loopback transport tests and subprocess normal-exit tests; fixture errors alone do not prove real rejected-upgrade diagnostics.
- [ ] #6 Opt-in Cloudflare smoke tests prove one OpenAI Realtime session and one Gemini Live session with bounded time and spend, explicit skip behavior, and documented evidence capture. A typed-output smoke is not full-duplex acceptance: audio input and supported-OS interruption require their own evidence. Model-appropriate bounds, terminal outcomes, and cleanup are recorded; account settings are never changed automatically.
- [ ] #7 README, website command/model/troubleshooting docs, CHANGELOG, HANDOFF, and LEARNINGS explain live support, installation/preflight behavior, provider limitations, and the tested Cloudflare path.
- [ ] #8 Fork-specific code is concentrated behind narrow interfaces and the upstream-sync documentation identifies the intended merge-conflict boundary. The intended boundary is `src/fork/live/`, the central provider registry, and a small entry-point registration hook; existing finite factories, CLI-owned preferences, and recovery policy are not refactored for this feature.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. **Prove transport locally, then prove native routing with authorization.** Exercise the pinned Undici client against loopback upgrade, error, and cleanup fixtures. Use an explicitly paid-authorized disposable spike to establish the current OpenAI GA and Google Live routes through Cloudflare, especially Google keyless BYOK. Keep original errors and stop rather than introducing provider credentials or bypasses.
2. **Add the experimental command behind the current fork boundary.** Put live command, controller, adapters, and tests under `packages/ai-cli/src/fork/live/`; use a small registration hook and the central provider registry; reuse existing Cloudflare configuration. Accept explicit full routes or `--provider` plus a native model ID, advertise `--gateway`, and reject unsupported effective gateways. Do not inherit finite defaults, catalogs, aliases, or recovery.
3. **Package the client and preflight media locally.** Keep typed-input and WAV-output mode self-contained, add no new native media dependency by default, and validate requested external device capabilities before WebSocket construction. Establish a truthful rendered-position contract for interruption; written or drained bytes are not heard samples.
4. **Prove protocol and lifecycle deterministically.** Retain injected network-free tests, add separate real loopback transport tests, and cover native schemas, auth isolation, framing, interruption and playback accounting, cancellation, phase deadlines, provider errors, and normal process exit. Exercise both the source entry point and installed built artifact.
5. **Run separately authorized acceptance tiers.** Use one bounded headless Cloudflare smoke per provider with no client retries, microphone, playback, or tools. Use model-appropriate output limits and request payload suppression. Before full-duplex acceptance, also prove prerecorded audio input and supported-OS microphone, playback, and interruption. Record skips, blocked results, and failures distinctly. Do not mutate gateway or billing settings.
6. **Document verified behavior and the narrow merge boundary.** Update README/package and website docs, CHANGELOG, HANDOFF, LEARNINGS, and upstream-sync guidance; preserve both Pro reports and link the dated reassessment. Mark models, OS/backend coverage, BYOK, and privacy claims according to evidence, not planned support.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
GPT Pro architecture counsel, 2026-08-30:

- Start with the already pinned Undici WebSocket implementation; add another client only if a protocol spike proves it inadequate.
- Use Cloudflare provider-native `/openai` and `/google` realtime routes. Do not put live protocol handling into the existing large gateway module.
- Treat OpenRouter as finite HTTP/SSE unless its official API adds full-duplex realtime; reject unsupported live routes before network access or spend.
- Keep Cloudflare BYOK invariant: ai-cli must not read or forward local provider keys in Cloudflare mode. Google keyless BYOK is a release-blocking proof point.
- Default payload logging off. Require explicit two-part opt-in for bounded paid smoke tests.
- Product decisions still needed: experimental command acceptance, initial OS support, privacy/recording defaults, smoke-test funding and gateway, and behavior if Google keyless BYOK is unavailable.

GPT-6 Pro reassessment, 2026-09-07:

- Retain the native-first architecture; no Worker, browser bridge, voice-agent framework, provider SDK migration, or shared-library redesign is justified.
- Put new behavior under `packages/ai-cli/src/fork/live/`, with only small hooks in the provider registry and entry point.
- Implement the current OpenAI GA schema and one explicit dated Gemini Live profile instead of copying aging Cloudflare sample payloads. Keyless Gemini remains a release gate.
- Retain Undici-first, but prove rejected-upgrade diagnostics and bounded cleanup against a real loopback server before paid probes.
- Track received, queued, submitted, and rendered audio separately. Pipe writes and drain callbacks do not prove audio was heard; interruption must use a measured or validated bounded playback position.
- Keep OpenRouter outside the full-duplex command unless its official interface changes; its documented finite streamed audio does not establish a native live session.
- Do not enable or change gateway spend limits automatically. Separate bounded headless route smoke, prerecorded audio-input proof, and supported-OS interactive interruption acceptance.
- Send payload-suppression intent and verify actual realtime gateway log behavior before making a privacy claim.

GPT-6 Pro standalone-ownership addendum, 2026-09-07:

- Two standalone-restoration commits landed while the reassessment ran. The reviewed delta confirms the architecture and six-step plan remain unchanged.
- The CLI now owns preferences and recovery locally; TASK-1 must not restore the removed bricks dependency or reuse finite generation policy in live sessions.
- Acceptance criterion #8 now names CLI-owned preferences and recovery policy instead of the superseded shared-library boundary.
<!-- SECTION:NOTES:END -->
