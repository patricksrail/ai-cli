/** Recovery safety tests live next to the SDK-independent attempt engine. */
import { expect, test } from "bun:test";

import { classifyFailure, FallbackError, runWithFallback } from "./fallback.js";

test("each distinct route runs once and the result retains failed attempts", async () => {
  const requestedRoutes: string[] = [];
  const result = await runWithFallback(
    ["first", "first", "second"],
    async (route) => {
      requestedRoutes.push(route);
      if (route === "first") throw { statusCode: 429 };
      return "OK";
    }
  );
  expect(requestedRoutes).toEqual(["first", "second"]);
  expect(result).toMatchObject({
    value: "OK",
    model: "second",
    attempts: [
      { model: "first", status: "failed" },
      { model: "second", status: "success" },
    ],
  });
});

test("authentication, invalid input, unknown errors and cancellation stop recovery", async () => {
  const errors = [
    { statusCode: 403 },
    { statusCode: 400 },
    new Error("unclassified"),
    { name: "AbortError" },
  ];
  for (const error of errors) {
    const requestedRoutes: string[] = [];
    await expect(
      runWithFallback(["first", "second"], async (route) => {
        requestedRoutes.push(route);
        throw error;
      })
    ).rejects.toBeInstanceOf(FallbackError);
    expect(requestedRoutes).toEqual(["first"]);
  }
});

test("media submission rejection differs from polling errors and uncertain jobs", () => {
  const endpoint =
    "https://gateway.ai.cloudflare.com/v1/account/gateway/replicate/predictions";
  expect(
    classifyFailure({ statusCode: 429, url: endpoint }, "image").eligible
  ).toBe(true);
  expect(
    classifyFailure(
      { statusCode: 429, url: `${endpoint}/existing-job` },
      "image"
    ).eligible
  ).toBe(false);
  expect(
    classifyFailure({ statusCode: 500, url: endpoint }, "video").eligible
  ).toBe(false);
  expect(classifyFailure({ name: "TimeoutError" }, "video").eligible).toBe(
    false
  );
});

test("an observer error never replays a generation that already succeeded", async () => {
  let generationCount = 0;
  await expect(
    runWithFallback(["first", "second"], async () => ++generationCount, {
      onAttempt: () => {
        throw { statusCode: 429 };
      },
    })
  ).rejects.toMatchObject({ statusCode: 429 });
  expect(generationCount).toBe(1);
});
