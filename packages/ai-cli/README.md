# ai-cli — Cloudflare BYOK fork

This is Patrick's fork of [vercel-labs/ai-cli](https://github.com/vercel-labs/ai-cli). It keeps the upstream command surface and Vercel AI SDK, but makes an authenticated Cloudflare AI Gateway the default and keeps provider credentials in Cloudflare rather than in the CLI environment.

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
ai models                          # list available models
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
-m, --model <id>         Model ID (provider/model or creator/model), comma-separated for multi-model
-o, --output <path>      Output file path or directory
-n, --count <n>          Number of generations per model (default: 1)
-p, --concurrency <n>    Max parallel generations (default: 4, video: 2)
--timeout <seconds>      Request timeout in seconds (default: text/audio 120, image/video 300)
-q, --quiet              Suppress progress output
--json                   Output metadata as JSON
```

When using `--json`, stdout contains only metadata. Generated text, image, video and audio outputs are written to files even when stdout is piped.

Model IDs can be specified as `provider/model`, `creator/model`, or just `model-name`. Text, video, and audio defaults and full IDs route without a catalog request; short names are expanded with the public discovery catalog. Image generation also uses catalog metadata to distinguish language-image models:

```bash
ai text -m gpt-5.5 "hello"          # resolves to openai/gpt-5.5
ai image -m flux-2-pro "a sunset"   # resolves to bfl/flux-2-pro
ai audio speak -m tts-1 "hello"     # resolves to openai/tts-1
```

On the default Cloudflare backend, `openai/...`, `google/...`, `openrouter/...`, `replicate/...`, and `fal/...` select provider-native routes. `fal-ai/...` is also accepted for Fal-owned endpoint IDs, and `fal-ai/minimax/h3-max` is a convenience provider/model spelling that selects Fal as the host and MiniMax H3 Max as the publisher/model. The first Gemini example above calls Google directly; the second asks OpenRouter for the same underlying model. Other creator IDs use OpenRouter for text and Replicate for image/video, preserving the full model ID. Speech and transcription require an explicit provider prefix. The `models` command and short-name expansion use Vercel's public catalog only for discovery; text, video, and audio generation with defaults or full IDs does not depend on it.

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

```
[model]                  Show detailed info for a model (e.g. anthropic/claude-opus-4.6)
--type <type>            Filter by type: text, image, video, audio, speech, transcription
--creator <name>         Filter by creator (e.g. openai, google)
--json                   Output as JSON (includes descriptions)
```

All model types (text, image, video, speech, transcription) are fetched live from the AI Gateway.

Pass a model ID (or short name) to see its context window, max output, pricing, release date and per-provider latency, throughput and uptime:

```
$ ai models claude-opus-4.6

Claude Opus 4.6  anthropic/claude-opus-4.6
Released 2026-02-05 · tool-use · reasoning · vision · web-search

  Context      1M
  Max output   128K
  Input        $5/M
  Output       $25/M
  Cache read   $0.5/M
  Cache write  $6.25/M
  Web search   $10/K + input costs

Providers
  provider   context  latency  throughput  uptime
  anthropic  1M       1.4s     49tps       99.9%
  bedrock    1M       1.4s     56tps       99.9%
```

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

When running in a terminal that supports the [Kitty graphics protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/) (Kitty, Ghostty, WezTerm, Warp, iTerm2), generated images and videos are displayed inline automatically. Video previews decode an H.264 keyframe from the midpoint of the video using [openh264](https://github.com/cisco/openh264) compiled to WebAssembly — no native dependencies required. `audio speak` can also play generated speech and render a terminal waveform after saving. Use `--no-preview` for image/video previews, `--no-play` or `--no-waveform` for audio previews, or set `AI_CLI_PREVIEW=1` to force visual previews on in undetected terminals.

### Output Behavior

- **text**: saves to `<id>.md` (interactive), stdout when piped
- **image/video**: saves to `<id>.png` / `<id>.mp4` (interactive), raw binary stdout when piped
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
| `AI_CLI_TEXT_MODEL`           | Default text model (overrides `openrouter/google/gemini-2.5-flash-lite`)                         |
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
