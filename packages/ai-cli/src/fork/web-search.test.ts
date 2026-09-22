/** Exercise command parsing, route selection and real provider serialization. */
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { imageSearchOptions } from "./web-search.js";

async function request(
  modality: string,
  route: string,
  enabled: boolean | undefined = undefined
) {
  const dir = mkdtempSync(join(tmpdir(), "ai-search-"));
  try {
    const capture = join(dir, "requests.jsonl");
    const proc = Bun.spawn(
      [
        process.execPath,
        "--preload",
        join(import.meta.dir, "fixtures/search-fetch.ts"),
        join(import.meta.dir, "../index.ts"),
        modality,
        "-m",
        route,
        "--no-fallback",
        "--json",
        ...(enabled === undefined
          ? []
          : [enabled ? "--web-search" : "--no-web-search"]),
        "Search today's news",
      ],
      {
        cwd: dir,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env: {
          PATH: process.env.PATH,
          AI_CLI_GATEWAY: "cloudflare",
          CLOUDFLARE_ACCOUNT_ID: "test",
          CLOUDFLARE_AI_GATEWAY_TOKEN: "test",
          FIXTURE_REQUESTS: capture,
        },
      }
    );
    const [code, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stderr).text(),
      new Response(proc.stdout).text(),
    ]);
    expect(code, stderr).toBe(1); // Deliberate invalid-input rejection, no retry.
    const requests = readFileSync(capture, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(requests).toHaveLength(1);
    return requests[0];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
for (const [route, expected] of [
  ["google/gemini-2.5-flash-lite", [{ googleSearch: {} }]],
  ["openai/gpt-5.6-sol", [{ type: "web_search" }]],
  ["openrouter/openai/gpt-5.6-sol", [{ type: "openrouter:web_search" }]],
] as const) {
  test(`CLI leaves search off unless opted in: ${route}`, async () => {
    const enabled = await request("text", route, true);
    expect((await request("text", route)).body.tools ?? []).toEqual([]);
    expect(enabled.body.tools).toMatchObject(expected);
    const disabled = await request("text", route, false);
    expect(disabled.body.tools ?? []).toEqual([]);
  });
}
for (const [route, field] of [
  ["fal/fal-ai/nano-banana-2", "enable_web_search"],
  ["fal/fal-ai/nano-banana-pro", "enable_web_search"],
  ["replicate/google/nano-banana-2", "google_search"],
] as const) {
  test(`CLI media search default and opt-out reach provider: ${route}`, async () => {
    for (const enabled of [undefined, false, true]) {
      const { body } = await request("image", route, enabled);
      expect((body.input ?? body)[field]).toBe(enabled === true);
    }
  });
}
test("unrelated media models receive no search flag", () => {
  for (const route of [
    { provider: "fal", modelId: "fal-ai/flux/schnell" },
    { provider: "replicate", modelId: "prunaai/p-video" },
    { provider: "google", modelId: "imagen-4.0-generate-001" },
  ]) {
    expect(imageSearchOptions(route)).toEqual({});
  }
});

test("Google image adapter receives grounding only when enabled", async () => {
  const enabled = await request(
    "image",
    "google/gemini-3.1-flash-image-preview",
    true
  );
  expect(enabled.body.tools).toEqual([{ googleSearch: {} }]);
  const disabled = await request(
    "image",
    "google/gemini-3.1-flash-image-preview",
    false
  );
  expect(disabled.body.tools ?? []).toEqual([]);
});
