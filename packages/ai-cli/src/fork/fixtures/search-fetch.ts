/** Capture the real CLI/SDK HTTP body. Reject submission; never use the network. */
import { appendFileSync } from "node:fs";
globalThis.fetch = (async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  appendFileSync(
    process.env.FIXTURE_REQUESTS!,
    JSON.stringify({ url, body: JSON.parse(String(init?.body)) }) + "\n"
  );
  return Response.json(
    {
      error: {
        message: "Fixture rejected submission",
        code: 400,
        status: "INVALID_ARGUMENT",
      },
      detail: "Fixture rejected submission",
    },
    { status: 400 }
  );
}) as typeof fetch;
