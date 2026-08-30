import { describe, expect, test } from "bun:test";

import { responseIdFromHeaders } from "./response-id.js";

describe("responseIdFromHeaders", () => {
  test("prefers the Cloudflare AI Gateway log id", () => {
    expect(
      responseIdFromHeaders({
        "x-request-id": "provider-request",
        "cf-aig-log-id": "cloudflare-log",
      })
    ).toBe("cloudflare-log");
  });

  test("recognizes Cloudflare headers case-insensitively", () => {
    expect(responseIdFromHeaders({ "CF-AIG-RUN-ID": "run-123" })).toBe(
      "run-123"
    );
  });
});
