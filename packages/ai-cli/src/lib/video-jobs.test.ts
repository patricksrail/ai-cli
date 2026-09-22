/** Exercise the real SDK polling flow with an in-memory provider; no paid calls. */
import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { experimental_generateVideo as generateVideo } from "ai";

import { runWithFallback } from "../fork/fallback.js";
import { type videoModel } from "./gateway.js";
import { readVideoJob, recoverableVideoModel } from "./video-jobs.js";

type VideoModel = ReturnType<typeof videoModel>;
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  );
});
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "ai-video-jobs-"));
  directories.push(path);
  return path;
}
function provider(pendingChecks: number) {
  let starts = 0;
  let checks = 0;
  const response = {
    timestamp: new Date(),
    modelId: "test-video",
    headers: undefined,
  };
  const model: VideoModel = {
    specificationVersion: "v4",
    provider: "test.video",
    modelId: "test-video",
    maxVideosPerCall: 1,
    async doStart() {
      starts++;
      return {
        operation: { requestId: "one-paid-job" },
        warnings: [],
        response,
      };
    },
    async doStatus({ operation }) {
      expect(operation).toEqual({ requestId: "one-paid-job" });
      checks++;
      if (checks <= pendingChecks) return { status: "pending", response };
      return {
        status: "completed",
        warnings: [],
        videos: [
          {
            type: "base64",
            data: Buffer.from("video bytes").toString("base64"),
            mediaType: "video/mp4",
          },
        ],
        response,
      };
    },
  };
  return { model, starts: () => starts, checks: () => checks };
}

test("SDK keeps polling a saved job beyond five and ten minutes", async () => {
  const fake = provider(3);
  const saved = await recoverableVideoModel(
    fake.model,
    "fal/test-video",
    "cloudflare",
    { directory: await directory() }
  );
  let now = 0;
  const clock = spyOn(Date, "now").mockImplementation(() => now);
  try {
    const result = await generateVideo({
      model: saved.model,
      prompt: "private prompt must not be persisted",
      maxRetries: 0,
      poll: {
        timeoutMs: Infinity,
        intervalMs: 240_000,
        delay: async (milliseconds) => {
          now += milliseconds;
        },
      },
    });
    expect(Buffer.from(result.video.uint8Array).toString()).toBe("video bytes");
    expect(now).toBe(960_000);
    expect(fake.starts()).toBe(1);
    const contents = await readFile(saved.jobPath()!, "utf8");
    expect(contents).not.toContain("private prompt");
    expect(await readVideoJob(saved.jobPath()!)).toMatchObject({
      model: "fal/test-video",
      operation: { requestId: "one-paid-job" },
    });
    expect((await stat(saved.jobPath()!)).mode & 0o777).toBe(0o600);
  } finally {
    clock.mockRestore();
  }
});

test("timeout then a new process-style resume reads the same job without a second submission", async () => {
  const fake = provider(1);
  const dir = await directory();
  const original = await recoverableVideoModel(
    fake.model,
    "fal/test-video",
    "cloudflare",
    { directory: dir }
  );
  const abort = new AbortController();
  await expect(
    generateVideo({
      model: original.model,
      prompt: "input",
      maxRetries: 0,
      abortSignal: abort.signal,
      poll: {
        delay: async () => {
          abort.abort(new DOMException("Wait expired", "TimeoutError"));
          throw abort.signal.reason;
        },
      },
    })
  ).rejects.toThrow("Wait expired");
  expect(original.explainFailure(abort.signal.reason)).toHaveProperty(
    "message",
    expect.stringContaining("ai video --resume")
  );
  const path = original.jobPath()!;
  const resumed = await recoverableVideoModel(
    fake.model,
    "fal/test-video",
    "cloudflare",
    { directory: dir, resume: { path, job: await readVideoJob(path) } }
  );
  const result = await generateVideo({
    model: resumed.model,
    prompt: "",
    maxRetries: 0,
    poll: { delay: async () => {} },
  });
  expect(Buffer.from(result.video.uint8Array).toString()).toBe("video bytes");
  expect(fake.starts()).toBe(1);
  expect(fake.checks()).toBe(2);
});

test("a saved operation never falls back on a later quota/read error", async () => {
  const fake = provider(0);
  const saved = await recoverableVideoModel(
    fake.model,
    "fal/test-video",
    "cloudflare",
    { directory: await directory() }
  );
  saved.model.doStatus = async () => {
    throw {
      statusCode: 429,
      requestSubmitted: false,
      message: "Polling rate limit",
    };
  };
  const routes: string[] = [];
  await expect(
    runWithFallback(
      ["primary", "fallback"],
      async (route) => {
        routes.push(route);
        try {
          return await generateVideo({
            model: saved.model,
            prompt: "input",
            maxRetries: 0,
            poll: { delay: async () => {} },
          });
        } catch (error) {
          throw saved.explainFailure(error);
        }
      },
      { modality: "video" }
    )
  ).rejects.toThrow();
  expect(routes).toEqual(["primary"]);
  expect(fake.starts()).toBe(1);
});

test("a terminal provider error is preserved alongside the recovery command", async () => {
  const fake = provider(0);
  fake.model.doStatus = async () => ({
    status: "error",
    error: "aspect_ratio: use 1:1",
    response: {
      timestamp: new Date(),
      modelId: "test-video",
      headers: undefined,
    },
  });
  const saved = await recoverableVideoModel(
    fake.model,
    "fal/test-video",
    "cloudflare",
    { directory: await directory() }
  );
  try {
    await generateVideo({
      model: saved.model,
      prompt: "input",
      maxRetries: 0,
      poll: { delay: async () => {} },
    });
    throw new Error("Expected failure");
  } catch (error) {
    expect((saved.explainFailure(error) as Error).message).toContain(
      "aspect_ratio: use 1:1"
    );
  }
  expect(fake.starts()).toBe(1);
});

test("resume rejects a Fal operation whose credentialed origin was changed", async () => {
  const path = join(await directory(), "untrusted.json");
  await writeFile(
    path,
    JSON.stringify({
      version: 1,
      model: "fal/fal-ai/wan/v2.2-5b/image-to-video",
      gateway: "cloudflare",
      createdAt: new Date().toISOString(),
      operation: {
        submitUrl: "https://example.com/submit",
        responseUrl: "https://example.com/result",
      },
    })
  );
  await expect(readVideoJob(path)).rejects.toThrow(
    "Fal recovery URLs must belong to"
  );
});
