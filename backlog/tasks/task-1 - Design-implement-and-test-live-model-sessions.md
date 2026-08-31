---
id: TASK-1
title: 'Design, implement, and test live model sessions'
status: To Do
assignee: []
created_date: '2026-08-31 05:04'
updated_date: '2026-08-31 06:01'
labels:
  - needs-patrick
dependencies: []
references:
  - >-
    https://developers.cloudflare.com/ai-gateway/usage/websockets-api/realtime-api/
  - 'https://developers.openai.com/api/docs/models/gpt-realtime'
  - 'https://ai.google.dev/gemini-api/docs/live-api'
  - 'https://openrouter.ai/docs/guides/overview/multimodal/audio'
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
- [ ] #1 The design documents the user-facing session workflow, model/provider selection, terminal audio behavior, cancellation, interruption handling, error recovery, and unsupported combinations.
- [ ] #2 OpenAI Realtime and Google Gemini Live sessions route through Cloudflare AI Gateway using stored provider keys; ai-cli does not read, persist, or forward local provider credentials in Cloudflare mode.
- [ ] #3 OpenRouter support is implemented only for realtime capabilities documented by OpenRouter; unsupported full-duplex model routes fail before spending credits with an actionable explanation.
- [ ] #4 A normal ai-cli install contains every required runtime client and media dependency, or the command performs a fast preflight that names the missing system capability and exact remedy; users do not discover missing clients after a paid session starts.
- [ ] #5 Deterministic tests cover provider routing, WebSocket authentication, event translation, audio framing, interruption, cancellation, timeouts, disconnects, and provider error bodies without network access or paid inference.
- [ ] #6 Opt-in Cloudflare smoke tests prove one OpenAI Realtime session and one Gemini Live session with bounded time and spend, explicit skip behavior, and documented evidence capture.
- [ ] #7 README, website command/model/troubleshooting docs, CHANGELOG, HANDOFF, and LEARNINGS explain live support, installation/preflight behavior, provider limitations, and the tested Cloudflare path.
- [ ] #8 Fork-specific code is concentrated behind narrow interfaces and the upstream-sync documentation identifies the intended merge-conflict boundary.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Prove the two provider-native Cloudflare WebSocket paths with a disposable protocol spike, especially Google keyless BYOK.
2. Add an experimental `ai live` command with explicit `openai/<model>` or `google/<model>` selection and a shared session state machine behind thin provider adapters.
3. Package the JavaScript WebSocket transport with the CLI. Add a no-network preflight for external microphone/playback capabilities before opening a socket; keep typed-input and WAV-output mode self-contained.
4. Add deterministic tests using injected transports, clocks, audio, and signals. Cover auth isolation, native events, PCM/WAV framing, interruption, cancellation, timeouts, disconnects, and provider errors.
5. Add separately gated, bounded paid smoke tests for one OpenAI Realtime session and one Gemini Live session through Cloudflare. Disable retries, microphone playback, tools, and payload logging.
6. Document the experimental UX, provider limits, preflight remedies, privacy defaults, smoke-test evidence, and narrow upstream merge boundary.
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
<!-- SECTION:NOTES:END -->
