# ai-cli — Cloudflare BYOK fork

This is Patrick's fork of [vercel-labs/ai-cli](https://github.com/vercel-labs/ai-cli). It keeps the upstream command surface and Vercel AI SDK, but makes an authenticated Cloudflare AI Gateway the default and keeps provider credentials in Cloudflare rather than in the CLI environment.

## Start here

On Patrick's configured Mac, `ai` is ready to use. Cloudflare is the gateway; provider keys are stored there. No per-command sourcing or local OpenRouter/Fal keys are needed.

```sh
ai text "Summarize the tradeoffs of SQLite"    # default: direct Google Gemini 3.8 Flash
ai image --cheapest "a blue sailboat"         # saved paid option: Fal Sana
ai providers                                 # your configured hosts
ai models                                    # current default model IDs
ai models --provider openrouter --free        # browse free text models
ai models --provider openrouter --search gemini
ai doctor                                    # check setup without generating
```

Generation prints the selected route. The default text model has a published Google free tier, but your Google project's billing tier determines whether the request is free. `--free` selects eligible offers and never falls back to a paid model; it cannot turn a paid Google project into a free project. Image generation is paid; Workers AI is disabled in this fork.

| Choose | Example |
| --- | --- |
| A model through OpenRouter | `ai text -m openrouter/google/gemini-3.8-flash "hello"` |
| The same model through Google | `ai text --provider google -m gemini-3.8-flash "hello"` |
| Saved best or cheapest choice | `ai text --best "hello"` or `ai text --cheapest "hello"` |
| Upstream Vercel routing | `ai text --gateway vercel "hello"` |
| Catalogs, prices and provider notes | `ai providers --all --details` |

`--gateway` chooses the routing service. `--provider` chooses whose account runs/bills the model. With `-m openrouter/google/...`, OpenRouter is the provider and Google is the model creator. The default gateway stays Cloudflare unless overridden. See `ai gateways` for gateway choices and `ai <command> --help` for flags.

The [fork guide](src/fork/README.md) maps our customizations and documentation. [Provider architecture and pricing](../../docs/providers.md) explains billing and host differences; [LEARNINGS.md](../../LEARNINGS.md) holds reusable integration knowledge. Current account setup is in [HANDOFF.md](../../HANDOFF.md). This is a CLI today; shared application examples and a reusable AI integration guide are future work.

## What is different

