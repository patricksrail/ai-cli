---
id: TASK-1
title: 'Design, implement, and test live model sessions'
status: To Do
assignee: []
created_date: '2026-08-31 05:04'
labels: []
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
