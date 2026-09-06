import { generateText } from "ai";

import type { Command } from "../lib/command.js";
import { errorMessage } from "../lib/errors.js";
import {
  languageModel,
  resolveCloudflareGatewayConfig,
  resolveGatewayBackend,
  routeCloudflareModel,
} from "../lib/gateway.js";
import { resolveModels, type Modality } from "../lib/models.js";
import { findAlternatives } from "./alternatives.js";
import {
  configuredProviders,
  fetchCloudflareCatalog,
  parseProvider,
} from "./catalog.js";
import { withGateway } from "./options.js";
import { accent, action, heading, statusColor, wrapped } from "./output.js";
import { modelPreferences, preferenceLocation } from "./preferences.js";
import {
  PROVIDER_REGISTRY,
  PROVIDERS,
  providersFor,
  isProviderEnabled,
} from "./providers.js";

interface Check {
  name: string;
  status: "ok" | "warning" | "error";
  detail: string;
}
interface DiagnosticOptions {
  gateway?: string;
  provider?: string;
  json?: boolean;
  probe?: boolean;
  model?: string;
  type?: string;
  all?: boolean;
  details?: boolean;
}

export async function doctorChecks(opts: DiagnosticOptions): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (name: string, status: Check["status"], detail: string) =>
    checks.push({ name, status, detail });
  const major = Number(process.versions.node.split(".")[0]);
  add(
    "runtime",
    major >= 22 ? "ok" : "error",
    `Node ${process.versions.node}; requires Node 22+`
  );
  let backend: string;
  try {
    backend = resolveGatewayBackend();
  } catch (error) {
    add("gateway", "error", errorMessage(error));
    return checks;
  }
  add("gateway", "ok", backend);
  try {
    modelPreferences();
    add("preferences", "ok", preferenceLocation());
  } catch (error) {
    add("preferences", "error", errorMessage(error));
  }
  if (backend === "cloudflare") {
    try {
      resolveCloudflareGatewayConfig();
      add(
        "credentials",
        "ok",
        "Cloudflare account and gateway token present; provider keys stay in Cloudflare"
      );
    } catch (error) {
      add("credentials", "error", errorMessage(error));
      return checks;
    }
    try {
      const provider = opts.provider ? parseProvider(opts.provider) : undefined;
      const catalog = await fetchCloudflareCatalog(provider);
      for (const p of catalog.providers) {
        const failure = catalog.warnings.find((w) => w.startsWith(`${p}:`));
        add(
          p,
          failure ? "error" : "ok",
          failure ??
            `${catalog.entries.filter((e) => e.provider === p).length} catalog models; inference not tested`
        );
      }
      if (!catalog.providers.length)
        add(
          "providers",
          "error",
          "No supported Provider Keys with the default alias. Configure keys in Cloudflare."
        );
      for (const note of catalog.notes) add("catalog scope", "warning", note);
    } catch (error) {
      add("catalogs", "error", errorMessage(error));
    }
  } else {
    add(
      "credentials",
      process.env.AI_GATEWAY_API_KEY ? "ok" : "error",
      process.env.AI_GATEWAY_API_KEY
        ? "Vercel gateway key present; not verified"
        : "Set AI_GATEWAY_API_KEY for Vercel"
    );
  }
  if (opts.probe) {
    try {
      const model = opts.model ?? resolveModels("text")[0]!;
      // Explicit --probe authorizes one short inference. Cap retries, runtime,
      // and output; an empty reasoning-only response is not a successful probe.
      if (
        opts.provider &&
        routeCloudflareModel(model, "language").provider !== opts.provider
      )
        throw new Error(
          "Probe model and --provider disagree; use a full route ID for the selected provider"
        );
      const result = await generateText({
        model: languageModel(model),
        headers: { "x-title": "ai-cli doctor" },
        prompt: "Reply with exactly OK.",
        maxOutputTokens: 2048,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(30_000),
      });
      if (!result.text.trim())
        throw new Error(
          "Model returned no text; its output budget may have been consumed by reasoning"
        );
      add("inference", "ok", `${model} returned text successfully`);
    } catch (error) {
      add("inference", "error", errorMessage(error));
    }
  } else
    add(
      "inference",
      "warning",
      opts.provider &&
        !providersFor("text").includes(parseProvider(opts.provider))
        ? "Not tested. This provider has no text probe; use its generation command after setup checks pass."
        : "Not tested. Use ai doctor --probe --model <full-id> for a short text request (may cost money)."
    );
  return checks;
}

