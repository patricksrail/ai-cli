---
id: TASK-3
title: Add CLI diagnostics and model selection presets
status: Done
assignee:
  - '@codex'
created_date: '2026-09-06 19:09'
updated_date: '2026-09-06 19:31'
labels:
  - auto
dependencies: []
type: enhancement
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make gateway/provider discovery and help intuitive. Add doctor diagnostics, best/free/cheapest selection with stored preferences and source-backed free-tier metadata, and failure guidance that identifies alternate routes without claiming untested inference success.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Help clearly states default gateway, override syntax, and discovery commands; doctor and provider/gateway inventory fit upstream registration
- [x] #2 Google direct free-tier scope is researched and documented with source comments; alternatives distinguish discovery from successful inference
- [x] #3 Build, tests, documentation and installed CLI checks pass
- [x] #4 One editable file stores full provider routes for defaults, best, cheapest and ordered bestFree; live free browsing and explicit free-model validation are advertised and tested
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Inspect current upstream registration; keep added diagnostics, presets and failure guidance under src/fork. Verify official Google/OpenRouter metadata, store editable preference JSON, use catalog metadata for selection, and test safe diagnostics and errors.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Inspected upstream main bf0fd2a: no diagnostics commands; new registration hooks fit the existing command structure. Latest user preference makes cheapest a saved low-cost frontier choice (OpenRouter Luna), not live price ranking. Normal text uses direct Google 3.8 Flash; free eligibility remains conditional on Google project billing. Added SDK-to-BYOK OpenRouter image regression and full-route free validation. Live default text, Google doctor probe, catalogs and typo alternatives pass; prior live OpenRouter image is a valid 1024x1024 PNG. Build/typecheck and 260 CLI + 20 web tests pass; lint has 25 existing warnings and zero errors.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented diagnostics, readable help, route-aware saved defaults/best/cheapest/bestFree, live free filtering and validation, and failure suggestions. Rebuilt installed CLI. Verified default Google 3.8 Flash inference, explicit doctor probe, OpenRouter free selection, provider inventory, typo alternatives and OpenRouter image SDK regression. 280 tests pass across CLI and web; typecheck/build pass; lint reports zero errors and 25 existing warnings. Changes remain uncommitted and isolated in fork modules with small upstream hooks.
<!-- SECTION:FINAL_SUMMARY:END -->
