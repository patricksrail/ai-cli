---
id: TASK-2
title: Fix Cloudflare model discovery and command routing help
status: Done
assignee:
  - '@codex'
created_date: '2026-09-06 18:26'
updated_date: '2026-09-06 18:37'
labels:
  - auto
dependencies: []
type: bug
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Generation defaults to Cloudflare but model discovery still uses Vercel and hides routing prefixes. Discover configured BYOK catalogs, make large catalogs browsable, expose free OpenRouter models, and preserve a narrow fork integration for upstream merges.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Cloudflare discovery uses configured providers and retains full route IDs without local provider credentials
- [x] #2 Summary, provider/search/type/creator filters, free OpenRouter filter, JSON and explicit full-list output are documented and tested
- [x] #3 All generation commands advertise and honor gateway/provider options; full IDs avoid Vercel discovery
- [x] #4 Regression checks and built CLI smoke tests pass; relevant docs and changelog updated
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Keep provider discovery and browse UI in src/fork, add small hooks to upstream commands, cover account discovery and routing with mocked network tests, and verify built CLI with live catalogs and text calls.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verified live catalogs for OpenRouter, Google, OpenAI, Fal, and Replicate with provider credentials unset. Installed ai returned ROUTING_OK through OpenRouter and direct Google, FREE_OK through OpenRouter free router, and generated valid Fal and OpenRouter images. Full suite passed 240 CLI tests and 20 web tests; final additional regression verifies versioned non-official Replicate IDs. Typecheck, build, formatting, lint, MDX serialization and diff checks passed. Existing lint warnings remain in unchanged generated/library code. Replicate all-page scans are opt-in; normal browsing reports first-page coverage and supports native search.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Replaced unconditional Vercel discovery with configured Cloudflare BYOK catalogs, compact provider summary, full route IDs, filtering and advertised free OpenRouter text models. Added gateway/provider flags to every generation command and removed image discovery dependency for full IDs. Fork behavior resides in src/fork with small upstream command hooks. Updated README, website docs/copy, spec, handoff, learnings, changelog, and upstream sync notes. Rebuilt and smoke-tested installed executable; no commit or push performed.
<!-- SECTION:FINAL_SUMMARY:END -->
