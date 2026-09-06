---
id: TASK-4
title: Add a verified low-cost image preset
status: Done
assignee:
  - '@codex'
created_date: '2026-09-06 19:40'
updated_date: '2026-09-06 19:44'
labels:
  - auto
dependencies: []
ordinal: 4000
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Cheapest image selection uses a documented full provider route and works through the installed CLI without extra shell setup
- [x] #2 Free-image availability and resolution billing limits are documented, with useful CLI guidance when no free model exists
- [x] #3 Tests, build and live low-resolution image generation pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Live Sana via Cloudflare/Fal produced 512x512 JPEG. Added cheapest.image full route, image help, missing-free guidance, source-linked pricing and billing limits. A sanitized login-shell check revealed missing inherited credentials; installed fork-owned Mac launcher fixes this by loading only Cloudflare assignments and retaining explicit overrides. Clean-shell doctor and actual cheapest image generation pass from /tmp. 261 CLI tests plus 20 web tests pass; Node launcher test, build and typecheck pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Installed ai now works in a fresh shell outside the checkout. Cheapest images use Fal Sana ($0.001 per MP listed); low-resolution drafts work. No free image route is falsely advertised or paid fallback sent. Documented separate Workers AI free allocation as not yet supported.
<!-- SECTION:FINAL_SUMMARY:END -->
