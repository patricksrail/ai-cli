import { resolveGatewayBackend } from "../lib/gateway.js";
import type { Modality } from "../lib/models.js";
import { modelPreferences } from "./preferences.js";

export function resolveDefaultModel(
  modality: Modality,
  upstream: Record<Modality, string>
): string {
  return (
    process.env[`AI_CLI_${modality.toUpperCase()}_MODEL`] ??
    (resolveGatewayBackend() === "cloudflare"
      ? modelPreferences().defaults
      : upstream)[modality]
  );
}
