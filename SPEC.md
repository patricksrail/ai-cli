---
date_created: 2026-09-06
date_updated: 2026-09-06
summary: Required behavior of the Cloudflare BYOK CLI fork and provider-aware model discovery.
related:
  - HANDOFF.md
  - docs/upstream-sync.md
  - packages/ai-cli/README.md
---

# Goal

Keep upstream ai-cli generation commands while using Patrick's stored Cloudflare BYOK providers by default. Discovery must match that routing and make large catalogs easy to browse.

# Requirements

- Cloudflare is the default gateway for text, image, video, speech, transcription, and discovery. Vercel remains an explicit option with its upstream defaults.
- Local provider credentials are never read, persisted, or forwarded in Cloudflare mode. Stored Provider Keys use the default alias.
- Bare model discovery shows configured providers and defaults. Filtered output has copyable full route IDs, a visible result count, and an explicit way to show all matches.
- Provider, creator, type, search, free-model, display-limit, and JSON filters are documented and tested. Free discovery means OpenRouter text models with explicitly zero listed prices; media token-price placeholders do not prove free generation.
- Catalog results distinguish provider hosts from model creators. Account discovery is not a claim that every model has credit, quota, or compatible model-specific inputs.
- Replicate browsing starts with a page, native search is available, and complete pagination is opt-in with --all. Partial coverage and failed providers are reported on stderr, including for JSON.
- Every generation command advertises gateway and provider selection. With --provider, --model is the provider's native ID; otherwise full route IDs select the host. Full Cloudflare IDs and defaults do not depend on catalogs.
- Fork-specific discovery, defaults, and routing-option glue stay in packages/ai-cli/src/fork with small hooks in upstream files.

# Completion evidence

Unit and command integration tests cover provider inventory, authentication boundaries, pagination, pricing, filtering, ambiguity, and routing flags. Typecheck, tests, build, formatting, lint, and documentation checks run before handoff. Rebuild the locally linked executable and check live provider catalogs and representative text calls through Cloudflare.


# Model selection and diagnostics

Plain text defaults to Google 3.8 Flash, which has published free-tier eligibility. Announce the selected model on stderr, respecting quiet mode. Store defaults and separate best, cheapest, and best-free preferences as fully qualified provider/model routes in one editable JSON file; explicit model or selection flags override normal defaults. OpenRouter free prices are checked live; Google free-tier metadata is exact, dated, source-linked, and distinct from project billing. Cheapest selection uses the saved low-cost frontier preference (OpenRouter GPT-5.6 Luna for text) and is distinct from the explicit saved recovery order. Diagnostics expose gateway/provider choices, check configuration/catalogs without inference, and offer an explicit text probe. Failures retain original errors and ordered attempt metadata. Recoverable text failures use shared saved fallbacks, preserving explicit provider/free constraints; confirmed media submission rejection may recover, but ambiguous jobs stop. Preferred aliases expand deterministically with explicit host overrides. Shared bricks preferences are canonical; ai-cli consumes a pinned commit and offers an offline preferred JSON feed.

Cheapest image selection uses the saved Fal Sana route, with explicit `--size 512x512` supported for drafts. Document published unit pricing without inventing sub-megapixel discounts. No verified free image offer must produce actionable guidance without paid inference. Existing Mac setup must run the installed command without per-command credential sourcing.

Provider identity, modality support, auth type, and billing nuances have one executable registry at `src/fork/providers.ts`, exposed by `ai providers --all`; architectural guidance lives in `docs/providers.md`. Workers AI is disabled by choice in the registry after evaluating the $0.11-equivalent daily allowance. Its tested FLUX.1 Schnell adapter is retained as reference; do not enable it automatically. It must refuse prepaid billing and verify either a free plan or the user-authorized Workers AI gateway cap ($20 over at least 30 days) before ordinary inference. Explicit `--free` must reject capped paid routes. Do not change account plans or promote the route into default/best-free preferences until an authorized live probe succeeds.
