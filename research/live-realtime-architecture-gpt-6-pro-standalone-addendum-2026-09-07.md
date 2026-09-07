---
date_created: 2026-09-07
date_updated: 2026-09-07
summary: Preserved GPT-6 Pro addendum reconciling the live/realtime architecture with the standalone ownership restoration.
related:
  - "../backlog/tasks/task-1 - Design-implement-and-test-live-model-sessions.md"
  - ../HANDOFF.md
  - live-realtime-architecture-gpt-6-pro-reassessment-2026-09-07.md
  - https://chatgpt.com/c/6a9ec974-f74c-83e9-b45d-de71e326e5b6
---

# GPT-6 Pro addendum: standalone ownership

This is non-authoritative counsel retained for TASK-1. The report below is preserved verbatim except for one trailing-space Markdown hard break normalized to `<br>`.

## Provenance

- Conversation: https://chatgpt.com/c/6a9ec974-f74c-83e9-b45d-de71e326e5b6
- Verified model: `gpt-6-pro`
- Reviewed source delta: `05a4978d1294e84a353b7e9a9565caa1598bc11f..cb09c09`
- Result ZIP SHA-256: `1d78fc546500fa5572c18ef3530ac4801482816a6c4128caeb1eeb22b7ad0994`
- Source report SHA-256: `11fb7e372c2e23d39490fbca0c8400093ebcec704bc9f2d8bf4e68fb4e3b7d92`

## Preserved addendum

# TASK-1 addendum: standalone ownership

**Date:** September 7, 2026<br>
**Scope:** Only the supplied `05a4978 → cb09c09` delta and its effect on `TASK-1-live-realtime-decision-2026-09-07.md`. This addendum supersedes only the statements identified below; it does not repeat the provider-interface review.

## Decision

**The architecture decision is unchanged. Retain all six steps of the prior report’s replacement TASK-1 Implementation Plan.** The standalone restoration supports, rather than undermines, the proposed `src/fork/live/` boundary. It does not justify another abstraction, a shared-library dependency, different provider routing, or importing finite-generation defaults, aliases or recovery into live sessions.

The delta removes bricks from the package and lockfile; restores local preferences and authentication; separates generation policy, attempt execution and catalog suggestions; and replaces the async execution-policy context with explicitly passed options. It also preserves SDK retries for finite Vercel generation while keeping Cloudflare’s finite fallback loop separate. These are ownership and finite-execution changes, not new realtime capabilities. [D1–D3]

Keep the two native Cloudflare adapters, stored BYOK, Undici-first decision gate, packaged-client/local-media-preflight split, and every existing transport, keyless-Gemini, playback, privacy and paid-acceptance requirement. **No additional TASK-1 dependency, refactor or acceptance gate is warranted by this delta.**

## Only change to the proposed TASK-1 amendment text

In prior report §9.1, replace the proposed sentence appended to **acceptance criterion #8** with:

> The intended boundary is `src/fork/live/`, the central provider registry and a small entry-point registration hook; existing finite factories, CLI-owned preferences and recovery policy are not refactored for this feature.

This replaces the stale ownership phrase “shared-library policy,” without changing the obligation. All other proposed TASK-1 wording remains valid. Read §9.2’s “No dependency change now” against the standalone tree: **do not restore bricks.**

## Replacement wording for stale report statements

Locations refer to the delivered September 7 decision report, not the preserved August 30 architecture report. Unless stated otherwise, replace the entire identified paragraph.

### §4, “Placement and ownership”: paragraph beginning “Reuse …”

> Reuse the CLI-owned `resolveGatewayBackend` and `resolveCloudflareGatewayConfig` in `src/lib/gateway.ts`; do not duplicate token precedence. Keep live protocol policy in `src/fork/live/`, without a bricks dependency. Nothing here requires changing existing language/media factories, model catalogs, finite fallbacks, Workers AI, the Mac auth launcher or local `src/fork/model-preferences.{json,ts}`. [D1–D3]

### §4, “Preserve the CLI’s selection vocabulary”: first two sentences of “Do not attach …”

> Do not attach the full `addRoutingOptions` wrapper to live: it still registers finite model-selection and fallback flags. Finite commands now pass routing options explicitly through `runJobs` to `generation.ts`; `fallback.ts` executes attempts, `alternatives.ts` only suggests catalog matches, and `execution-policy.ts` has been removed. Use small live-owned gateway/provider registration and explicit controller inputs, not those finite execution functions. [D2]

