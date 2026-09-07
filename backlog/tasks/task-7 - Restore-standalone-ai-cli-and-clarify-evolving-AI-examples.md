---
id: TASK-7
title: Restore standalone ai-cli and clarify evolving AI examples
status: Done
assignee:
  - '@codex'
created_date: '2026-09-07 14:27'
updated_date: '2026-09-07 14:44'
labels:
  - auto
dependencies: []
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Patrick requested removal of the unapproved bricks dependency while retaining CLI features, a high standard for readable names/comments/file ownership, the Vercel retry fix, and a modest bricks cleanup that points to ai-cli as current reference. Commit and push both repositories.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 ai-cli installs and builds without bricks and keeps aliases, fallback policy and route reporting
- [x] #2 Vercel retains SDK retries; Cloudflare fallback behavior has regression coverage
- [x] #3 Changed source has clear purpose, explicit execution flow and current ownership documentation
- [x] #4 Bricks is readable and clearly evolving, with links to current CLI implementation; both repositories checked and pushed
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Restore model choices, alias validation, authentication and recovery locally in ai-cli. Separate catalog alternatives from generation policy and attempt execution; pass routing options explicitly and preserve Vercel SDK retries. Verify with CLI regression tests and a fresh standalone installation, update ownership docs, then commit/push CLI. Improve bricks source readability without changing its public API; mark it evolving with CLI reference links, validate and push.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
CLI self-contained: ordinary fresh package install/build and Node preferred feed succeeded; generated lockfile has no bricks dependency. 302 CLI + 20 web tests pass. Typecheck/build pass. New Vercel test verifies 503 recovery on the same gateway. Recovery options now flow explicitly from command to jobs to generation; no AsyncLocalStorage policy. Separate files own preferences, candidate policy, attempts and catalog suggestions.

Bricks eab6dcc pushed: readable cloudflare-client source, preserved /ai/sdk public import, documented evolving status and current CLI references. Eight tests (46 assertions), typecheck/build, formatting, Node built-package imports and mocked SDK recovery pass. CLI live smoke returned STANDALONE_OK; an earlier Google 503 stopped correctly under --no-fallback.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Restored standalone CLI ownership without removing requested aliases, failure fallbacks or route reporting; fixed Vercel SDK retries and documented explicit execution flow. CLI implementation pushed in 9cd30dd; fresh standalone install/build and 302 CLI plus 20 web tests pass. Bricks readability and evolving examples pushed in eab6dcc; its public import paths remain compatible and its own validation passes.
<!-- SECTION:FINAL_SUMMARY:END -->
