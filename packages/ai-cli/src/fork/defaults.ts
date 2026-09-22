import { resolveGatewayBackend } from "../lib/gateway.js";
import type { Modality } from "../lib/models.js";
import { modelPreferences } from "./model-preferences.js";

export function resolveDefaultModel(
  modality: Modality,
  upstream: Record<Modality, string>
): string {
  // Evaluation is upstream-only; its command requires explicit Vercel selection.
  if (modality === "evaluation")
    return process.env.AI_CLI_EVALUATION_MODEL ?? upstream.evaluation;
  return (
    process.env[`AI_CLI_${modality.toUpperCase()}_MODEL`] ??
    (resolveGatewayBackend() === "cloudflare"
      ? modelPreferences().defaults
      : upstream)[modality]
  );
}
