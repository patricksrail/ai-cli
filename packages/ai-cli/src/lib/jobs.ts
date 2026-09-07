/**
 * Job execution and output. Generation policy is passed explicitly to the fork
 * runner; this module saves bytes and reports which route actually produced them.
 * File/preview failures are handled here and never trigger another inference.
 */
import { FallbackError, type Attempt } from "../fork/fallback.js";
import {
  generateWithGuidance,
  type GenerationPolicy,
} from "../fork/generation.js";
import { errorMessage } from "./errors.js";
import {
  supportsKittyGraphics,
  displayImage,
  displayVideoFrame,
} from "./kitty.js";
import type { Modality } from "./models.js";
import type { OutputFormat } from "./output.js";
import { writeOutput } from "./output.js";
import { pMap } from "./p-map.js";
import { Progress, MultiProgress, formatElapsed } from "./progress.js";

export interface Job {
  modelId: string;
  label: string;
  index: number;
}

export interface RunJobsOptions {
  /** Human output label (e.g. audio); modality below controls recovery safety. */
  noun: string;
  modality: Modality;
  routing?: GenerationPolicy;
  format: OutputFormat;
  outputPath?: string;
  extension?: string;
  quiet?: boolean;
  json?: boolean;
  concurrency: number;
  display?: boolean;
  afterOutputs?: (outputs: RunJobOutput[]) => Promise<void> | void;
}

export interface RunJobOutput {
  index: number;
  model: string;
  label: string;
  data: Buffer | string;
  file: string | null;
  elapsed_ms: number;
}

export function buildJobs(models: string[], countPerModel: number): Job[] {
  let jobIndex = 0;
  return models.flatMap((modelId) =>
    Array.from({ length: countPerModel }, (_, i) => ({
      modelId,
      label: models.length > 1 ? `${modelId} #${i + 1}` : `#${i + 1}`,
      index: jobIndex++,
    }))
  );
}

export interface RunJobsResult {
  total: number;
  failed: number;
}

export interface GeneratedOutput {
  data: Buffer | string;
  id?: string;
  mediaType?: string;
}

type GenerateResult = Buffer | string | GeneratedOutput;

