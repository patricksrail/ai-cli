// Subprocess-only Fal queue fixture. Every request is recorded; no network.
import { appendFileSync } from "node:fs";

import sharp from "sharp";

globalThis.fetch = (async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  const headers = new Headers(init?.headers);
  const method = init?.method ?? "GET";
  const target = headers.get("x-fal-target-url");
  const body =
    method === "POST" && init?.body
      ? (JSON.parse(String(init.body)) as {
          aspect_ratio?: string;
          image_url?: string;
        })
      : undefined;
  const encodedImage = body?.image_url?.startsWith("data:")
    ? body.image_url.slice(body.image_url.indexOf(",") + 1)
    : undefined;
  const image = encodedImage
    ? await sharp(Buffer.from(encodedImage, "base64")).metadata()
    : undefined;
  appendFileSync(
    process.env.FIXTURE_REQUESTS!,
    JSON.stringify({
      method,
      target,
      providerAuth: headers.has("authorization"),
      gatewayAuth: headers.get("cf-aig-authorization"),
      aspectRatio: body?.aspect_ratio,
      imageSize: image ? `${image.width}x${image.height}` : undefined,
    }) + "\n"
  );
  if (!url.startsWith("https://gateway.ai.cloudflare.com/"))
    throw new Error("Unexpected network destination");
  if (method === "POST")
    return Response.json({
      request_id: "existing-job",
      response_url: "https://queue.fal.run/fal-ai/wan/requests/existing-job",
    });
  if (target?.endsWith("/requests/existing-job"))
    return Response.json(
      {
        detail: [
          {
            loc: ["body", "aspect_ratio"],
            msg: "Use 16:9, 9:16 or 1:1",
            type: "value_error",
          },
        ],
      },
      { status: 422 }
    );
  throw new Error("Unexpected fixture request");
}) as typeof fetch;