- Cloudflare is the default backend; set `AI_CLI_GATEWAY=vercel` to use upstream Vercel routing.
- The default Cloudflare gateway ID is `ai-cli`; override it with `CLOUDFLARE_AI_GATEWAY_ID`.
- OpenAI, Google AI Studio, OpenRouter, Replicate, and Fal keys live in Cloudflare Provider Keys under the `default` alias.
- Provider authorization is stripped locally. The CLI sends only `cf-aig-authorization`, and Cloudflare injects the selected stored key.
- Fal publisher endpoints use Fal's official queue client through [Cloudflare's documented Fal proxy route](https://developers.cloudflare.com/ai-gateway/usage/providers/fal/); Replicate polling and Flux 2 inputs, plus Google and OpenRouter video downloads, remain on Cloudflare BYOK routes.

## Install this fork

Requires Bun and Node.js 22+.

```bash
git clone https://github.com/patricksrail/ai-cli.git
cd ai-cli
bun install
bun run --cwd packages/ai-cli build
bun link --cwd packages/ai-cli
export PATH="$HOME/.bun/bin:$PATH"
ai --version
```

For a one-off run without linking, use `bun run packages/ai-cli/src/index.ts text "hello"` from the repository root.

## Configure Cloudflare

[Authenticate the gateway](https://developers.cloudflare.com/ai-gateway/configuration/authentication/), add each upstream credential under **Provider Keys** with the `default` alias, and create a token with **AI Gateway Run** permission. Cloudflare and the `ai-cli` gateway are already the defaults in this fork:

```bash
export CLOUDFLARE_ACCOUNT_ID="your-account-id"
export CLOUDFLARE_AI_GATEWAY_TOKEN="your-ai-gateway-run-token"
```

`CLOUDFLARE_API_TOKEN` is accepted as a fallback when `CLOUDFLARE_AI_GATEWAY_TOKEN` is unset, but it must also grant **AI Gateway Run**. Provider credentials such as `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `REPLICATE_API_TOKEN`, and `FAL_KEY` are not read or forwarded; store them in [Cloudflare BYOK](https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/) instead.

Cloudflare provider-native support in this fork:

| Provider prefix | Text | Image | Video | Speech | Transcription |
| --------------- | ---: | ----: | ----: | -----: | ------------: |
| `openai/`       |  Yes |   Yes |     — |    Yes |           Yes |
| `google/`       |  Yes |   Yes |   Yes |    Yes |           Yes |
| `openrouter/`   |  Yes |   Yes |   Yes |      — |             — |
| `replicate/`    |    — |   Yes |   Yes |      — |             — |
| `fal/` (`fal-ai/` alias) | — | Yes | Yes | Yes | Yes |

Use the complete provider-prefixed ID for deterministic routing:

```bash
ai text -m "google/gemini-2.5-flash-lite" "hello"             # Google key stored in Cloudflare
ai text -m "openrouter/google/gemini-2.5-flash-lite" "hello"  # OpenRouter key stored in Cloudflare
ai text -m "openrouter/anthropic/claude-sonnet-4" "hello"
ai image -m "fal/fal-ai/flux/schnell" "a paper-cut fox"
ai video -m "replicate/prunaai/p-video" "a paper airplane"
ai video -m "fal-ai/minimax/h3-max" --duration 5 "a paper boat crosses a puddle"
ai audio speak -m "fal/fal-ai/minimax/speech-02-turbo" "hello"
ai audio transcribe -m "fal/fal-ai/wizper" recording.mp3
```

## Usage

```bash
ai image "a cute dog"
ai video "a spinning triangle"
ai text "explain quantum computing"
ai audio speak "Thanks for trying ai-cli"
ai audio transcribe recording.mp3
ai models                          # configured providers and defaults
ai models --free                   # OpenRouter free + Google free-tier models
ai models --provider openrouter --search gemini
```

### Piping and References

```bash
ai image "a dragon" | ai video "animate this"
ai video -i input.png "animate this"
ai image --image reference.png "make a sticker in this style"
ai image -i sketch.png -i palette.jpg "render this product concept"
ai text --image screenshot.png "what is broken in this UI?"
cat photo.png | ai text "describe this image"
cat notes.txt | ai text "summarize this"
git diff | ai text "explain these changes"
echo "Ship the changelog" | ai audio speak -o changelog.mp3
cat recording.mp3 | ai audio transcribe
```

### Common Options

All commands support:

```
-m, --model <id>         Full route ID; native provider ID when --provider is set
--gateway <name>        cloudflare (default) or vercel; overrides AI_CLI_GATEWAY
--provider <name>       openrouter, google, openai, fal, replicate (use -m or a selection flag)
-o, --output <path>      Output file path or directory
-n, --count <n>          Number of generations per model (default: 1)
-p, --concurrency <n>    Max parallel generations (default: 4, video: 2)
--timeout <seconds>      Request timeout in seconds (default: text/audio 120, image/video 300)
-q, --quiet              Suppress progress output
--json                   Output metadata as JSON
```

When using `--json`, stdout contains only metadata. Generated text, image, video and audio outputs are written to files even when stdout is piped.

Model IDs can be specified as `provider/model`, `creator/model`, or just `model-name`. Defaults and full IDs route without a catalog request in Cloudflare mode; short names use the configured providers. Ambiguous short names require a full ID:

```bash
ai text -m gpt-5.5 "hello"          # resolves to openai/gpt-5.5
ai image -m flux-2-pro "a sunset"   # resolves to bfl/flux-2-pro
ai audio speak -m tts-1 "hello"     # resolves to openai/tts-1
```

On the default Cloudflare backend, `openai/...`, `google/...`, `openrouter/...`, `replicate/...`, and `fal/...` select provider-native routes. `fal-ai/...` is also accepted for Fal-owned endpoint IDs, and `fal-ai/minimax/h3-max` is a convenience provider/model spelling that selects Fal as the host and MiniMax H3 Max as the publisher/model. The first Gemini example above calls Google directly; the second asks OpenRouter for the same underlying model. Other creator IDs use OpenRouter for text and Replicate for image/video, preserving the full model ID. Speech and transcription require an explicit provider prefix. Discovery follows the selected gateway. Cloudflare mode never fetches Vercel catalogs, including for image generation.

Model IDs must contain printable ASCII characters without spaces. This applies to both `--model` values and the `AI_CLI_*_MODEL` environment variables.

### image

```
-i, --image <path-or-url> Reference image path or URL (repeatable)
--size <WxH>             Image size (e.g. 1024x1024)
--aspect-ratio <W:H>     Aspect ratio (e.g. 16:9)
--quality <level>        Quality (standard, hd)
--style <style>          Style (vivid, natural)
--no-preview             Disable inline image preview
```

Reference images can be local paths, `file://` URLs, `http(s)://` URLs or data URLs. You can repeat `--image` to pass multiple references, and you can still pipe one image through stdin:

```bash
cat input.png | ai image -i style.png "combine the subject with this style"
```

Reference-image support is model-dependent; unsupported models may reject image inputs.

Gemini image models (e.g. `google/gemini-2.5-flash-image`) don't support `--size`; use `--aspect-ratio` instead.

### video

```
-i, --image <path-or-url> Image input path or URL
--aspect-ratio <W:H>     Aspect ratio (e.g. 16:9)
--resolution <WxH>       Video resolution (e.g. 1920x1080 for 1080p)
--duration <seconds>     Duration in seconds
--no-preview             Disable inline video frame preview
```

Image inputs can be local paths, `file://` URLs, `http(s)://` URLs or data URLs. Video generation accepts one input image, provided either through `--image` or piped stdin:

```bash
ai video -i input.png "animate this"
cat input.png | ai video "animate this"
ai video -m "fal-ai/minimax/h3-max" --duration 5 "a paper boat crosses a puddle"
ai video -m "fal-ai/minimax/h3-max" -i input.png "slowly dolly toward the subject"
```

The H3 Max provider model selects Fal's documented [text-to-video](https://fal.ai/models/minimax/h3-max/text-to-video/api) or image-to-video endpoint from the input and handles queue submission, polling, and result retrieval inside the CLI. The exact endpoint forms, such as `fal/minimax/h3-max/text-to-video`, remain valid. Resolution support is model-dependent; H3 Max accepts 480p or 768p output, selected with a matching height such as `854x480` or `1366x768`.

### text

```
-f, --format <fmt>       Output format: md, txt (default: md)
-i, --image <path-or-url> Image input path or URL for vision (repeatable)
-s, --system <prompt>    System prompt
--max-tokens <n>         Maximum tokens to generate
-t, --temperature <n>    Temperature (0-2)
```

For vision-capable text models, `ai text` accepts images from `--image` or piped stdin:

```bash
ai text -i chart.png -i table.jpg "summarize the data"
cat screenshot.png | ai text "list the visible errors"
```

### audio

`audio` has two subcommands:

```bash
ai audio speak "Hello from AI Gateway"
ai audio transcribe recording.mp3
```

#### audio speak

```
-f, --format <fmt>       Audio output format (default: mp3)
--voice <voice>          Voice to use for speech generation
--instructions <text>    Instructions for speech generation
--speed <n>              Speech speed
--language <code>        Language code (e.g. en, fr) or auto
--no-play                Disable audio playback after generation
--no-waveform            Disable accurate terminal waveform preview
```

`audio speak` accepts text from an argument or stdin and saves audio to `<id>.mp3` by default:

```bash
ai audio speak --voice alloy "Read this as a friendly update"
cat announcement.txt | ai audio speak --format wav -o announcement.wav
```

When using OpenAI speech models, `ai audio speak` defaults to the `alloy` voice unless `--voice` is provided.

When `-o` points to a file with a known audio extension and `--format` is omitted, the extension selects the audio format. If both are provided, `--format` must match the filename extension.

In interactive terminals, `audio speak` plays the generated audio after saving it and shows an accurate waveform derived from decoded audio samples. Use `--no-play` to skip playback and `--no-waveform` or `--quiet` to suppress the waveform. Playback and waveform previews are skipped for `--json` and binary stdout pipeline output. WAV output is decoded directly; MP3 and other encoded formats use a local decoder when available (`ffmpeg`, `mpg123`, `sox`, or `afconvert`).

#### audio transcribe

```
-f, --format <fmt>       Output format: md, txt (default: txt)
```

`audio transcribe` accepts a local path, `file://` URL, `http(s)://` URL or piped audio:

```bash
ai audio transcribe meeting.mp3
ai audio transcribe https://example.com/call.wav
cat voice-note.mp3 | ai audio transcribe -o transcript.txt
```

### models

Bare `ai models` shows configured Cloudflare providers and command defaults without dumping their catalogs. Browse with filters; filtered text output shows the first 20 matches, with full IDs you can copy into `-m`.

```bash
ai models --free                                    # OpenRouter free + Google free-tier models
ai models --provider openrouter --search gemini      # search a provider
ai models --provider openrouter --creator openai     # OpenAI models hosted by OpenRouter
ai models --type image --limit 50                    # image models across configured providers
ai models --provider openrouter --all                # all OpenRouter matches
ai models --free --json                              # all free matches as a JSON array
ai models openrouter/google/gemini-2.5-flash-lite      # model details and pricing
ai models --provider replicate --search flux         # native Replicate catalog search
ai models --gateway vercel                           # explicit upstream discovery
```

| Option | Meaning |
| --- | --- |
| `[model]` | Full route ID or unambiguous short name; show details |
| `--provider <name>` | Host: `openrouter`, `google`, `openai`, `fal`, `replicate` |
| `--creator <name>` | Model author, such as `google` within OpenRouter |
| `--type <type>` | `text`, `image`, `video`, `audio`, `speech`, `transcription` |
| `--search <text>` | Search IDs, names, and descriptions |
| `--free` | OpenRouter zero-price models and Google free-tier eligible models |
| `--best` | Saved best choices; combine with `--free` for best-free choices |
| `--cheapest` | Show saved low-cost model choices |
| `--limit <n>` | Show at most this many matching models |
| `--all` | Display every match; also fetch all Replicate catalog pages |
| `--json` | JSON array, untruncated unless `--limit` is supplied |
| `--gateway <name>` | `cloudflare` (default) or `vercel` |

Discovery reads the gateway's Provider Keys with the `default` alias, then queries those providers through Cloudflare BYOK. OpenRouter uses its account-filtered catalog, including provider preferences, privacy settings, and guardrails. Free models still have rate limits. Google free-tier eligibility is distinct from project billing. Catalog access does not prove inference credit or quota. Fal and Replicate models can require inputs beyond the CLI's options; unknown types remain `unclassified`. Replicate types are inferred from example output, and its large public catalog starts with one page unless `--all` is supplied; stderr reports partial coverage, including with JSON. Use `--provider replicate --search <text>` for native search instead of scanning the entire catalog.

Automatic provider detection needs `CLOUDFLARE_API_TOKEN` with AI Gateway Read permission (or a suitably scoped `CLOUDFLARE_AI_GATEWAY_TOKEN`). With only a Run token, select `--provider openrouter` or explicitly declare your stored providers using `AI_CLI_PROVIDERS=openrouter,google,fal,replicate`. This declares inventory; it does not install keys or verify credit. Failed providers are reported on stderr; if every requested catalog fails, the command exits nonzero. Vercel's original listing/detail behavior remains available with `--gateway vercel`; provider, free, best, cheapest, search, and limit filters are Cloudflare-only.

### Gateway and provider selection

Every generation command (`text`, `image`, `video`, `audio speak`, `audio transcribe`) accepts `--gateway` and `--provider`. Put these options after the command. A gateway transports requests; a provider hosts the model or routes it onward.

```bash
ai text -m openrouter/google/gemini-2.5-flash-lite "hello"
ai text --provider openrouter -m google/gemini-2.5-flash-lite "hello"
ai text --provider google -m gemini-2.5-flash-lite "hello"
ai image --provider fal -m fal-ai/flux/schnell "a sunset"
ai video --provider replicate -m prunaai/p-video "a paper airplane"
ai audio speak --provider fal -m fal-ai/minimax/speech-02-turbo "hello"
ai audio transcribe --provider fal -m fal-ai/wizper recording.mp3
```

With `--provider`, `-m` is the provider's **native** ID: do not add the CLI host prefix again. OpenRouter's native free router is `openrouter/free`, so use `--provider openrouter -m openrouter/free` or the full CLI ID `-m openrouter/openrouter/free`. Without `--provider`, copy the full ID from `ai models`. Provider selection requires `-m` or a selection flag and is only used in Cloudflare mode. `--gateway` overrides `AI_CLI_GATEWAY`; explicit Vercel mode uses upstream defaults unless `-m` or `AI_CLI_*_MODEL` overrides them.

### Multi-Model Comparison

Generate with multiple models by comma-separating `-m`:

```bash
ai image "a sunset" -m "openai/gpt-image-1,xai/grok-imagine-image,bfl/flux-2-pro"
```

Combine with `-n` to generate multiple per model:

```bash
ai image "a sunset" -n 2 -m "openai/gpt-image-1,bfl/flux-2-pro"   # 4 images total
```

### Inline Preview

When running in a terminal that supports the [Kitty graphics protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/) (Kitty, Ghostty, WezTerm, Warp, iTerm2), generated images and videos are displayed inline automatically. Image formats returned by models are preserved on disk and converted to PNG for terminal previews when needed. Video previews decode an H.264 keyframe from the midpoint of the video using [openh264](https://github.com/cisco/openh264) compiled to WebAssembly — no native dependencies required. `audio speak` can also play generated speech and render a terminal waveform after saving. Use `--no-preview` for image/video previews, `--no-play` or `--no-waveform` for audio previews, or set `AI_CLI_PREVIEW=1` to force visual previews on in undetected terminals.

### Output Behavior

- **text**: saves to `<id>.md` (interactive), stdout when piped
- **image/video**: saves to `<id>.<format>` / `<id>.mp4` (interactive), preserving the image format returned by the model, raw binary stdout when piped
- **audio speak**: saves to `<id>.mp3` (interactive), raw binary stdout when piped
- **audio transcribe**: saves to `<id>.txt` (interactive), stdout when piped
- **`-o <dir>`**: saves inside the directory with auto-generated names

When the CLI needs to choose a filename, it uses a response id when available and falls back to a random 8-character id.

### Environment Variables

| Variable                      | Description                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `AI_CLI_GATEWAY`              | Gateway backend: `cloudflare` (default) or `vercel`                                              |
| `AI_GATEWAY_API_KEY`          | Vercel AI Gateway key; used only with `AI_CLI_GATEWAY=vercel`                                    |
| `CLOUDFLARE_ACCOUNT_ID`       | Cloudflare account ID; required in Cloudflare mode                                               |
| `CLOUDFLARE_AI_GATEWAY_ID`    | Cloudflare AI Gateway name (default: `ai-cli`)                                                   |
| `CLOUDFLARE_AI_GATEWAY_TOKEN` | Preferred Cloudflare token; must grant AI Gateway Run                                            |
| `CLOUDFLARE_API_TOKEN`        | Fallback Cloudflare token when `CLOUDFLARE_AI_GATEWAY_TOKEN` is unset; must grant AI Gateway Run |
| `AI_CLI_MODEL_PREFERENCES` | Optional path to a JSON override for defaults, best, cheapest and bestFree preferences |
| `AI_CLI_PROVIDERS`          | Optional comma-separated stored provider inventory for Run-only tokens; otherwise detected from Cloudflare |
| `AI_CLI_TEXT_MODEL`           | Default text model (overrides `google/gemini-3.8-flash`)                         |
| `AI_CLI_IMAGE_MODEL`          | Default image model (overrides `fal/fal-ai/flux/schnell`)                                        |
| `AI_CLI_VIDEO_MODEL`          | Default video model (overrides `replicate/prunaai/p-video`)                                      |
| `AI_CLI_SPEECH_MODEL`         | Default speech model (overrides `fal/fal-ai/minimax/speech-02-turbo`)                            |
| `AI_CLI_TRANSCRIPTION_MODEL`  | Default transcription model (overrides `fal/fal-ai/wizper`)                                      |
| `AI_CLI_OUTPUT_DIR`           | Default output directory for generated files                                                     |
| `AI_CLI_PREVIEW`              | Set to `1` to force inline image preview, `0` to disable                                         |
| `NO_COLOR`                    | Disable ANSI color output                                                                        |
| `FORCE_COLOR`                 | Force color output even when not a TTY                                                           |

The `-m` flag always takes priority over `AI_CLI_*_MODEL` env vars. The `-o` flag always takes priority over `AI_CLI_OUTPUT_DIR`.

The default Cloudflare backend intentionally ignores local provider credentials. Configure each provider key in the gateway's **Provider Keys** page through BYOK. To use Vercel instead, set both `AI_CLI_GATEWAY=vercel` and `AI_GATEWAY_API_KEY`.

### Timeouts

Requests that exceed the timeout are aborted automatically:

| Command            | Timeout     |
| ------------------ | ----------- |
| `text`             | 120 seconds |
| `image`            | 300 seconds |
| `video`            | 300 seconds |
| `audio speak`      | 120 seconds |
| `audio transcribe` | 120 seconds |

Use `--timeout <seconds>` to override the default for `text`, `image`, `video`, `audio speak`, or `audio transcribe`. The value must be a positive integer. For example, `ai image --timeout 600 "a detailed sprite atlas"` allows the request to run for up to 10 minutes.

### Exit Codes

| Code | Meaning                                       |
| ---- | --------------------------------------------- |
| `0`  | Success                                       |
| `1`  | All generations failed                        |
| `2`  | Partial failure (some succeeded, some failed) |

## License

[Apache-2.0](LICENSE)

### Setup checks and model preferences

```bash
ai gateways                         # gateway choices and override syntax
ai providers                        # configured hosts and supported commands
ai doctor                           # credentials/config + catalogs; no inference
ai doctor --probe                    # test default text model; may incur cost
ai doctor --probe -m google/gemini-3.8-flash
ai providers google/gemni-2.5-flash-lite   # alternative hosts / spelling suggestions
```

The normal text default is direct `google/gemini-3.8-flash`, even without `--free`. Its published Google free tier covers input/output tokens, subject to the key's project tier and quota. Paid projects pay standard rates. The CLI prints the selected model to stderr when generation starts, including when stdout is piped; `--quiet` suppresses it.

```bash
ai text "hello"                      # Google 3.8 Flash
ai text --free "hello"               # prefer an eligible free choice from live catalogs
ai text --best "review this design"  # saved Gemini Pro preference
ai text --best --free "hello"        # saved best-free preference, checked against catalogs
ai text --cheapest "hello"           # saved low-cost text choice: GPT-5.6 Luna
ai video --best "a boat on a lake"   # H3 Max through Fal
ai models --best                     # saved choices, not benchmark rankings
ai models --best --free              # available best-free preferences
ai models --cheapest                 # saved low-cost choices
```

Choices live in [`src/fork/model-preferences.json`](src/fork/model-preferences.json): `defaults`, `best`, `cheapest`, and ordered `bestFree` lists. The default and best-free text choice is Google 3.8 Flash; best text is provisionally Gemini 3.1 Pro through OpenRouter; best video is H3 Max through Fal. Other quality preferences are unset. These are editable preferences, not universal quality claims. Rebuild after editing the bundled file, or set `AI_CLI_MODEL_PREFERENCES=/absolute/path/models.json` to load a partial JSON override at runtime. For example: `{"best":{"text":"openrouter/openai/gpt-5.6-luna"}}`. `AI_CLI_*_MODEL` still overrides the normal default; `-m` or a selection flag takes precedence over that default. Use `--free -m <full-id>` to verify a specific route is listed as free before generating; `--best` and `--cheapest` choose their saved model instead. With a selection flag, `--provider` restricts the host instead of requiring `-m`.

`--free` includes OpenRouter models with explicit zero listed prices and exact Google models with a published free tier. Google eligibility is tracked separately from verified zero billing: the model-list API cannot report the stored key's project tier. The [Google pricing table](https://ai.google.dev/gemini-api/docs/pricing) and [billing guide](https://ai.google.dev/gemini-api/docs/billing) explain this distinction. Metadata is dated and source-linked in `src/fork/google-pricing.ts`. OpenRouter prices come from its [authenticated account catalog](https://openrouter.ai/docs/api/api-reference/models/list-models-filtered-by-user-provider-preferences-privacy-settings-and-guardrails) on each lookup. No local provider key is needed.

`--cheapest` uses the saved low-cost frontier preference: `openrouter/openai/gpt-5.6-luna` for text. It is an editable choice, not a claim of the lowest live catalog price. The image choice is `fal/fal-ai/sana`; other cheapest preferences are unset. Free selection never silently falls back to paid inference.

Failed generation preserves the provider error and suggests exact matching routes or likely spelling corrections from configured catalogs. These are labeled as untested and may have different prices. The CLI does not automatically switch hosts or resubmit failed media jobs. `doctor --probe --model <full-id>` explicitly tests one text route; a normal doctor run checks setup/catalog access only and returns a nonzero exit code for failed checks. Both diagnostics and suggestions support JSON where advertised in help.

Gateway and provider are separate: the default gateway is Cloudflare; `openrouter/openai/gpt-5.6-luna` uses its stored OpenRouter key, while `openai/gpt-5.6-luna` uses its stored OpenAI key. Direct OpenRouter without Cloudflare is not currently a gateway option. Prefer OpenRouter where practical, with direct Google for free text and Fal for media choices; saved full routes keep billing hosts explicit. The existing Replicate video default remains selectable alongside Fal. For example, `ai image -m openrouter/google/gemini-3.1-flash-image-preview "a blue square"` generates through Cloudflare and OpenRouter.

### Low-cost image generation

```sh
ai image --cheapest "a small sailboat"                 # Sana through Cloudflare/Fal
ai image --cheapest --size 512x512 "a small sailboat"  # small draft
ai models --cheapest --type image
ai models --free --type image
```

The saved image choice is Sana through Fal, [listed at $0.001 per megapixel](https://fal.ai/models/fal-ai/sana), checked 2026-09-06. A 512×512 image was generated successfully with the installed CLI. Size support and billing units vary by model: do not assume a 512×512 image costs one quarter of a 1024×1024 image. For example, [Fal Flux Schnell rounds up to a whole megapixel](https://fal.ai/docs/model-api-reference/image-generation-api/flux-schnell). Plain `ai image` retains its Flux Schnell default; `--cheapest` chooses Sana explicitly.

The existing Google/OpenRouter routes have no verified free image offer. [OpenRouter documents no free image-generation models](https://openrouter.ai/blog/tutorials/image-generation-models/), and Google's text free tier does not include its paid image models. `--free` fails without sending paid inference and suggests the saved cheapest option. Cloudflare Workers AI has a [daily free allocation](https://developers.cloudflare.com/workers-ai/platform/pricing/), and this CLI now has a guarded Workers AI FLUX.1 Schnell adapter. The adapter is currently disabled by choice because the daily allowance was not worth the integration. If enabled, it requires a verified Workers Free plan or an enabled Workers AI gateway spending cap for ordinary generation. `--free` requires the free plan; a capped paid route is not advertised as free. Cloudflare gateway routing alone does not grant this allowance to Fal or OpenRouter requests.

### Patrick's Mac launcher

The installed `~/.local/bin/ai` points to this checkout's `scripts/mac-ai.mjs`. It automatically loads only Cloudflare auth assignments from `~/Code/specialagent/.env.local`, preserves existing environment overrides, and runs the built CLI. No per-command `source`, provider keys, or working-directory setup is needed. This local launcher is separate from the portable npm CLI. Rebuild after source changes. To restore the local link from the repository root:

```sh
bun run --cwd packages/ai-cli build
ln -sfn "$PWD/scripts/mac-ai.mjs" "$HOME/.local/bin/ai"
node --test scripts/mac-ai.test.mjs
```

### Workers AI and provider notes

```sh
ai providers --all                 # compact overview of supported hosts
ai providers --all --details       # auth, billing notes, catalog and pricing links
ai doctor --provider workers-ai    # check access and billing protection
ai models --provider workers-ai --free --type image
ai image --provider workers-ai -m @cf/black-forest-labs/flux-1-schnell "a sailboat"
```

Workers AI integration is **disabled by choice**: its 10,000-neuron daily allowance is worth about $0.11 at the published rate. A tested FLUX.1 Schnell adapter is retained as reference; these generation commands refuse requests while disabled. If enabled, Workers AI runs FLUX.1 Schnell through the existing Cloudflare gateway. Ordinary generation requires a verified Workers Free plan or a provider-wide gateway cap of at most $20 over at least 30 days. Patrick's gateway has that cap for Workers AI only; concurrent requests can overshoot it. `--free` still refuses capped paid routes. No Worker deployment or prepaid credits are needed. The image adapter supports native resolution, not arbitrary `--size` or reference images. Live 1024×1024 image generation and gateway logging are verified. Existing Fal defaults stay in place.

The central provider registry is `src/fork/providers.ts`; `ai providers --all` reads it. `docs/providers.md` in the source repository explains the routing design, billing safeguards, and extension checklist. Editorial model preferences remain in `src/fork/model-preferences.json`.

Human output uses bold provider names, terminal colors and grouped command examples. Capability lists are under `ai providers --details`; JSON retains them. Piped output is plain text; set `NO_COLOR=1` to disable terminal styling.
