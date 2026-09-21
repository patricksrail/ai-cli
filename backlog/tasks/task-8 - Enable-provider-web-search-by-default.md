---
id: TASK-8
title: Enable provider web search by default
status: Done
assignee:
  - '@codex'
created_date: '2026-09-21 07:56'
updated_date: '2026-09-21 08:12'
labels: []
dependencies: []
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Patrick requested default web search in ai-cli and the separate bricks recipes, with live news validation for every active provider. Keep the projects independent.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Text generation uses provider-native search by default with an explicit opt-out
- [x] #2 Supported media models receive their documented search flag without adding flags to unsupported models
- [x] #3 Deterministic tests and live current-news probes cover both integrations and record failures honestly
- [x] #4 Relevant docs explain defaults, sources, limitations and provider-specific settings
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Centralize SDK tools and media flags in one readable module per standalone repo; wire calls and examples; test actual HTTP serialization, fallback routing and opt-out; run live probes against independently researched news; document results.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Central provider settings are in web-search.ts in each independent repo. CLI and bricks passed live current-news text checks through Google 2.5 Flash Lite, OpenAI GPT-5.6 Sol and OpenRouter GPT-5.6 Sol with source annotations. Google 3.8 Flash returned quota errors. Fal Nano Banana 2/Pro and Replicate Nano Banana 2 failed both news-image prompts. Matched sailboat controls passed on Fal and Replicate with search on and off, so this does not establish a general search-option failure. Defaults remain enabled as requested; limitations are documented in research/web-search-validation-2026-09-21.md. Deterministic tests verify native request fields, opt-out and fallback provider selection.

Final combined run found two website documentation-route test failures; investigating before finalizing.

Final validation: 315 CLI tests, 20 website tests, 18 bricks tests pass; typechecks and CLI/bricks builds pass. The two website failures were caused by invoking the tests from the monorepo root; running from apps/web resolved them without code changes. Lint retains 25 existing warnings, no new warnings/errors. OpenRouter final no-argument tool calls were rechecked live through both projects and passed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Enabled provider-native search defaults with opt-outs and source preservation in ai-cli and separate bricks examples. Verified live text on all three active text hosts, actual media option serialization and image controls; explicitly recorded failed media news grounding. Model preferences and gateway settings are unchanged.
<!-- SECTION:FINAL_SUMMARY:END -->