export function registerDiagnostics(program: Command) {
  program
    .command("gateways")
    .description("Show gateway choices and how to override the default")
    .option("--json", "Output JSON")
    .action(async (_: unknown, opts: DiagnosticOptions) => {
      const selected = resolveGatewayBackend();
      const rows = [
        {
          id: "cloudflare",
          selected: selected === "cloudflare",
          description: "Cloudflare routing with stored BYOK provider keys",
        },
        {
          id: "vercel",
          selected: selected === "vercel",
          description: "Vercel AI Gateway; needs AI_GATEWAY_API_KEY",
        },
      ];
      if (opts.json) process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
      else {
        process.stdout.write(`\n${heading("Gateways")}\n\n`);
        for (const row of rows)
          process.stdout.write(
            heading(wrapped(row.id + (row.selected ? "  [selected]" : ""))) +
              wrapped(
                row.id === "cloudflare"
                  ? "Uses your provider keys stored in Cloudflare."
                  : "Uses a Vercel AI Gateway key.",
                "    "
              ) +
              "\n"
          );
        process.stdout.write(
          heading("Choose a gateway") +
            "\n" +
            action("One command", 'ai text --gateway vercel "hello"') +
            action("Shell default", "export AI_CLI_GATEWAY=cloudflare") +
            action("Choose a host", "ai providers") +
            "\n"
        );
      }
    });
  program
    .command("providers")
    .description("Show configured model hosts, or alternatives for a model")
    .argument(
      "[model]",
      "Full model route ID; find matching hosts or likely spelling fixes"
    )
    .option("--gateway <name>", "cloudflare (default) or vercel")
    .option(
      "--all",
      "Show every supported provider (including unconfigured ones)"
    )
    .option(
      "--details",
      "Include authentication, billing notes and source links"
    )
    .option("--json", "Output JSON")
    .option(
      "--type <type>",
      "Alternative model type: text, image, video, speech, transcription"
    )
    .action(async (model: string | undefined, opts: DiagnosticOptions) =>
      withGateway(opts.gateway, async () => {
        if (resolveGatewayBackend() !== "cloudflare") {
          const result = {
            gateway: "vercel",
            guidance:
              "Provider access is managed by Vercel. Use ai models --gateway vercel.",
          };
          process.stdout.write(
            opts.json ? JSON.stringify(result) + "\n" : result.guidance + "\n"
          );
          return;
        }
        if (model) {
          if (
            opts.type &&
            !["text", "image", "video", "speech", "transcription"].includes(
              opts.type
            )
          )
            throw new Error("Invalid --type");
          const result = await findAlternatives(
            model,
            opts.type as Modality | undefined
          );
          if (opts.json)
            process.stdout.write(JSON.stringify(result, null, 2) + "\n");
          else {
            for (const row of result.alternatives)
              process.stdout.write(`${row.id}  (${row.kind})\n`);
            if (!result.alternatives.length)
              process.stdout.write(
                "No close catalog alternatives found. Try ai models --search <name>.\n"
              );
            process.stdout.write(
              "Catalog matches are not proof of credit/quota. Test text with ai doctor --probe --model <full-id>.\n"
            );
          }
          for (const warning of result.warnings)
            process.stderr.write(`Warning: ${warning}\n`);
          return;
        }
        const configured = opts.all ? [] : await configuredProviders();
        const rows = (opts.all ? PROVIDERS : configured).map((id) => ({
          id,
          catalogUrl: PROVIDER_REGISTRY[id].catalogUrl,
          pricingUrl: PROVIDER_REGISTRY[id].pricingUrl,
          enabled: isProviderEnabled(id),
          capabilities: PROVIDER_REGISTRY[id].modalities.join(", "),
          ...(opts.all || opts.details
            ? {
                auth: PROVIDER_REGISTRY[id].auth,
                nuance: PROVIDER_REGISTRY[id].nuance,
                sources: PROVIDER_REGISTRY[id].sources,
              }
            : {}),
        }));
        if (opts.json)
          process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
        else {
          process.stdout.write(
            `\n${heading(opts.all ? "Supported providers" : "Your providers")}\n`
          );
          process.stdout.write(wrapped("Gateway: cloudflare", "") + "\n");
          for (const row of rows) {
            const label = row.enabled ? row.id : `${row.id}  [disabled]`;
            process.stdout.write(
              row.enabled
                ? accent(heading(wrapped(label)))
                : statusColor(heading(wrapped(label)), "warning")
            );
            process.stdout.write(
              wrapped(PROVIDER_REGISTRY[row.id].summary, "    ")
            );
            if (opts.details) {
              process.stdout.write(
                wrapped(`Models: ${row.capabilities}`, "    ")
              );
              process.stdout.write(
                accent(wrapped(`Catalog: ${row.catalogUrl}`, "    "))
              );
              process.stdout.write(
                accent(wrapped(`Pricing: ${row.pricingUrl}`, "    "))
              );
              process.stdout.write(wrapped(`Auth: ${row.auth}`, "    "));
              process.stdout.write(wrapped(`Notes: ${row.nuance}`, "    "));
              for (const source of row.sources ?? [])
                process.stdout.write(wrapped(source, "    "));
            }
            process.stdout.write("\n");
          }
          if (opts.all)
            process.stdout.write(
              wrapped(
                "Supported integrations; run ai doctor to check your account.",
                ""
              ) + "\n"
            );
          process.stdout.write(
            heading("Next steps") +
              "\n" +
              action("Browse models", "ai models --provider openrouter") +
              action("Free models", "ai models --free") +
              action("Check access", "ai doctor") +
              action("Provider notes", "ai providers --all --details") +
              "\n"
          );
        }
      })
    );
  program
    .command("doctor")
    .description(
      "Check setup and provider catalogs; --probe also tests text generation"
    )
    .option("--gateway <name>", "cloudflare (default) or vercel")
    .option("--provider <name>", "Check one Cloudflare provider")
    .option("--probe", "Send one short text request (may incur cost)")
    .option("-m, --model <id>", "Full route ID to test with --probe")
    .option("--json", "Output diagnostic results as JSON")
    .action(async (_: unknown, opts: DiagnosticOptions) =>
      withGateway(opts.gateway, async () => {
        if (opts.model && !opts.probe)
          throw new Error("--model requires --probe");
        if (opts.provider) parseProvider(opts.provider);
        const checks = await doctorChecks(opts);
        const ok = checks.every((check) => check.status !== "error");
        if (opts.json)
          process.stdout.write(JSON.stringify({ ok, checks }, null, 2) + "\n");
        else
          for (const check of checks)
            process.stdout.write(
              `${statusColor(check.status.toUpperCase(), check.status)}  ${heading(check.name)}\n${wrapped(check.detail)}\n`
            );
        if (!ok) process.exitCode = 1;
      })
    );
}
