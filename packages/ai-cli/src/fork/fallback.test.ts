import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { classifyFailure } from "@patricksrail/bricks/ai/fallback";

import { createCloudflareFalFetch } from "../lib/gateway.js";
import { fallbackCandidates } from "./alternatives.js";

async function runCLI(args: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "ai-fallback-e2e-"));
  const requestsFile = join(dir, "requests.jsonl");
  try {
    const proc = Bun.spawn(
      [
        process.execPath,
        "--preload",
        join(import.meta.dir, "fixtures/fallback-fetch.ts"),
        join(import.meta.dir, "../index.ts"),
        ...args,
      ],
      {
        cwd: dir,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env: {
          PATH: process.env.PATH,
          AI_CLI_GATEWAY: "cloudflare",
          CLOUDFLARE_ACCOUNT_ID: "test-account",
          CLOUDFLARE_AI_GATEWAY_TOKEN: "fixture-gateway",
          FIXTURE_REQUESTS: requestsFile,
        },
      }
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    let requests: any[] = [];
    try {
      requests = readFileSync(requestsFile, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
    } catch {
      /* Offline preferred listing needs no fetch. */
    }
    let data: string | undefined;
    if (code === 0 && args[0] === "text")
      data = readFileSync(JSON.parse(stdout).results[0].file, "utf8");
    return { code, stdout, stderr, requests, data };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("CLI recovers quota through the next saved host and reports actual route and attempts", async () => {
  const result = await runCLI([
    "text",
    "-m",
    "gemini-3.8-flash",
    "--json",
    "Hello",
  ]);
  expect(result.code, result.stderr).toBe(0);
  expect(result.data).toBe("RECOVERED");
  expect(result.requests).toHaveLength(2);
  expect(
    result.requests.every(
      (r) => !r.providerAuth && r.gatewayAuth === "Bearer fixture-gateway"
    )
  ).toBe(true);
  expect(JSON.parse(result.stdout).results[0]).toMatchObject({
    requested_model: "google/gemini-3.8-flash",
    model: "openrouter/google/gemini-3.8-flash",
    success: true,
    attempts: [
      {
        model: "google/gemini-3.8-flash",
        status: "failed",
        failure: { statusCode: 429 },
      },
      { model: "openrouter/google/gemini-3.8-flash", status: "success" },
    ],
  });
  expect(result.stderr).toContain("Trying fallback");
});

test.each([{ flags: ["--no-fallback"] }, { flags: ["--provider", "GOOGLE"] }])(
  "CLI pinned requests stop and emit structured failure: %j",
  async ({ flags }) => {
    const result = await runCLI([
      "text",
      "-m",
      "gemini-3.8-flash",
      "--json",
      ...flags,
      "Hello",
    ]);
    expect(result.code).toBe(1);
    expect(result.requests).toHaveLength(1);
    expect(JSON.parse(result.stdout).results[0]).toMatchObject({
      success: false,
      model: null,
      attempts: [{ status: "failed", failure: { kind: "quota" } }],
    });
    expect(result.stderr).toContain("Quota exhausted");
  }
);

test("preferred feed is offline and exposes the alias, selected host and CK id", async () => {
  const result = await runCLI([
    "models",
    "--preferred",
    "--type",
    "text",
    "--json",
  ]);
  expect(result.code, result.stderr).toBe(0);
  expect(result.requests).toEqual([]);
  expect(
    JSON.parse(result.stdout).find((row: any) => row.alias === "gpt-5.6-sol")
  ).toMatchObject({
    provider: "openrouter",
    route: "openrouter/openai/gpt-5.6-sol",
    ckId: "openrouter:openai/gpt-5.6-sol",
    providers: { openai: "gpt-5.6-sol" },
  });
});

test("explicit fallback order is deterministic and rejects a conflicting host before inference", async () => {
  expect(
    await fallbackCandidates("google/gemini-3.8-flash", "text", {
      fallbacks: ["gpt-5.6-sol", "gpt-5.6-sol"],
    })
  ).toEqual(["google/gemini-3.8-flash", "openrouter/openai/gpt-5.6-sol"]);
  await expect(
    fallbackCandidates("google/gemini-3.8-flash", "text", {
      provider: "google",
      fallbacks: ["gpt-5.6-sol"],
    })
  ).rejects.toThrow("explicit --provider");
});

test("Fal rejected POST permits recovery, polling rejection does not", async () => {
  const base = "https://gateway.ai.cloudflare.com/v1/test/ai-cli/fal";
  const wrapped = createCloudflareFalFetch(
    base,
    (async () =>
      new Response("Quota", { status: 429 })) as unknown as typeof fetch
  );
  let error: unknown;
  try {
    await wrapped(base + "/fal-ai/flux/schnell", { method: "POST" });
  } catch (e) {
    error = e;
  }
  expect(classifyFailure(error, "image").eligible).toBe(true);
  const poll = await wrapped(
    "https://queue.fal.run/fal-ai/video/requests/id/status",
    { method: "GET" }
  );
  expect(poll.status).toBe(429);
});

test("free-only recovery chooses the verified free router, never the saved paid route", async () => {
  const result = await runCLI([
    "text",
    "--free",
    "-m",
    "gemini-3.8-flash",
    "--json",
    "Hello",
  ]);
  expect(result.code, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout).results[0].model).toBe(
    "openrouter/openrouter/free"
  );
  expect(
    result.requests.filter((r) => r.body?.model).map((r) => r.body.model)
  ).toEqual(["openrouter/free"]);
});
