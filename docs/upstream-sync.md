---
date_created: 2026-08-30
date_updated: 2026-08-30
summary: Safe procedure for merging vercel-labs/ai-cli updates into Patrick's Cloudflare BYOK fork.
related:
  - ../CLAUDE.md
  - ../HANDOFF.md
  - https://github.com/vercel-labs/ai-cli
---

# Syncing the Upstream Repository

This fork tracks [`vercel-labs/ai-cli`](https://github.com/vercel-labs/ai-cli) as `upstream` and Patrick's fork as `origin`. Merge `upstream/main` into a short-lived branch, verify Cloudflare BYOK behavior, then fast-forward `main`. Do not rebase or force-push the published fork commits.

## 1. Start Clean and Inspect the Update

Stop if the working tree contains unrelated changes. Preserve them before starting the sync; do not hide them in the upstream merge.

```bash
git switch main
git status --short --branch
git remote get-url origin
git remote get-url upstream
git fetch --prune origin
git fetch --prune upstream
git pull --ff-only origin main
git rev-list --left-right --count main...origin/main
git rev-list --left-right --count main...upstream/main
git log --oneline --left-right main...upstream/main
git diff --stat main...upstream/main
```

The expected remotes are:

- `origin`: `https://github.com/patricksrail/ai-cli.git`
- `upstream`: `https://github.com/vercel-labs/ai-cli.git`

The first count must be `0 0`, proving local `main` matches `origin/main`. In the second count, the left value is the fork-only commit count and the right value is the upstream-only commit count. If the right value is `0`, upstream has no new commits to merge.

## 2. Merge on a Sync Branch

Replace the date placeholder with the current date. If that branch already exists, inspect it and use a numeric suffix for a separate sync.

```bash
git switch -c sync/upstream-YYYY-MM-DD
git merge --no-ff --no-commit upstream/main
```

Resolve conflicts one hunk at a time. Preserve upstream behavior unless it conflicts with these fork invariants:

- Cloudflare is the default gateway; `AI_CLI_GATEWAY=vercel` remains the explicit upstream-compatible path.
- The default Cloudflare gateway ID is `ai-cli`.
- Provider credentials stay in Cloudflare Provider Keys. Cloudflare mode sends gateway authentication and strips local provider authorization.
- Working no-model defaults use the live-tested BYOK routes recorded in `packages/ai-cli/src/lib/models.ts`.
- Fal, Replicate, Google, and OpenRouter asynchronous and media URLs continue through the Cloudflare routing rules in `packages/ai-cli/src/lib/gateway.ts`.
- `AGENTS.md` remains a relative symlink to `CLAUDE.md`; root `README.md` remains a relative symlink to `packages/ai-cli/README.md`.

Review `HANDOFF.md` and `LEARNINGS.md` before resolving gateway, provider, media, SDK, model-default, or authentication conflicts. Merge both upstream and fork entries in `CHANGELOG.md`; do not accept either whole file blindly. Update fork documentation and `CHANGELOG.md` for behavior changed by the merge. After resolving every conflict and making those updates, stage the affected paths with `git add <paths>`.

## 3. Review the Result

```bash
git status --short
test -z "$(git diff --name-only --diff-filter=U)"
git diff --cached --stat
git diff --cached
git diff --cached -- packages/ai-cli/src/lib/gateway.ts packages/ai-cli/src/lib/models.ts
git diff --cached --no-ext-diff | rg -n '^\+.*(AIza[0-9A-Za-z_-]{20,}|sk-[0-9A-Za-z_-]{20,}|r8_[0-9A-Za-z]{20,}|[A-Z][A-Z0-9_]*(?:KEY|TOKEN)=[^[:space:]]+)' || true
test "$(readlink AGENTS.md)" = "CLAUDE.md"
test "$(readlink README.md)" = "packages/ai-cli/README.md"
git diff --check
git diff --cached --check
```

Keep fork-only edits narrow. Avoid formatting or regenerating unrelated upstream files. Inspect the complete staged diff for unintended files and credentials; do not rely on a filename-only review. The heuristic credential scan should print nothing. Inspect every match and extend it when a provider introduces a new key format.

## 4. Run the Full Local Checks

```bash
bun install --frozen-lockfile
bun run format:check
bun run lint
bun run typecheck
bun run test
bun run build
```

If the frozen install reports a real manifest/lockfile mismatch introduced by conflict resolution, run `bun install`, inspect the resulting `bun.lock`, and include only the necessary lockfile update.

## 5. Smoke-Test the Built CLI Through Cloudflare

On Patrick's Mac, load Cloudflare account authentication, remove all local provider credentials, rebuild the linked command, and test both direct Google and OpenRouter paths to the same Gemini model:

```bash
set -a
source /Users/patricksrail/Code/specialagent/.env.local
set +a
unset AI_CLI_GATEWAY CLOUDFLARE_AI_GATEWAY_ID
unset FAL_API_KEY FAL_KEY GEMINI_API_KEY GOOGLE_GENERATIVE_AI_API_KEY
unset OPENAI_API_KEY OPENROUTER_API_KEY REPLICATE_API_TOKEN
sync_output_dir="$(mktemp -d)"
bun run --cwd packages/ai-cli build
bun link --cwd packages/ai-cli
hash -r
ai --version
ai text -m "google/gemini-2.5-flash-lite" -o "$sync_output_dir/google.md" "Reply only: UPSTREAM_OK"
ai text -m "openrouter/google/gemini-2.5-flash-lite" -o "$sync_output_dir/openrouter.md" "Reply only: UPSTREAM_OK"
rg -n "UPSTREAM_OK" "$sync_output_dir/google.md" "$sync_output_dir/openrouter.md"
```

The first model uses the Google AI Studio key stored in Cloudflare. The second uses the OpenRouter key stored in Cloudflare and asks OpenRouter for the same Gemini model. Neither call should require a provider key in the CLI environment. Outputs go to a temporary directory outside the repository; inspect and remove it when finished.

If upstream changed gateway routing, provider SDKs, uploads, polling, downloads, or artifact handling, run this compact media chain as well. It spends provider credits, so use it for affected changes rather than documentation-only syncs.

```bash
ai image -m "fal/fal-ai/flux/schnell" --no-preview -o "$sync_output_dir/source.png" "a red paper circle on a white background"
ai text -m "openrouter/google/gemini-2.5-flash-lite" -i "$sync_output_dir/source.png" -o "$sync_output_dir/vision.md" "Name the main shape and color"
ai image -m "replicate/black-forest-labs/flux-2-pro" -i "$sync_output_dir/source.png" --no-preview -o "$sync_output_dir/edit.png" "turn the red circle blue"
ai video -m "replicate/prunaai/p-video" --no-preview -o "$sync_output_dir/text-video.mp4" "a red paper circle rotates once"
ai video -m "fal/fal-ai/wan/v2.2-5b/image-to-video" -i "$sync_output_dir/source.png" --no-preview -o "$sync_output_dir/image-video.mp4" "the paper circle rotates once"
ai audio speak -m "fal/fal-ai/minimax/speech-02-turbo" --no-play --no-waveform -o "$sync_output_dir/speech.mp3" "The upstream sync works."
ai audio transcribe -m "fal/fal-ai/wizper" -o "$sync_output_dir/transcript.txt" "$sync_output_dir/speech.mp3"
file "$sync_output_dir"/*
sips -g pixelWidth -g pixelHeight "$sync_output_dir/source.png" "$sync_output_dir/edit.png"
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height -of default=noprint_wrappers=1 "$sync_output_dir/text-video.mp4"
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height -of default=noprint_wrappers=1 "$sync_output_dir/image-video.mp4"
ffmpeg -v error -y -i "$sync_output_dir/text-video.mp4" -frames:v 1 "$sync_output_dir/text-video-frame.png"
ffmpeg -v error -y -i "$sync_output_dir/image-video.mp4" -frames:v 1 "$sync_output_dir/image-video-frame.png"
rg -n "circle|red|blue" "$sync_output_dir/vision.md"
rg -ni "upstream sync works" "$sync_output_dir/transcript.txt"
```

Inspect image dimensions and representative video frames, duration, and codecs rather than treating a zero exit code as sufficient. `HANDOFF.md` records the broader live-tested provider matrix and known account limits.

## 6. Finish and Push

After all checks pass, commit the sync branch, then fast-forward and push `main`:

```bash
git status --short
git diff --cached --name-status
git diff --cached
git diff --cached --check
git commit -m "chore: sync vercel-labs/ai-cli upstream"
git merge-base --is-ancestor upstream/main HEAD
git switch main
git merge --ff-only sync/upstream-YYYY-MM-DD
git push --dry-run origin main
git push origin main
test "$(git rev-parse HEAD)" = "$(git ls-remote origin refs/heads/main | cut -f1)"
git status --short --branch
```

Confirm `origin/main` points at the local commit before deleting the sync branch. Push to `origin`, not `upstream`.
