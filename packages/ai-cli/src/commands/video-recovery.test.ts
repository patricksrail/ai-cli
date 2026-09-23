/** CLI-to-SDK-to-Fal regression: timeout, persisted handle, resume, real error. */
import { expect, test } from "bun:test";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";

async function runVideoCli(dir: string, args: string[]) {
  const requestsFile = join(dir, "requests.jsonl");
  const child = Bun.spawn(
    [
      process.execPath,
      "--preload",
      join(import.meta.dir, "fixtures/video-fetch.ts"),
      join(import.meta.dir, "../index.ts"),
      "video",
      "--json",
      "--no-preview",
      ...args,
    ],
    {
      cwd: dir,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        PATH: process.env.PATH,
        XDG_STATE_HOME: dir,
        CLOUDFLARE_ACCOUNT_ID: "fixture-account",
        CLOUDFLARE_AI_GATEWAY_TOKEN: "fixture-token",
        FIXTURE_REQUESTS: requestsFile,
      },
    }
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

test("CLI resumes a timed-out Fal job without another POST and reports its terminal error", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ai-video-recovery-"));
  const requestsFile = join(dir, "requests.jsonl");
  try {
    const first = await runVideoCli(dir, [
      "-m",
      "fal/fal-ai/wan/v2.2-5b/image-to-video",
      "--timeout",
      "1",
      "A circle rotates",
    ]);
    expect(first.code, first.stderr).toBe(1);
    expect(first.stderr).toContain("ai video --resume");
    expect(JSON.parse(first.stdout).results[0].attempts[0].failure.kind).toBe(
      "timeout"
    );
    const jobDir = join(dir, "ai-cli", "video-jobs");
    const files = readdirSync(jobDir);
    expect(files).toHaveLength(1);
    const second = await runVideoCli(dir, [
      "--resume",
      join(jobDir, files[0]!),
      "--timeout",
      "30",
    ]);
    expect(second.code).toBe(1);
    const result = JSON.parse(second.stdout).results[0];
    expect(result.error).toContain("aspect_ratio: Use 16:9, 9:16 or 1:1");
    expect(result.error).not.toContain("Use --fallbacks");
    expect(result.attempts[0].failure).toEqual({
      kind: "invalid",
      statusCode: 422,
      eligible: false,
    });
    const requests = readFileSync(requestsFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(requests.map((request) => request.method)).toEqual(["POST", "GET"]);
    expect(
      requests.every(
        (request) =>
          !request.providerAuth &&
          request.gatewayAuth === "Bearer fixture-token"
      )
    ).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 15_000);

test("CLI sends a padded 4:3 image and explicit 16:9 ratio to Fal", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ai-video-padding-"));
  const imagePath = join(dir, "input.png");
  const requestsFile = join(dir, "requests.jsonl");
  try {
    const image = await sharp({
      create: { width: 1024, height: 768, channels: 3, background: "#fa3b24" },
    })
      .png()
      .toBuffer();
    writeFileSync(imagePath, image);
    const result = await runVideoCli(dir, [
      "-m",
      "fal/fal-ai/wan/v2.2-5b/image-to-video",
      "--no-fallback",
      "--timeout",
      "1",
      "-i",
      imagePath,
      "the paper circle rotates once",
    ]);
    expect(result.code, result.stderr).toBe(1); // Fixture leaves its queue job pending.
    expect(result.stderr).toContain(
      "Padded Wan 2.2 image from 1024x768 to 1376x774"
    );
    const requests = readFileSync(requestsFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: "POST",
      aspectRatio: "16:9",
      imageSize: "1376x774",
    });
    expect(requests[0].providerAuth).toBe(false);

    const invalid = await runVideoCli(dir, [
      "-m",
      "fal/fal-ai/wan/v2.2-5b/image-to-video",
      "--no-fallback",
      "--aspect-ratio",
      "4:3",
      "-i",
      imagePath,
      "the paper circle rotates once",
    ]);
    expect(invalid.code).toBe(1);
    expect(invalid.stderr).toContain(
      "supports --aspect-ratio 16:9, 9:16, or 1:1"
    );
    expect(readFileSync(requestsFile, "utf8").trim().split("\n")).toHaveLength(
      1
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 15_000);
