/**
 * Keep Wan 2.2 5B image-to-video's ratio workaround beside its image
 * preparation. Other Fal video endpoints advertise different ratio sets.
 * https://fal.ai/models/fal-ai/wan/v2.2-5b/image-to-video/api
 */
import {
  cancelResponseBody,
  fetchWithValidatedRedirects,
  readResponseWithSizeLimit,
} from "@ai-sdk/provider-utils";
// The production build keeps Sharp external so its native binary resolves
// beside the installed package; bundling its JS breaks the built CLI.
import sharp from "sharp";

import { routeCloudflareModel, resolveGatewayBackend } from "./gateway.js";
import type { ImageReference } from "./image-references.js";

const WAN_22_IMAGE_TO_VIDEO = "wan/v2.2-5b/image-to-video";
const SUPPORTED_RATIOS = new Set(["16:9", "9:16", "1:1"]);
const FRAME_RATIOS = [
  { label: "16:9", width: 16, height: 9 },
  { label: "9:16", width: 9, height: 16 },
  { label: "1:1", width: 1, height: 1 },
] as const;

export interface WanVideoPrompt {
  image: ImageReference;
  text?: string;
}

export interface PreparedWanVideo {
  prompt: string | WanVideoPrompt;
  aspectRatio?: `${number}:${number}`;
  padding?: { from: `${number}x${number}`; to: `${number}x${number}` };
}

export function isWan22ImageToVideo(modelId: string): boolean {
  if (resolveGatewayBackend() !== "cloudflare") return false;
  const route = routeCloudflareModel(modelId, "video");
  return (
    route.provider === "fal" &&
    route.modelId.replace(/^fal-ai\//, "") === WAN_22_IMAGE_TO_VIDEO
  );
}

/** Fail before a billable submission if the caller requests an unsupported shape. */
export function validateWan22AspectRatio(
  modelId: string,
  ratio?: string
): void {
  if (!ratio || !isWan22ImageToVideo(modelId)) return;
  if (!SUPPORTED_RATIOS.has(ratio))
    throw new Error(
      `${modelId} supports --aspect-ratio 16:9, 9:16, or 1:1; got ${ratio}. ` +
        "See https://fal.ai/models/fal-ai/wan/v2.2-5b/image-to-video/api"
    );
}

/**
 * Fal's `auto` can select an unsupported size, then fail after minutes of
 * inference. Select the closest supported shape and extend the image edges;
 * the original frame remains intact. Only this endpoint gets the workaround.
 * Explicit ratios leave the image alone because Fal documents center cropping.
 * https://fal.ai/models/fal-ai/wan/v2.2-5b/image-to-video/api
 * https://sharp.pixelplumbing.com/api-resize/#extend
 */
export async function prepareWan22Video(
  modelId: string,
  prompt: string | WanVideoPrompt,
  aspectRatio?: `${number}:${number}`,
  abortSignal?: AbortSignal
): Promise<PreparedWanVideo> {
  validateWan22AspectRatio(modelId, aspectRatio);
  if (
    aspectRatio ||
    typeof prompt === "string" ||
    !isWan22ImageToVideo(modelId)
  )
    return { prompt, aspectRatio };

  const input = await readImageBytes(prompt.image, abortSignal);
  const image = sharp(input);
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height)
    throw new Error(
      "Could not read image dimensions for Wan 2.2 video padding"
    );
  // Sharp metadata reports stored dimensions; EXIF rotation is applied later.
  const rotated = [5, 6, 7, 8].includes(metadata.orientation ?? 1);
  const width = rotated ? metadata.height : metadata.width;
  const height = rotated ? metadata.width : metadata.height;
  const sourceRatio = width / height;
  // A 4:3 image is equidistant from 1:1 and 16:9. Prefer landscape for a
  // landscape source (and portrait for a portrait source) on such ties.
  const ordered =
    sourceRatio < 1
      ? [FRAME_RATIOS[1], FRAME_RATIOS[2], FRAME_RATIOS[0]]
      : FRAME_RATIOS;
  const chosen = ordered.reduce((best, candidate) => {
    const distance = Math.abs(
      Math.log(sourceRatio / (candidate.width / candidate.height))
    );
    const bestDistance = Math.abs(
      Math.log(sourceRatio / (best.width / best.height))
    );
    return distance < bestDistance - 1e-10 ? candidate : best;
  });
  const factor = Math.ceil(
    Math.max(width / chosen.width, height / chosen.height)
  );
  const targetWidth = factor * chosen.width;
  const targetHeight = factor * chosen.height;
  const ratio = chosen.label as `${number}:${number}`;
  if (targetWidth === width && targetHeight === height)
    return { prompt, aspectRatio: ratio };

  const left = Math.floor((targetWidth - width) / 2);
  const top = Math.floor((targetHeight - height) / 2);
  const padded = await sharp(input)
    .rotate()
    .extend({
      left,
      right: targetWidth - width - left,
      top,
      bottom: targetHeight - height - top,
      // Repeat boundary pixels instead of introducing black bars.
      extendWith: "copy",
    })
    .png()
    .toBuffer();
  return {
    prompt: { ...prompt, image: new Uint8Array(padded) },
    aspectRatio: ratio,
    padding: {
      from: `${width}x${height}`,
      to: `${targetWidth}x${targetHeight}`,
    },
  };
}

async function readImageBytes(
  reference: ImageReference,
  abortSignal?: AbortSignal
): Promise<Uint8Array> {
  if (reference instanceof Uint8Array) return reference;
  const response = reference.startsWith("data:")
    ? await fetch(reference, { signal: abortSignal })
    : await fetchWithValidatedRedirects({ url: reference, abortSignal });
  if (!response.ok) {
    await cancelResponseBody(response);
    throw new Error(
      `Could not read Wan 2.2 reference image (HTTP ${response.status})`
    );
  }
  return readResponseWithSizeLimit({ response, url: reference });
}
