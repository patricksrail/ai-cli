/**
 * Durable handles for asynchronous video jobs. The AI SDK still owns polling
 * and downloads; this layer records doStart before polling and reuses that
 * operation on resume. It never submits a replacement for an accepted job.
 * https://ai-sdk.dev/docs/ai-sdk-core/video-generation
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { classifyFailure } from "../fork/fallback.js";
import { errorMessage } from "./errors.js";
import {
  routeCloudflareModel,
  type GatewayBackend,
  type videoModel,
} from "./gateway.js";

type VideoModel = ReturnType<typeof videoModel>;
type StartedVideo = Awaited<ReturnType<NonNullable<VideoModel["doStart"]>>>;

export interface SavedVideoJob {
  version: 1;
  model: string;
  gateway: GatewayBackend;
  operation: StartedVideo["operation"];
  createdAt: string;
}

export function videoJobsDirectory(): string {
  return join(
    process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"),
    "ai-cli",
    "video-jobs"
  );
}

export async function readVideoJob(path: string): Promise<SavedVideoJob> {
  const job = JSON.parse(await readFile(path, "utf8"));
  if (
    job?.version !== 1 ||
    typeof job.model !== "string" ||
    !["cloudflare", "vercel"].includes(job.gateway) ||
    job.operation == null ||
    typeof job.createdAt !== "string"
  ) {
    throw new Error(`Invalid video job file: ${path}`);
  }
  // Native Fal uses submitUrl as the credentialed origin when polling. A
  // hand-edited recovery file must not turn that into an arbitrary host.
  if (
    job.gateway === "cloudflare" &&
    routeCloudflareModel(job.model, "video").provider === "fal"
  ) {
    for (const key of ["submitUrl", "responseUrl"]) {
      const value = job.operation[key];
      if (value === undefined) continue; // Publisher adapter stores IDs instead.
      const url = new URL(value);
      if (
        url.origin !== "https://queue.fal.run" ||
        url.username ||
        url.password
      )
        throw new Error(
          "Fal recovery URLs must belong to https://queue.fal.run"
        );
    }
  }
  return job;
}

/** Quote a path so the printed command can be pasted into a POSIX shell. */
export function videoResumeCommand(
  path: string,
  gateway: GatewayBackend
): string {
  const quoted = `'${resolve(path).replaceAll("'", "'\\''")}'`;
  return `ai video --resume ${quoted} --gateway ${gateway}`;
}

export interface RecoverableVideo {
  model: VideoModel;
  /** Undefined until the provider has accepted a job and we saved its handle. */
  jobPath(): string | undefined;
  explainFailure(error: unknown): Error | unknown;
}

/**
 * Decorate the SDK start/status interface, preserving class method bindings.
 * Resume replaces only doStart: SDK polling and safe downloads are unchanged.
 * Legacy synchronous adapters keep their existing behavior and cannot resume.
 */
export async function recoverableVideoModel(
  model: VideoModel,
  modelId: string,
  gateway: GatewayBackend,
  options: {
    directory?: string;
    resume?: { path: string; job: SavedVideoJob };
    onSaved?: (path: string) => void;
  } = {}
): Promise<RecoverableVideo> {
  let savedPath = options.resume?.path;
  let accepted = Boolean(options.resume);
  let acceptedStart: StartedVideo | undefined;
  const explainFailure = (error: unknown) => {
    if (!accepted) return error;
    // Do not attach a provider error as `cause`: the fallback classifier must
    // never mistake a later 429/read failure for a rejected submission.
    const failure = classifyFailure(error, "video");
    return Object.assign(
      new Error(
        `${errorMessage(error).replace(/[.\s]+$/, "")}. The video job was already submitted; no replacement was started. ` +
          (savedPath
            ? `Check the same job with: ${videoResumeCommand(savedPath, gateway)}`
            : "Saving its recovery file failed; do not repeat generation blindly.")
      ),
      {
        requestSubmitted: true,
        statusCode: failure.statusCode,
        name: failure.kind === "timeout" ? "TimeoutError" : "VideoJobError",
      }
    );
  };
  if (!model.doStart || !model.doStatus) {
    if (options.resume)
      throw new Error("This video adapter cannot resume jobs");
    return { model, jobPath: () => undefined, explainFailure };
  }
  const directory = options.directory ?? videoJobsDirectory();
  // Fail before spending if the state directory cannot be created/accessed.
  const path = savedPath ?? join(directory, `${randomUUID()}.json`);
  if (!options.resume) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(`${path}.tmp`, "", { mode: 0o600, flag: "wx" });
  }
  const start = model.doStart.bind(model);
  const status = model.doStatus.bind(model);
  return {
    jobPath: () => savedPath,
    explainFailure,
    model: {
      specificationVersion: model.specificationVersion,
      provider: model.provider,
      modelId: model.modelId,
      maxVideosPerCall:
        typeof model.maxVideosPerCall === "function"
          ? model.maxVideosPerCall.bind(model)
          : model.maxVideosPerCall,
      async doStart(call) {
        if (options.resume) {
          return {
            operation: options.resume.job.operation,
            warnings: [],
            response: {
              timestamp: new Date(options.resume.job.createdAt),
              modelId: model.modelId,
              headers: undefined,
            },
          };
        }
        let started: StartedVideo;
        try {
          started = acceptedStart ?? (await start(call));
          acceptedStart = started;
        } catch (error) {
          await rm(`${path}.tmp`, { force: true });
          throw error;
        }
        accepted = true;
        const job: SavedVideoJob = {
          version: 1,
          model: modelId,
          gateway,
          operation: started.operation,
          createdAt: new Date().toISOString(),
        };
        // Private, atomic JSON: no prompt, input images, auth headers or keys.
        // Retain completed handles too, so a failed output write can be retried.
        await writeFile(`${path}.tmp`, JSON.stringify(job, null, 2) + "\n", {
          mode: 0o600,
          flag: "w",
        });
        await rename(`${path}.tmp`, path);
        savedPath = path;
        options.onSaved?.(path);
        return started;
      },
      doStatus: status,
    },
  };
}
