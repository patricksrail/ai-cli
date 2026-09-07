---
id: TASK-6
title: 'Share AI preferences, aliases and failure fallbacks'
status: In Progress
assignee:
  - '@codex'
created_date: '2026-09-07 07:54'
updated_date: '2026-09-07 08:20'
labels:
  - auto
dependencies: []
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Patrick requested operational failure fallbacks in ai-cli, a pushed reusable AI library, a project/provider/model matrix, and a preferred-model feed with aliases that resolve explicit billing hosts for CK.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Shared library exposes one preferred-model list, deterministic aliases, provider overrides and tested fallback execution
- [x] #2 CLI uses shared preferences and fallbacks, preserves free/provider constraints, and reports actual attempted and successful routes
- [x] #3 Runnable examples, matrix and relevant README/web docs describe current behavior
- [ ] #4 Required checks pass and session changes are committed and pushed to their owning repositories
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Create and push bricks/ai with shared preferences, BYOK SDK and fallback execution; consume the pinned library in ai-cli, add aliases/preferred JSON and job provenance; provide a CK-compatible feed without changing CK deployment/provider wiring; validate and push CLI.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Library pushed at d67b199; 8 tests pass with SDK fallback and auth coverage. CLI: 294 tests plus 20 web tests pass; builds/typecheck/format pass; lint has 25 existing warnings, no errors. CLI subprocess tests prove recovery, no-fallback, case-insensitive explicit host pinning, free-only filtering and offline preferred listing. Real built CLI Google BYOK returned CLI_SHARED_OK; shared SDK OpenRouter BYOK returned LIBRARY_SHARED_OK. CK can import preferredModels and resolveModel with ckId; existing CK picker was not migrated. Full source audit matrix and curl/SDK/Python recipes are in bricks/ai.
<!-- SECTION:NOTES:END -->
