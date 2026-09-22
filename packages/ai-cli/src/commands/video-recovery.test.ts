/** CLI-to-SDK-to-Fal regression: timeout, persisted handle, resume, real error. */
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("CLI resumes a timed-out Fal job without another POST and reports its terminal error", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ai-video-recovery-"));
  const requestsFile = join(dir, "requests.jsonl");
  const run = async (args: string[]) => {
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
  };
  try {
    const first = await run([
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
    const second = await run([
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