Keep the following sentence prohibiting automatic retry, reconnection, replay, provider switching, catalog discovery and saved fallbacks. The Vercel retry correction does **not** authorize retries in a stateful live session or require live to use `generationRetryOptions()`.

### §6, “Keep the package/preflight split”: paragraph beginning “Correct the old report’s phrase …”

> Retain “no new native media dependency,” rather than “native-dependency-free npm artifact”: `sharp` remains a dependency. The bricks dependency and its private-Git installation workaround have been removed. Install and build the actual standalone fork normally; require no bricks checkout, bricks credentials or special Git URL rewrite. Keep built-package acceptance and local audio-capability preflight; installing the upstream public package does not verify this fork. [D1]

### §7.C, “Built package and installation acceptance”: second sentence only

Replace the sentence containing “using authorized private-dependency access as necessary” with:

> Keep those tests and add a clean-directory installation of the actual standalone fork package, without bricks access or a special Git URL rewrite. [D1]

All remaining source-entrypoint, installed-Node, headless, transport, cleanup and launcher checks stay unchanged. The recorded standalone preferred-feed run is useful installation evidence, not proof that an installed live command works. [D4]

### §9.2: closing paragraph beginning “No edits are recommended …”

> No edits are recommended to existing finite routing defaults, the CLI-owned `src/fork/model-preferences.{json,ts}`, finite generation/recovery policy, Workers AI’s disabled state, the local auth launcher or finite progress machinery as a prerequisite for TASK-1. Bricks is separate and evolving, not this CLI’s canonical dependency or configuration owner. [D1–D3]

### §2: paragraph beginning “The current HANDOFF reports 294 …”

> HANDOFF now records restoration validation of 302 CLI tests and 20 website tests, successful typechecking/builds, and a fresh standalone package install/build with a preferred-feed run under Node. It records a CLI/SDK Vercel retry regression against simulated HTTP; the earlier 294/20/8 results remain historical pre-restoration evidence. These are repository-recorded results, not tests rerun for this addendum, and they do not establish Realtime/Live acceptance. [D4]

The original source identity, original validation account, and §10 repository-reference line numbers remain historical evidence for `05a4978`; do not relabel them as `cb09c09`. Preserve both earlier reports unchanged and link this addendum alongside them.

## Evidence and verification

**D1:** Delta to `SPEC.md`, `packages/ai-cli/package.json`, `bun.lock`, and package README installation/preferences sections: local ownership and removal of bricks. Package JSON comparison confirms that removing bricks is its only semantic change; Undici and sharp versions remain unchanged.

**D2:** `packages/ai-cli/src/fork/README.md` ownership/request-flow sections; `options.ts`, deleted `execution-policy.ts`, `generation.ts` (`generationRetryOptions`, `generateWithGuidance`), `fallback.ts`, `alternatives.ts`, and `src/lib/jobs.ts`: explicit finite policy and retry ownership.

**D3:** `packages/ai-cli/src/lib/gateway.ts` (`resolveCloudflareGatewayConfig`, `createCloudflareByokFetch`): local configuration/authentication implementation; `src/fork/providers.ts`: only its preference-ownership comment changes, not provider capability/path data.

**D4:** `HANDOFF.md`, “Current update (2026-09-07)”; TASK-7 notes; `src/fork/generation.test.ts` and its HTTP fixture. These supply recorded outcomes and test source, not independently rerun results.

I checked the supplied patch with `git apply --check --index`, then applied it only in a disposable analysis checkout of the original bundle. It changes 39 files and reconstructs tree `cb81498a0d13d1a73d98c328cd88ebbaff7893bf`. TASK-1, the preserved August 30 report, `src/index.ts`, `src/cli.test.ts` and the Mac launcher are byte-identical to the reviewed baseline. No live implementation is added. The `cb09c09` commit label is supplied provenance; the synthetic bundle does not independently establish that remote commit’s history.

No implementation, dependency installation, application tests, builds, provider probes, account changes or renewed web review were performed. The delivered ZIP was opened and integrity-checked.

**Input patch SHA-256:** `1d835e68b1f0fc89a788514a710e68fbcc6b75fbeeac6647a1b400c176d4fb1a`.
