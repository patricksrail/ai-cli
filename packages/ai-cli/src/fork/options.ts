import {
  resolveModel,
  type Provider,
} from "@patricksrail/bricks/ai/preferences";

import type { Command } from "../lib/command.js";
import { resolveGatewayBackend } from "../lib/gateway.js";
import type { Modality } from "../lib/models.js";
import { parseProvider } from "./catalog.js";
import { executionPolicy } from "./execution-policy.js";
import { modelPreferences } from "./preferences.js";
import { PROVIDERS } from "./providers.js";
import { selectModel } from "./selection.js";

export interface RoutingOptions {
  gateway?: string;
  provider?: string;
  model?: string;
  best?: boolean;
  free?: boolean;
  cheapest?: boolean;
  quiet?: boolean;
  fallback?: boolean;
  fallbacks?: string;
}

export async function withGateway<T>(
  gateway: string | undefined,
  action: () => Promise<T>
): Promise<T> {
  const previous = process.env.AI_CLI_GATEWAY;
  try {
    if (gateway !== undefined) process.env.AI_CLI_GATEWAY = gateway;
    resolveGatewayBackend();
    return await action();
  } finally {
    if (previous === undefined) delete process.env.AI_CLI_GATEWAY;
    else process.env.AI_CLI_GATEWAY = previous;
  }
}

export function qualifyProviderModels(
  provider: string,
  model?: string
): string {
  const selected = parseProvider(provider);
  if (!model?.trim())
    throw new Error(
      "--provider requires --model with the provider's native model ID; browse with ai models --provider " +
        selected
    );
  // Treat --model as the provider's native ID when --provider is explicit.
  // Thus --provider openrouter -m openai/gpt-5 routes to OpenRouter, and
  // --provider openrouter -m openrouter/free keeps OpenRouter's native namespace.
  return model
    .split(",")
    .map((id) => {
      const alias = modelPreferences().preferred.find(
        (m) => m.alias === id.trim()
      );
      return alias
        ? resolveModel(id.trim(), {
            provider: selected as Provider,
            preferences: modelPreferences(),
          }).route
        : `${selected}/${id.trim()}`;
    })
    .join(",");
}

/** Small registration seam keeps fork routing out of upstream command bodies. */
export function addRoutingOptions(
  command: Command,
  modality: Modality = "text"
) {
  command
    .option(
      "--gateway <name>",
      "Gateway: cloudflare (default) or vercel; overrides AI_CLI_GATEWAY"
    )
    .option(
      "--provider <name>",
      `Cloudflare provider: ${PROVIDERS.join(", ")}; use -m with its native ID`
    );
  command
    .option(
      "--best",
      "Use saved best model; combine with --free for the best free preference"
    )
    .option(
      "--free",
      "Choose a free model; provider billing/quota checks apply (ai providers --all)"
    )
    .option(
      "--cheapest",
      modality === "image"
        ? "Use saved low-cost image model; --size 512x512 for a small draft"
        : "Use saved low-cost model; see ai models --cheapest"
    )
    .option(
      "--fallbacks <models>",
      "Ordered fallback route IDs or saved aliases, comma-separated"
    )
    .option(
      "--no-fallback",
      "Attempt only the selected model; disable saved fallback routes"
    );
  return {
    action<TArgument, TOptions>(
      handler: (
        argument: TArgument,
        options: TOptions
      ) => unknown | Promise<unknown>
    ): Command {
      return command.action(
        async (argument: TArgument, options: TOptions & RoutingOptions) => {
          await withGateway(options.gateway, async () => {
            if (options.fallback === false && options.fallbacks)
              throw new Error("Use --fallbacks or --no-fallback, not both");
            if (options.fallbacks && resolveGatewayBackend() !== "cloudflare")
              throw new Error("--fallbacks requires Cloudflare");
            if (options.best || options.free || options.cheapest) {
              if (resolveGatewayBackend() !== "cloudflare")
                throw new Error(
                  "--best, --free and --cheapest require Cloudflare"
                );
              if (
                options.model &&
                (!options.free || options.best || options.cheapest)
              )
                throw new Error(
                  "Choose -m or a model selection flag (--best, --free, --cheapest)"
                );
              if (options.model && options.provider)
                options.model = qualifyProviderModels(
                  options.provider,
                  options.model
                );
              if (
                options.model &&
                !options.provider &&
                modelPreferences().preferred.some(
                  (m) => m.alias === options.model
                )
              )
                options.model = resolveModel(options.model, {
                  modality,
                  preferences: modelPreferences(),
                }).route;
              const selected = await selectModel(modality, options);
              options.model = selected.id;
              if (!options.quiet)
                process.stderr.write(
                  `Selected ${selected.id}: ${selected.reason}\n`
                );
            } else if (options.provider) {
              if (resolveGatewayBackend() !== "cloudflare")
                throw new Error(
                  "--provider selects a Cloudflare BYOK provider; omit it for Vercel"
                );
              options.model = qualifyProviderModels(
                options.provider,
                options.model
              );
            }
            const previousFree = process.env.AI_CLI_FREE_ONLY;
            try {
              // Recheck free-only billing at inference, not just discovery.
              if (options.free) process.env.AI_CLI_FREE_ONLY = "1";
              await executionPolicy.run(
                {
                  fallback: options.fallback,
                  fallbacks: options.fallbacks?.split(",").map((m) => m.trim()),
                  free: options.free,
                  provider: options.provider
                    ? parseProvider(options.provider)
                    : undefined,
                },
                () => handler(argument, options)
              );
            } finally {
              if (previousFree === undefined)
                delete process.env.AI_CLI_FREE_ONLY;
              else process.env.AI_CLI_FREE_ONLY = previousFree;
            }
          });
        }
      );
    },
  };
}
