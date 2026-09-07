import {
  preferredModels,
  resolveModel,
} from "@patricksrail/bricks/ai/preferences";

import { routeCloudflareModel } from "../lib/gateway.js";
import { resolveModels, type Modality } from "../lib/models.js";
import {
  configuredProviders,
  fetchCloudflareCatalog,
  parseProvider,
  type CatalogEntry,
} from "./catalog.js";
import { accent, action, heading, statusColor, wrapped } from "./output.js";
import {
  MODALITIES,
  modelPreferences,
  preferenceLocation,
} from "./preferences.js";
import { FREE_PROVIDERS } from "./providers.js";
import { isFreeOffer, preferredFree } from "./selection.js";

export interface CatalogOptions {
  gateway?: string;
  provider?: string;
  type?: string;
  creator?: string;
  search?: string;
  free?: boolean;
  best?: boolean;
  cheapest?: boolean;
  preferred?: boolean;
  all?: boolean;
  limit?: string;
  json?: boolean;
}
const TYPES = ["text", "image", "video", "audio", "speech", "transcription"];

export async function showCloudflareModels(
  model: string | undefined,
  opts: CatalogOptions
): Promise<void> {
  const type = opts.type?.toLowerCase();
  if (opts.cheapest && (opts.best || opts.free))
    throw new Error("--cheapest cannot be combined with --best or --free");
  if (type && !TYPES.includes(type))
    throw new Error(`--type must be one of: ${TYPES.join(", ")}`);
  if (
    model &&
    (opts.type ||
      opts.creator ||
      opts.search ||
      opts.free ||
      opts.best ||
      opts.cheapest ||
      opts.all ||
      opts.limit)
  )
    throw new Error(
      "--type and --creator (and other list filters) cannot be used with a model argument"
    );
  if (opts.all && opts.limit) throw new Error("Use either --all or --limit");
  const limit = opts.limit === undefined ? 20 : Number(opts.limit);
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error("--limit must be a positive integer");
  let provider = opts.provider ? parseProvider(opts.provider) : undefined;
  if (opts.preferred) {
    if (model || opts.free || opts.best || opts.cheapest || opts.creator)
      throw new Error(
        "--preferred supports --type, --provider, --search, --limit, and --json"
      );
    let rows = preferredModels({ preferences: modelPreferences() }).filter(
      (row) =>
        (!type ||
          (type === "audio"
            ? row.modalities.some(
                (m) => m === "speech" || m === "transcription"
              )
            : row.modalities.includes(type as Modality))) &&
        (!provider || row.provider === provider) &&
        (!opts.search ||
          JSON.stringify(row).toLowerCase().includes(opts.search.toLowerCase()))
    );
    if (opts.limit) rows = rows.slice(0, limit);
    process.stdout.write(
      opts.json
        ? JSON.stringify(rows, null, 2) + "\n"
        : "\nPreferred models (saved choices; availability is not guaranteed)\n" +
            rows
              .map(
                (row) =>
                  `  ${row.alias}  [${row.modalities.join(", ")}]\n    ${row.route}\n`
              )
              .join("")
    );
    return;
  }
  if (model && modelPreferences().preferred.some((p) => p.alias === model))
    model = resolveModel(model, { preferences: modelPreferences() }).route;

  if (opts.free) {
    if (provider && !["openrouter", "google"].includes(provider))
      throw new Error(
        "--free supports OpenRouter, Google free-tier eligibility, and guarded Workers AI images"
      );
  }
  // Full detail IDs need only their own provider's catalog.
  if (model && !provider && model.includes("/")) {
    try {
      provider = parseProvider(model.split("/")[0]!);
    } catch {
      throw new Error(
        `model not found: ${model}; use a full provider-prefixed ID from ai models`
      );
    }
  }
  const summary =
    !model &&
    !provider &&
    !type &&
    !opts.creator &&
    !opts.search &&
    !opts.free &&
    !opts.best &&
    !opts.cheapest &&
    !opts.all &&
    !opts.limit &&
    !opts.json;
  const savedBest = (opts.best && !opts.free) || opts.cheapest;
  const saved = savedBest
    ? bestEntries(opts.cheapest ? "cheapest" : "best")
    : [];
  const catalog = savedBest
    ? {
        entries: saved,
        providers: [],
        warnings: [],
        notes: [
          `Saved editorial choices from ${preferenceLocation()}; not live availability checks.`,
        ],
      }
    : summary
      ? {
          entries: [],
          providers: await configuredProviders(),
          warnings: [],
          notes: [],
        }
      : await fetchCloudflareCatalog(provider, {
          all: opts.all,
          providers: opts.free
            ? type === "text"
              ? FREE_PROVIDERS.filter((p) => p !== "workers-ai")
              : FREE_PROVIDERS
            : undefined,
          search: opts.search,
          model:
            model && provider && !model.startsWith(`${provider}/`)
              ? `${provider}/${model}`
              : model,
        });
  for (const note of catalog.notes) process.stderr.write(`Note: ${note}\n`);
  for (const warning of catalog.warnings)
    process.stderr.write(`Warning: ${warning}; results are incomplete\n`);
  let entries = catalog.entries;
  if (model) {
    const matches = entries.filter(
      (e) =>
        e.id === model ||
        (provider && e.id === `${provider}/${model}`) ||
        e.id.split("/").at(-1) === model
    );
    if (matches.length > 1)
      throw new Error(
        `Ambiguous model ${model}; use a full ID: ${matches.map((e) => e.id).join(", ")}`
      );
    const found = matches[0];
    if (!found)
      throw new Error(
        `model not found: ${model}. Run ai models --search ${model}`
      );
    if (opts.json) process.stdout.write(JSON.stringify(found, null, 2) + "\n");
    else {
      process.stdout.write(
        `\n${found.id}\nGateway: cloudflare  Provider: ${found.provider}  Creator: ${found.creator}\n`
      );
      if (found.name) process.stdout.write(`${found.name}\n`);
      if (found.description) process.stdout.write(`${found.description}\n`);
      process.stdout.write(
        `Type: ${found.capabilities.join(", ") || "unclassified"}\nSource: ${found.source}\n`
      );
      if (found.contextWindow)
        process.stdout.write(
          `Context: ${found.contextWindow.toLocaleString()} tokens\n`
        );
      if (found.maxTokens)
        process.stdout.write(
          `Max output: ${found.maxTokens.toLocaleString()} tokens\n`
        );
      process.stdout.write(`${price(found)}\n`);
      const command =
        found.capabilities[0] === "speech"
          ? "audio speak"
          : found.capabilities[0] === "transcription"
            ? "audio transcribe"
            : found.capabilities[0];
      if (command) process.stdout.write(`Use: ai ${command} -m ${found.id}\n`);
    }
    return;
  }
  if (type)
    entries = entries.filter((e) =>
      type === "audio"
        ? e.capabilities.some((c) => c === "speech" || c === "transcription")
        : e.capabilities.includes(type as Modality)
    );
  if (provider) entries = entries.filter((e) => e.provider === provider);
  if (opts.creator)
    entries = entries.filter(
      (e) => e.creator.toLowerCase() === opts.creator!.toLowerCase()
    );
  if (opts.search) {
    const term = opts.search.toLowerCase();
    entries = entries.filter((e) =>
      `${e.id} ${e.name ?? ""} ${e.description ?? ""}`
        .toLowerCase()
        .includes(term)
    );
  }
  if (opts.free) entries = entries.filter(isFreeOffer);
  entries.sort((a, b) => a.id.localeCompare(b.id));
  if (opts.best && opts.free)
    entries = MODALITIES.filter(
      (modality) => modelPreferences().bestFree[modality]?.length
    )
      .map((modality) => preferredFree(entries, modality))
      .filter((entry): entry is CatalogEntry => Boolean(entry));
  if (opts.free && type === "image" && entries.length === 0)
    process.stderr.write(
      "No verified free image model in the supported catalogs. Try ai image --cheapest for the saved paid option.\n"
    );
  const filtered = Boolean(
    provider ||
    type ||
    opts.creator ||
    opts.search ||
    opts.free ||
    opts.best ||
    opts.cheapest
  );
  // JSON remains an untruncated array for scripts unless --limit is explicit.
  if (opts.json) {
    process.stdout.write(
      JSON.stringify(opts.limit ? entries.slice(0, limit) : entries, null, 2) +
        "\n"
    );
    return;
  }
  process.stdout.write(
    `\n${heading(summary ? "Your models" : "Models")}\nGateway: cloudflare\n\n`
  );
  if (!filtered && !opts.all && !opts.limit) {
    for (const p of catalog.providers) {
      const rows = entries.filter((e) => e.provider === p);
      const free = rows.filter((e) => e.free).length;
      process.stdout.write(
        `  ${heading(p.padEnd(12))} ${summary ? "configured" : `${rows.length} models`}${free ? `, ${free} free` : ""}\n`
      );
    }
    process.stdout.write(`\n${heading("Default models")}\n`);
    for (const modality of [
      "text",
      "image",
      "video",
      "speech",
      "transcription",
    ] as Modality[]) {
      process.stdout.write(
        wrapped(modality) + accent(wrapped(resolveModels(modality)[0]!, "    "))
      );
    }
  } else {
    const shown = opts.all ? entries : entries.slice(0, limit);
    for (const e of shown)
      process.stdout.write(
        heading(wrapped(e.id)) +
          (type
            ? ""
            : wrapped(e.capabilities.join(", ") || "unclassified", "    ")) +
          (e.free
            ? statusColor(wrapped("FREE", "    "), "ok")
            : e.freeTier
              ? statusColor(
                  wrapped("FREE TIER (billing conditions apply)", "    "),
                  "warning"
                )
              : "") +
          "\n"
      );
    process.stdout.write(
      `\nShowing ${shown.length} of ${entries.length} matching models${shown.length < entries.length ? "; use --all or narrow --search" : ""}.\n`
    );
  }
  process.stdout.write(
    "\n" +
      heading("Next steps") +
      "\n" +
      action("Search", "ai models --provider openrouter --search gemini") +
      action("Free models", "ai models --free") +
      action("Saved choices", "ai models --best") +
      action("Lowest cost", "ai models --cheapest") +
      action("Model details", "ai models <full-id>") +
      "\n" +
      wrapped('Use a model: ai text -m <full-id> "hello"', "")
  );
}

function price(entry: CatalogEntry): string {
  if (entry.freeTier)
    return `Free-tier conditions: ${entry.freeTier.condition} Source: ${entry.freeTier.source}`;
  if (entry.free)
    return "FREE (zero listed OpenRouter prices; rate limits apply)";
  const input = entry.pricing?.input;
  const output = entry.pricing?.output;
  if (
    input !== undefined &&
    output !== undefined &&
    Number(input) >= 0 &&
    Number(output) >= 0
  )
    return `USD per million tokens: input $${Number(input) * 1e6}, output $${Number(output) * 1e6}`;
  return "Pricing: not supplied by this catalog";
}

function bestEntries(choice: "best" | "cheapest"): CatalogEntry[] {
  return Object.entries(modelPreferences()[choice]).map(([type, id]) => {
    const route = routeCloudflareModel(
      id,
      type === "text" ? "language" : (type as Exclude<Modality, "text">)
    );
    return {
      id,
      provider: route.provider,
      creator: route.modelId.includes("/")
        ? route.modelId.split("/")[0]!
        : route.provider,
      capabilities: [type as Modality],
      source: "saved editorial preference",
    };
  });
}
