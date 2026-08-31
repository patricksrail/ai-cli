import { describe, expect, test } from "bun:test";

import { errorMessage } from "./errors.js";

describe("errorMessage", () => {
  test("uses a provider detail when Error.message is blank", () => {
    const error = Object.assign(new Error(""), {
      body: { detail: "Path /h3-max/text-to-video not found" },
    });

    expect(errorMessage(error)).toBe("Path /h3-max/text-to-video not found");
  });

  test("reads JSON response bodies from AI SDK errors", () => {
    const error = Object.assign(new Error(""), {
      responseBody: JSON.stringify({ detail: "Model endpoint not found" }),
    });

    expect(errorMessage(error)).toBe("Model endpoint not found");
  });

  test("formats provider validation fields", () => {
    const error = Object.assign(new Error("Unprocessable Entity"), {
      body: {
        detail: [
          { loc: ["body", "duration"], msg: "Must be between 5 and 15" },
          { loc: ["body", "resolution"], msg: "Expected 480P or 768P" },
        ],
      },
    });

    expect(errorMessage(error)).toBe(
      "duration: Must be between 5 and 15; resolution: Expected 480P or 768P"
    );
  });

  test("never returns a blank fallback", () => {
    expect(errorMessage(new Error(""))).toBe("Unknown error");
    expect(errorMessage({ status: 503, requestId: "req-123" })).toBe(
      "Request failed with HTTP 503 (request req-123)"
    );
  });
});
