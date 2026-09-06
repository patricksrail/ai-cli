---
id: TASK-5
title: Verify and integrate Workers AI image generation through the existing gateway
status: Done
assignee:
  - '@codex'
created_date: '2026-09-06 19:51'
updated_date: '2026-09-06 20:46'
labels:
  - needs-patrick
dependencies: []
ordinal: 5000
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A token with Workers AI Read completes real Flux Schnell image generation through gateway ai-cli; inspect decoded image and gateway logging before integrating
- [x] #2 Introduce a workers-ai provider under the Cloudflare gateway with source-backed billing eligibility and explicit daily-quota limitations
- [x] #3 Keep fork integration narrow and update discovery, help, presets, tests and documentation
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation complete: one executable provider registry plus docs/providers.md; guarded Workers AI FLUX.1 Schnell image SDK adapter, registry-driven routing/help/discovery, and no prepaid/billing mutations. Full suite: 272 CLI + 20 web tests pass, typecheck/build pass, lint zero errors (25 existing warnings). Installed ai providers --all works. Doctor and guarded generation return expected HTTP 403 permission failures without an image. AC1 remains blocked: current token cannot call Workers AI (native probe 401/code10000, catalog403) or read subscriptions (403), cannot manage tokens (403), and Wrangler has no OAuth login. Need Workers AI Read and subscription-read access, then verified free-only plan and real image/gateway-log validation. No default/bestFree promotion until that succeeds.

2026-09-06: Signed into Cloudflare through GitHub SSO in a background task tab. Billing Subscriptions confirms Workers Paid is Active. Therefore token repair alone cannot meet the requested hard stop when free allowance is exhausted. No token, plan, prepaid balance or billing setting changed; no inference sent. Cloudflare spend limits are eventually consistent and cannot guarantee zero overage. A Workers Free account would be required for the documented provider-enforced quota stop.

Final 2026-09-06: User approved $20/month Workers AI-only cap; saved and read back gateway rule f300261b (2592000-second sliding window). Verified token ID, added Workers AI Read and Metadata Read, renamed shared token CLI - Wrangler, ai-cli, GitHub, Claude and Codex. Wrangler model listing works. Real 1024x1024 Flux image and gateway success log verified; account-wide analytics reported 172.8 neurons, within daily free allocation. User then declined integration after verifying $0.11/day allowance value. Registry disables CLI generation and automatic free discovery; adapter remains tested reference. This supersedes earlier blockers and activation plans.
<!-- SECTION:NOTES:END -->