export async function runJobs(
  jobs: Job[],
  generate: (modelId: string) => Promise<GenerateResult>,
  opts: RunJobsOptions
): Promise<RunJobsResult> {
  const {
    noun,
    modality,
    routing,
    format,
    outputPath,
    extension,
    quiet,
    json,
    concurrency,
    display,
    afterOutputs,
  } = opts;

  if (jobs.length === 1) {
    const job = jobs[0];
    const { modelId } = job;
    const progress = new Progress(quiet);
    const start = Date.now();
    progress.start(`Generating ${noun} with ${modelId}`);

    try {
      const execution = await generateWithGuidance(modelId, generate, {
        modality,
        quiet,
        routing,
      });
      const generated = normalizeGeneratedOutput(execution.value);
      const elapsed = Date.now() - start;
      progress.stop(`Generated ${noun} with ${execution.model}`);

      if (json) {
        const path = await writeOutput({
          data: generated.data,
          format,
          outputPath,
          outputId: generated.id,
          extension,
          mediaType: generated.mediaType,
          forceFile: true,
          quiet: true,
          display: false,
        });
        const meta = {
          elapsed_ms: elapsed,
          count: 1,
          results: [
            {
              index: 1,
              model: execution.model,
              requested_model: modelId,
              attempts: execution.attempts,
              elapsed_ms: elapsed,
              success: true,
              file: path,
            },
          ],
        };
        process.stdout.write(JSON.stringify(meta, null, 2) + "\n");
      } else {
        const path = await writeOutput({
          data: generated.data,
          format,
          outputPath,
          outputId: generated.id,
          extension,
          mediaType: generated.mediaType,
          quiet,
          display,
        });
        await afterOutputs?.([
          {
            index: 0,
            model: execution.model,
            label: job.label,
            data: generated.data,
            file: path,
            elapsed_ms: elapsed,
          },
        ]);
      }
    } catch (err) {
      progress.stop();
      if (json)
        process.stdout.write(
          JSON.stringify(
            {
              elapsed_ms: Date.now() - start,
              count: 0,
              results: [
                {
                  index: 1,
                  requested_model: modelId,
                  model: null,
                  success: false,
                  file: null,
                  error: errorMessage(err),
                  attempts: failureAttempts(err),
                },
              ],
            },
            null,
            2
          ) + "\n"
        );
      throw err;
    }
    return { total: 1, failed: 0 };
  }

  const multi = new MultiProgress(quiet);
  const start = Date.now();
  const shouldDisplay =
    !json &&
    display !== false &&
    (format === "image" || format === "video") &&
    process.stdout.isTTY &&
    supportsKittyGraphics();

  const lineIdxs = jobs.map((j) =>
    multi.addLine(`Generating ${noun} ${j.label} with ${j.modelId}`)
  );

  const results: {
    index: number;
    model: string;
    requested_model: string;
    attempts: Attempt[];
    error?: string;
    success: boolean;
    elapsed_ms: number;
    file: string | null;
  }[] = [];
  const collectOutputs = !json && Boolean(afterOutputs);
  const outputs: RunJobOutput[] = [];
  const pendingDisplayBuffers: Buffer[] = [];

  await pMap(
    jobs,
    async (job, i) => {
      multi.startLine(lineIdxs[i]);
      const genStart = Date.now();
      try {
        const execution = await generateWithGuidance(job.modelId, generate, {
          modality,
          quiet,
          routing,
        });
        const generated = normalizeGeneratedOutput(execution.value);
        const genElapsed = Date.now() - genStart;
        const suffix = `${i + 1}`;
        const path = await writeOutput({
          data: generated.data,
          format,
          outputPath,
          outputId: generated.id,
          suffix,
          extension,
          mediaType: generated.mediaType,
          forceFile: Boolean(json),
          quiet: true,
          display: false,
        });
        if (shouldDisplay && Buffer.isBuffer(generated.data)) {
          pendingDisplayBuffers.push(generated.data);
        }
        const savedMsg = path
          ? `Saved to ${path}`
          : `${noun[0].toUpperCase()}${noun.slice(1)} ${job.label} written to stdout`;
        multi.completeLine(
          lineIdxs[i],
          `${savedMsg} (${formatElapsed(genElapsed)})`
        );
        results.push({
          index: i,
          model: execution.model,
          requested_model: job.modelId,
          attempts: execution.attempts,
          success: true,
          elapsed_ms: genElapsed,
          file: path,
        });
        if (collectOutputs) {
          outputs.push({
            index: i,
            model: execution.model,
            label: job.label,
            data: generated.data,
            file: path,
            elapsed_ms: genElapsed,
          });
        }
      } catch (err: unknown) {
        const genElapsed = Date.now() - genStart;
        const msg = errorMessage(err);
        multi.completeLine(
          lineIdxs[i],
          `${noun[0].toUpperCase()}${noun.slice(1)} ${job.label} failed: ${msg} (${formatElapsed(genElapsed)})`
        );
        results.push({
          index: i,
          model: job.modelId,
          requested_model: job.modelId,
          attempts: failureAttempts(err),
          error: msg,
          success: false,
          elapsed_ms: genElapsed,
          file: null,
        });
      }
    },
    concurrency
  );

  if (json) {
    const totalElapsed = Date.now() - start;
    const orderedResults = [...results].sort((a, b) => a.index - b.index);
    const meta = {
      elapsed_ms: totalElapsed,
      count: orderedResults.filter((r) => r.success).length,
      results: orderedResults.map((r) => ({
        index: r.index + 1,
        model: r.success ? r.model : null,
        requested_model: r.requested_model,
        attempts: r.attempts,
        ...(r.error ? { error: r.error } : {}),
        elapsed_ms: r.elapsed_ms,
        success: r.success,
        file: r.file,
      })),
    };
    process.stdout.write(JSON.stringify(meta, null, 2) + "\n");
  }

  if (collectOutputs) {
    await afterOutputs?.([...outputs].sort((a, b) => a.index - b.index));
  }

  for (const data of pendingDisplayBuffers) {
    if (format === "video") {
      await displayVideoFrame(data);
    } else {
      await displayImage(data);
    }
  }

  const failCount = results.filter((r) => !r.success).length;
  return { total: results.length, failed: failCount };
}

function normalizeGeneratedOutput(result: GenerateResult): GeneratedOutput {
  if (typeof result === "string" || Buffer.isBuffer(result)) {
    return { data: result };
  }

  return result;
}

function failureAttempts(error: unknown): Attempt[] {
  if (error instanceof FallbackError) return error.attempts;
  if (error instanceof Error && error.cause)
    return failureAttempts(error.cause);
  return [];
}
