const MAX_DETAIL_ITEMS = 3;

/** Return a useful, non-empty provider error without dumping request secrets. */
export function errorMessage(error: unknown): string {
  return describeError(error, new Set(), 0) ?? "Unknown error";
}

function describeError(
  error: unknown,
  seen: Set<object>,
  depth: number
): string | undefined {
  if (depth > 4) return undefined;
  if (typeof error === "string") return nonEmpty(error);
  if (!isRecord(error)) return primitiveMessage(error);
  if (seen.has(error)) return undefined;
  seen.add(error);

  // Provider SDKs commonly keep the useful JSON error under one of these
  // fields while exposing an empty or generic Error.message.
  for (const key of ["body", "data"] as const) {
    const detail = providerDetail(error[key]);
    if (detail) return detail;
  }

  const responseBody = error.responseBody;
  if (typeof responseBody === "string") {
    const detail = providerDetail(parseJson(responseBody));
    if (detail) return detail;
  } else {
    const detail = providerDetail(responseBody);
    if (detail) return detail;
  }

  const directDetail = providerDetail(error);
  if (directDetail) return directDetail;

  const message = nonEmpty(error.message);
  if (message) return message;

  const cause = describeError(error.cause, seen, depth + 1);
  if (cause) return cause;

  const status =
    typeof error.status === "number"
      ? error.status
      : typeof error.statusCode === "number"
        ? error.statusCode
        : undefined;
  if (status !== undefined) {
    const requestId = nonEmpty(error.requestId);
    return `Request failed with HTTP ${status}${requestId ? ` (request ${requestId})` : ""}`;
  }

  const name = nonEmpty(error.name);
  if (name && name !== "Error") return name;
  return undefined;
}

function providerDetail(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;

  const detail = formatDetail(value.detail);
  if (detail) return detail;

  if (typeof value.error === "string") return nonEmpty(value.error);
  if (isRecord(value.error)) {
    const nested =
      formatDetail(value.error.detail) ?? nonEmpty(value.error.message);
    if (nested) return nested;
  }

  return nonEmpty(value.message);
}

function formatDetail(value: unknown): string | undefined {
  if (typeof value === "string") return nonEmpty(value);
  if (!Array.isArray(value)) return undefined;

  const messages = value
    .map((item) => {
      if (typeof item === "string") return nonEmpty(item);
      if (!isRecord(item)) return undefined;
      const message = nonEmpty(item.msg) ?? nonEmpty(item.message);
      if (!message) return undefined;
      const location = Array.isArray(item.loc)
        ? item.loc
            .filter((part): part is string | number =>
              ["string", "number"].includes(typeof part)
            )
            .filter((part) => part !== "body")
            .join(".")
        : "";
      return location ? `${location}: ${message}` : message;
    })
    .filter((message): message is string => Boolean(message));

  if (messages.length === 0) return undefined;
  const shown = messages.slice(0, MAX_DETAIL_ITEMS);
  const remainder = messages.length - shown.length;
  return `${shown.join("; ")}${remainder > 0 ? `; and ${remainder} more` : ""}`;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function primitiveMessage(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (["number", "boolean", "bigint"].includes(typeof value)) {
    return String(value);
  }
  return undefined;
}

function nonEmpty(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
