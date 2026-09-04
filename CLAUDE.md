---
date_created: 2026-08-30
date_updated: 2026-08-30
summary: Development instructions for Patrick's Cloudflare BYOK fork of ai-cli.
related:
  - HANDOFF.md
  - docs/upstream-sync.md
  - https://github.com/patricksrail/ai-cli
  - https://github.com/vercel-labs/ai-cli
---

# CLAUDE.md

## Fork Context

- `origin` is `https://github.com/patricksrail/ai-cli.git`; `upstream` is `https://github.com/vercel-labs/ai-cli.git`.
- This fork keeps the upstream CLI surface but defaults to the authenticated Cloudflare AI Gateway named `ai-cli`. Set `AI_CLI_GATEWAY=vercel` to use upstream Vercel routing.
- Provider credentials live in Cloudflare Provider Keys under the `default` alias. The CLI must not read, persist, or forward local provider keys in Cloudflare mode.
- Cloudflare routing is implemented in `packages/ai-cli/src/lib/gateway.ts` and tested in `packages/ai-cli/src/lib/gateway.test.ts`. Keep fork policy concentrated there so upstream merges stay small.
- Read `HANDOFF.md` before changing provider authentication or media routing.
- Follow [`docs/upstream-sync.md`](docs/upstream-sync.md) when bringing changes from `vercel-labs/ai-cli` into this fork.

## Local Configuration and Use

On Patrick's Mac, `/Users/patricksrail/Code/specialagent/.env.local` is the canonical ignored auth source. It provides `CLOUDFLARE_ACCOUNT_ID` and the accepted `CLOUDFLARE_API_TOKEN` fallback; do not copy secret values into this repository.

`/Users/patricksrail/.local/bin/ai` is linked through Bun to this checkout's built package. Rebuild after source changes before live testing.

```bash
set -a
source /Users/patricksrail/Code/specialagent/.env.local
set +a
bun install
bun run --cwd packages/ai-cli build
bun link --cwd packages/ai-cli
export PATH="$HOME/.bun/bin:$PATH"
ai text -m "google/gemini-2.5-flash-lite" "hello"
```

Cloudflare and gateway ID `ai-cli` are defaults, so neither `AI_CLI_GATEWAY` nor `CLOUDFLARE_AI_GATEWAY_ID` is required for this account. Prefer a dedicated `CLOUDFLARE_AI_GATEWAY_TOKEN` with AI Gateway Run permission when available; `CLOUDFLARE_API_TOKEN` remains the fallback.

The same underlying model can be selected through different stored provider keys:

```bash
ai text -m "google/gemini-2.5-flash-lite" "hello"             # direct Google AI Studio BYOK
ai text -m "openrouter/google/gemini-2.5-flash-lite" "hello"  # OpenRouter BYOK routes Gemini
```

## Monorepo Structure

This is a Turborepo monorepo. The CLI application lives in `packages/ai-cli/` and shared configuration packages live in `packages/`.

## Package Manager

Use **bun** for all package management and script execution:

- `bun install` to install dependencies
- `bun add <package>` to add a dependency (use `--cwd packages/ai-cli` to target the CLI package)
- `bun add -d <package>` to add a dev dependency
- `bun run <script>` to run package.json scripts
- `bun test` to run tests

## Documentation

When making any user-facing change (new command, new flag, changed behavior, renamed option, release note, website copy change, etc.), update every relevant user-facing documentation surface in the same PR:

- `packages/ai-cli/README.md` for the npm/package README
- `apps/web/docs/` for website documentation
- `apps/web/components/landing/` and other website copy when the landing page or marketing copy should reflect the change
- `CHANGELOG.md` for release-facing changes


## Type Checking


```sh
bun run typecheck
```

This runs `turbo run typecheck` across all workspaces and ensures no type errors have been introduced.

## Deployment

This repository builds a local/npm CLI; it does not deploy a Worker. Run `bun run build`, link the package for local use, and push fork changes to `origin`. Use the [upstream-sync runbook](docs/upstream-sync.md) to merge source updates without rewriting Patrick's fork commits.
