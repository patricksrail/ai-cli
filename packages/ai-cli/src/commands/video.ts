import { experimental_generateVideo as generateVideo } from "ai";

import { generationRetryOptions } from "../fork/generation.js";
import { addRoutingOptions, type RoutingOptions } from "../fork/options.js";
import type { Command } from "../lib/command.js";
import { errorMessage } from "../lib/errors.js";
import {
  resolveGatewayBackend,
  videoDownload,
  videoModel,
} from "../lib/gateway.js";
import {
  collectImageReference,
  loadImageReferences,
  type ImageReference,
} from "../lib/image-references.js";
import { buildJobs, runJobs } from "../lib/jobs.js";
import { resolveCommandModels } from "../lib/models.js";
import {
  parsePositiveInt,
  parseAspectRatio,
  parseNonNegativeFloat,
  parseSize,
} from "../lib/parse.js";
import { responseIdFromHeaders } from "../lib/response-id.js";
import { readStdin } from "../lib/stdin.js";
import { addTimeoutOption, timeoutMs } from "../lib/timeout.js";
import {
  readVideoJob,
  recoverableVideoModel,
  videoResumeCommand,
} from "../lib/video-jobs.js";

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_TIMEOUT_MS = 300_000;

interface VideoOptions extends RoutingOptions {
  model?: string;
  output?: string;
  image?: string[];
  count?: string;
  aspectRatio?: string;
  resolution?: string;
  duration?: string;
  quiet?: boolean;
  json?: boolean;
  concurrency?: string;
  preview?: boolean;
  timeout: number;
  resume?: string;
}

export function registerVideoCommand(program: Command) {
  const command = program
    .command("video")
    .description("Generate a video from a prompt")
    .argument("[prompt]", "The prompt to generate a video from")
    .option(
      "-m, --model <model>",
      "Full route ID (fal/minimax/h3-max/text-to-video) or native ID with --provider; comma-separated"
    )
    .option("-o, --output <path>", "Output file path or directory")
    .option(
      "--resume <job-file>",
      "Wait for an existing video job without submitting another"
    )
    .option(
      "-i, --image <path-or-url>",
      "Image input path or URL",
      collectImageReference,
      []
    )
    .option("-n, --count <n>", "Number of videos per model (default: 1)")
    .option("--aspect-ratio <W:H>", "Aspect ratio (e.g. 16:9)")
    .option("--resolution <WxH>", "Video resolution (e.g. 1920x1080)")
    .option("--duration <seconds>", "Video duration in seconds")
    .option("-q, --quiet", "Suppress progress output")
    .option("--json", "Output metadata as JSON")
    .option(
      "--no-preview",
      "Disable inline video frame preview in supported terminals"
    )
    .option(
      "-p, --concurrency <n>",
      `Max parallel generations (default: ${DEFAULT_CONCURRENCY})`
    );
  const generation = addRoutingOptions(
    addTimeoutOption(command, DEFAULT_TIMEOUT_MS),
    "video"
  );
  generation.action(
    async (rawPrompt: string | undefined, opts: VideoOptions) => {
      const prompt = rawPrompt?.trim() || undefined;
      const resumed = opts.resume ? await readVideoJob(opts.resume) : undefined;
      if (resumed) {
        if (resumed.gateway !== resolveGatewayBackend())
          throw new Error(
            `This job uses ${resumed.gateway}; pass --gateway ${resumed.gateway}`
          );
        if (
          prompt ||
          opts.model ||
          opts.image?.length ||
          opts.count ||
          opts.aspectRatio ||
          opts.resolution ||
          opts.duration ||
          opts.best ||
          opts.cheapest ||
          opts.free ||
          opts.provider ||
          opts.fallbacks
        )
          throw new Error(
            "--resume accepts output, timeout and display options; generation inputs cannot change an existing job"
          );
      }
      // A resumed operation needs neither the original prompt nor image/stdin.
      const stdin = resumed ? undefined : await readStdin();
      const imageReferenceInputs = opts.image ?? [];
      if (!resumed && !prompt && !stdin && imageReferenceInputs.length === 0) {
        process.stderr.write(
          "Error: prompt or image is required (provide a prompt, --image, or pipe an image via stdin)\n"
        );
        process.exit(1);
      }

      let referenceImages: ImageReference[] = [];
      try {
        referenceImages = await loadImageReferences(imageReferenceInputs);
      } catch (err) {
        process.stderr.write(`Error: ${errorMessage(err)}\n`);
        process.exit(1);
      }

      const images: ImageReference[] = [
        ...(stdin ? [new Uint8Array(stdin)] : []),
        ...referenceImages,
      ];
      if (images.length > 1) {
        process.stderr.write(
          "Error: video generation accepts one input image; provide one --image value or pipe one image via stdin\n"
        );
        process.exit(1);
      }

      let videoPrompt: string | { image: ImageReference; text?: string } =
        prompt!;
      if (images.length > 0) {
        videoPrompt = prompt
          ? { image: images[0]!, text: prompt }
          : { image: images[0]! };
      }

      const models = resumed
        ? [resumed.model]
        : await resolveCommandModels("video", opts.model);
      const countPerModel = opts.count
        ? parsePositiveInt(opts.count, "count")
        : 1;
      const generationOptions = videoGenerationOptions(opts);

      const jobs = buildJobs(models, countPerModel);

      const { total, failed } = await runJobs(
        jobs,
        async (modelId) => {
          const abort = AbortSignal.timeout(timeoutMs(opts.timeout));
          const recovery = await recoverableVideoModel(
            videoModel(modelId),
            modelId,
            resolveGatewayBackend(),
            {
              resume: resumed
                ? { path: opts.resume!, job: resumed }
                : undefined,
              onSaved: (path) => {
                if (!opts.quiet)
                  process.stderr.write(
                    `Video job saved. Resume: ${videoResumeCommand(path, resolveGatewayBackend())}\n`
                  );
              },
            }
          );
          try {
            const result = await generateVideo({
              ...generationRetryOptions(),
              headers: {
                "http-referer": "https://github.com/vercel-labs/ai-cli",
                "x-title": "ai-cli",
              },
              model: recovery.model,
              prompt: resumed ? "" : videoPrompt,
              // --timeout is the single deadline; do not let the SDK silently
              // impose its separate ten-minute polling limit.
              poll: { timeoutMs: Infinity },
              abortSignal: abort,
              download: videoDownload(modelId),
              ...generationOptions,
            });
            return {
              data: Buffer.from(result.video.uint8Array),
              id: responseIdFromHeaders(result.responses[0]?.headers),
            };
          } catch (error) {
            throw recovery.explainFailure(abort.aborted ? abort.reason : error);
          }
        },
        {
          noun: "video",
          modality: "video",
          routing: resumed ? { fallback: false } : opts,
          format: "video",
          outputPath: opts.output,
          quiet: opts.quiet,
          json: opts.json,
          display: opts.preview,
          concurrency: opts.concurrency
            ? parsePositiveInt(opts.concurrency, "concurrency")
            : DEFAULT_CONCURRENCY,
        }
      );
      if (failed === total) process.exit(1);
      if (failed > 0) process.exit(2);
    }
  );
}

export function videoGenerationOptions(opts: {
  aspectRatio?: string;
  resolution?: string;
  duration?: string;
}) {
  return {
    aspectRatio: opts.aspectRatio
      ? parseAspectRatio(opts.aspectRatio)
      : undefined,
    resolution: opts.resolution
      ? parseSize(opts.resolution, "resolution")
      : undefined,
    duration: opts.duration
      ? parseNonNegativeFloat(opts.duration, "duration")
      : undefined,
  };
}
