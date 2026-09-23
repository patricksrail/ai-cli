import { describe, expect, test } from "bun:test";

import sharp from "sharp";

import {
  isWan22ImageToVideo,
  prepareWan22Video,
  validateWan22AspectRatio,
} from "./wan-video.js";

const WAN = "fal/fal-ai/wan/v2.2-5b/image-to-video";

describe("Wan 2.2 image-to-video ratio guard", () => {
  test("recognizes only this Fal endpoint in Cloudflare mode", () => {
    expect(isWan22ImageToVideo("fal/fal-ai/wan/v2.2-5b/image-to-video")).toBe(
      true
    );
    expect(isWan22ImageToVideo("fal-ai/wan/v2.2-5b/image-to-video")).toBe(true);
    expect(isWan22ImageToVideo("fal/fal-ai/wan/v2.2-5b/text-to-video")).toBe(
      false
    );
    expect(isWan22ImageToVideo("replicate/wan/v2.2-5b/image-to-video")).toBe(
      false
    );
  });

  test("rejects unsupported explicit ratios before submission", () => {
    expect(() =>
      validateWan22AspectRatio("fal/fal-ai/wan/v2.2-5b/image-to-video", "4:3")
    ).toThrow("supports --aspect-ratio 16:9, 9:16, or 1:1");
    for (const ratio of ["16:9", "9:16", "1:1"]) {
      expect(() =>
        validateWan22AspectRatio("fal/fal-ai/wan/v2.2-5b/image-to-video", ratio)
      ).not.toThrow();
    }
  });
});

test("pads a 4:3 source to 16:9 and keeps every original pixel", async () => {
  const source = await sharp({
    create: { width: 1024, height: 768, channels: 3, background: "#fa3b24" },
  })
    .png()
    .toBuffer();
  const prepared = await prepareWan22Video(WAN, {
    image: source,
    text: "rotate",
  });
  expect(prepared.aspectRatio).toBe("16:9");
  expect(prepared.padding).toEqual({ from: "1024x768", to: "1376x774" });
  if (typeof prepared.prompt === "string")
    throw new Error("Expected image prompt");
  const padded = prepared.prompt.image as Uint8Array;
  expect(await sharp(padded).metadata()).toMatchObject({
    width: 1376,
    height: 774,
    format: "png",
  });
  const originalPixels = await sharp(source).raw().toBuffer();
  const keptPixels = await sharp(padded)
    .extract({ left: 176, top: 3, width: 1024, height: 768 })
    .raw()
    .toBuffer();
  expect(keptPixels.equals(originalPixels)).toBe(true);
});

test("chooses portrait or square only when closer, and skips padding for a supported shape", async () => {
  const portrait = await sharp({
    create: { width: 768, height: 1024, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  expect((await prepareWan22Video(WAN, { image: portrait })).aspectRatio).toBe(
    "9:16"
  );
  const square = await sharp({
    create: { width: 600, height: 600, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const prepared = await prepareWan22Video(WAN, { image: square });
  expect(prepared.aspectRatio).toBe("1:1");
  expect(prepared.padding).toBeUndefined();
  if (typeof prepared.prompt === "string")
    throw new Error("Expected image prompt");
  expect(prepared.prompt.image).toBe(square);
});

test("accepts data URLs and leaves explicit ratios and other models alone", async () => {
  const source = await sharp({
    create: { width: 40, height: 30, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const dataUrl = `data:image/png;base64,${source.toString("base64")}`;
  const padded = await prepareWan22Video(WAN, { image: dataUrl });
  expect(padded.aspectRatio).toBe("16:9");
  expect(padded.padding).toBeDefined();
  const explicit = await prepareWan22Video(WAN, { image: dataUrl }, "1:1");
  expect(explicit.prompt).toEqual({ image: dataUrl });
  expect(explicit.padding).toBeUndefined();
  const other = await prepareWan22Video("fal/fal-ai/wan/v2.7/image-to-video", {
    image: dataUrl,
  });
  expect(other.prompt).toEqual({ image: dataUrl });
  expect(other.aspectRatio).toBeUndefined();
});
