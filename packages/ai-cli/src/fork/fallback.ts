/**
 * Failure classification and ordered attempts, with no provider SDK dependency.
 * generation.ts chooses routes and applies CLI constraints before calling this.
 * This file answers only: did the request fail in a way that permits another?
 */
import type { Modality } from "../lib/models.js";

// Public results --------------------------------------------------------------

export type FailureKind =
  | "quota"
  | "unavailable"
  | "network"
  | "timeout"
  | "auth"
  | "invalid"
  | "cancelled"
  | "unknown";
export interface Failure {
  kind: FailureKind;
  statusCode?: number;
  /** Permission to try the next candidate, not a claim it will succeed. */
  eligible: boolean;
}
export interface Attempt {
  model: string;
  status: "success" | "failed";
  failure?: Failure;
}
export interface GenerationResult<T> {
  value: T;
  /** The complete route that actually succeeded, possibly a fallback. */
  model: string;
  attempts: Attempt[];
}
export interface FallbackOptions {
  modality?: Modality;
  signal?: AbortSignal;
  onAttempt?: (attempt: Attempt) => void;
}

export class FallbackError extends Error {
  readonly attempts: Attempt[];
  constructor(attempts: Attempt[], cause: unknown) {
    const lastAttempt = attempts.at(-1)!;
    const failureKind = lastAttempt.failure?.kind ?? "unknown";
    const httpStatus = lastAttempt.failure?.statusCode;
    const detail = httpStatus
      ? `${failureKind}, HTTP ${httpStatus}`
      : failureKind;
    super(
      `Generation failed on ${lastAttempt.model} (${detail}); tried ${attempts.length} route(s)`,
      { cause }
    );
    this.name = "FallbackError";
    this.attempts = attempts;
  }
}

// Failure classification ------------------------------------------------------

/** SDK versions wrap errors differently. Inspect their cause/lastError fields
 * rather than requiring instanceof a particular SDK's error class. */
function providerError(error: unknown): Record<string, unknown> {
  let currentError = error;
  const visited = new Set<unknown>();
  while (
    currentError &&
    typeof currentError === "object" &&
    !visited.has(currentError)
  ) {
    visited.add(currentError);
    const details = currentError as Record<string, unknown>;
    if (
      typeof details.statusCode === "number" ||
      typeof details.status === "number"
    )
      return details;
    const nestedError = details.lastError ?? details.cause;
    if (!nestedError) return details;
    currentError = nestedError;
  }
  return {};
}

function failureKind(
  details: Record<string, unknown>,
  statusCode?: number
): FailureKind {
  if (details.name === "AbortError") return "cancelled";
  if (details.name === "TimeoutError" || details.code === "ETIMEDOUT")
    return "timeout";
  if (statusCode === 401 || statusCode === 403) return "auth";
  if (statusCode === 402 || statusCode === 429) return "quota";
  if (
    statusCode !== undefined &&
    [404, 500, 502, 503, 504].includes(statusCode)
  )
    return "unavailable";
  if (statusCode !== undefined && statusCode >= 400 && statusCode < 500)
    return "invalid";

  const networkCodes = ["ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ENOTFOUND"];
  const fetchFailed =
    details.name === "TypeError" &&
    typeof details.message === "string" &&
    /fetch failed|network/i.test(details.message);
  if (networkCodes.includes(String(details.code)) || fetchFailed)
    return "network";
  return "unknown";
}

/** A media timeout can leave a billable job running. Only explicit 402/429
 * submission rejections permit a second job. Native adapters can attest that
 * rejection with requestSubmitted:false; polling failures must never do so. */
function rejectedMediaSubmission(
  details: Record<string, unknown>,
  statusCode?: number
): boolean {
  if (statusCode !== 402 && statusCode !== 429) return false;
  if (details.requestSubmitted === false) return true;
  const requestUrl = typeof details.url === "string" ? details.url : "";
  // These are submission endpoints. /predictions/<id>, for example, is a poll
  // and deliberately does not match the end-anchored expression.
  return /\/(images\/(generations|edits)|predictions|audio\/(speech|transcriptions))\/?(?:\?.*)?$/.test(
    requestUrl
  );
}

/** Unknown errors stop: a generic exception is not permission to spend again. */
export function classifyFailure(
  error: unknown,
  modality: Modality = "text"
): Failure {
  const details = providerError(error);
  const statusCode =
    typeof details.statusCode === "number"
      ? details.statusCode
      : typeof details.status === "number"
        ? details.status
        : undefined;
  const kind = failureKind(details, statusCode);
  const recoverableTextFailure = [
    "quota",
    "unavailable",
    "network",
    "timeout",
  ].includes(kind);
  const eligible =
    modality === "text"
      ? recoverableTextFailure
      : recoverableTextFailure && rejectedMediaSubmission(details, statusCode);
  return { kind, statusCode, eligible };
}

// Execute each distinct route at most once ------------------------------------

/** The caller supplies the complete allowed order. This function never discovers
 * extra models, changes a gateway, or recursively follows another fallback list.
 * SDK retries must be disabled when this loop owns recovery. */
export async function runWithFallback<T>(
  candidates: string[],
  generate: (model: string) => Promise<T>,
  options: FallbackOptions = {}
): Promise<GenerationResult<T>> {
  const modelRoutes = [...new Set(candidates)];
  if (!modelRoutes.length || modelRoutes.some((route) => !route)) {
    throw new Error("At least one nonempty model candidate is required");
  }
  const attempts: Attempt[] = [];
  for (const modelRoute of modelRoutes) {
    options.signal?.throwIfAborted();
    let value: T;
    try {
      value = await generate(modelRoute);
    } catch (error) {
      const failure = classifyFailure(error, options.modality);
      const attempt: Attempt = { model: modelRoute, status: "failed", failure };
      attempts.push(attempt);
      options.onAttempt?.(attempt);
      const hasNextRoute = modelRoute !== modelRoutes.at(-1);
      if (!failure.eligible || options.signal?.aborted || !hasNextRoute) {
        throw new FallbackError(attempts, error);
      }
      continue;
    }

    const attempt: Attempt = { model: modelRoute, status: "success" };
    attempts.push(attempt);
    // Keep observers outside the generation catch: a logging failure must not
    // replay generation that already succeeded.
    options.onAttempt?.(attempt);
    return { value, model: modelRoute, attempts };
  }
  throw new Error("No model attempted");
}
