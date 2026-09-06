import type { ImageModel } from "ai";

import { PROVIDER_REGISTRY } from "./providers.js";

export const WORKERS_AI_IMAGE = "@cf/black-forest-labs/flux-1-schnell";
const PRICING =
  "https://developers.cloudflare.com/workers-ai/platform/pricing/";
type Environment = Record<string, string | undefined>;
function config(env: Environment) {
  const account = env.CLOUDFLARE_ACCOUNT_ID;
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!account || !token)
    throw new Error(
      "Workers AI needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN with Workers AI Read permission; an AI Gateway Run-only token is insufficient."
    );
  return {
    base: `https://api.cloudflare.com/client/v4/accounts/${account}`,
    gateway: env.CLOUDFLARE_AI_GATEWAY_ID || "ai-cli",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };
}
async function jsonRequest(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    redirect: "error",
    signal: init.signal ?? AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(
      `Workers AI request failed (HTTP ${response.status}). Model listing needs Workers AI Metadata Read; inference needs Workers AI Read. Gateway and account subscription reads are required to verify free-only billing.`
    );
  const body = await response.json();
  if (body.success !== true)
    throw new Error("Workers AI returned an unsuccessful response");
  return body;
}

/** No client-side quota estimate can enforce a zero bill on a paid account:
 * concurrent requests and delayed analytics can exceed the free allowance.
 * The provider-enforced Workers Free plan hard stop is our billing protection.
 * https://developers.cloudflare.com/workers-ai/platform/pricing/
 * https://developers.cloudflare.com/api/resources/accounts/subresources/subscriptions/
 * Never downgrade a plan or switch gateway billing to make a check pass.
 */
export async function checkWorkersAIFreeBilling(
  env: Environment = process.env,
  allowBudget = false
) {
  const c = config(env);
  const gateway = await jsonRequest(
    `${c.base}/ai-gateway/gateways/${c.gateway}`,
    { headers: c.headers }
  );
  if (gateway.result?.workers_ai_billing_mode !== "postpaid")
    throw new Error(
      "Workers AI free-only mode requires verified standard billing; prepaid/unified or unknown gateway billing is refused."
    );
  // Patrick authorized $20/month for Workers AI on 2026-09-06. A configured
  // provider-wide cap permits ordinary generation, but never means "free".
  // Cloudflare's UI month is 2,592,000 seconds (rolling 30 days). Rules with
  // model/metadata filters cannot protect every request from this adapter.
  // https://developers.cloudflare.com/ai-gateway/features/spend-limits/
  const limits = gateway.result?.spend_limits;
  const capped =
    limits?.enabled === true &&
    limits.rules?.some(
      (rule: {
        enabled?: boolean;
        limit?: number;
        window?: number;
        limitType?: string;
        model?: unknown;
        metadata?: Record<string, unknown>;
        provider?: { mode?: string; values?: string[] };
      }) =>
        rule.enabled !== false &&
        rule.limitType === "cost" &&
        typeof rule.limit === "number" &&
        rule.limit > 0 &&
        rule.limit <= PROVIDER_REGISTRY["workers-ai"].monthlyBudgetUsd &&
        typeof rule.window === "number" &&
        rule.window >= 2592000 &&
        !rule.model &&
        !Object.keys(rule.metadata ?? {}).length &&
        (!rule.provider ||
          (rule.provider.mode === "filter" &&
            rule.provider.values?.includes("workers-ai")))
    );
  if (allowBudget && capped)
    return {
      paid: true,
      source:
        "https://developers.cloudflare.com/ai-gateway/features/spend-limits/",
      checked: new Date().toISOString().slice(0, 10),
      condition:
        "Workers AI gateway budget verified: at most $20 per rolling 30 days; concurrent requests can overshoot.",
    };
  const subscriptions = [];
  for (let page = 1; ; page++) {
    const body = await jsonRequest(
      `${c.base}/subscriptions?page=${page}&per_page=50`,
      { headers: c.headers }
    );
    if (!Array.isArray(body.result))
      throw new Error(
        "Cannot verify Workers Free plan: invalid subscription response"
      );
    subscriptions.push(...body.result);
    const info = body.result_info;
    if (info?.total_pages && page < info.total_pages) continue;
    if (
      typeof info?.total_count === "number" &&
      subscriptions.length < info.total_count
    ) {
      if (!body.result.length)
        throw new Error(
          "Cannot verify Workers Free plan: incomplete subscription response"
        );
      continue;
    }
    if (
      !info?.total_pages &&
      info?.total_count === undefined &&
      body.result.length === 50
    )
      throw new Error(
        "Cannot verify Workers Free plan: subscription pagination is unknown"
      );
    break;
  }
  // No paid subscriptions means there is no paid Workers entitlement. If any
  // subscription exists, require explicit Workers Free identification rather
  // than guessing unfamiliar billing IDs or ignoring a scheduled cancellation.
  if (subscriptions.length) {
    const workers = subscriptions.filter((row) =>
      /workers/i.test(JSON.stringify(row.rate_plan ?? {}))
    );
    if (
      !workers.length ||
      workers.some(
        (row) => row.rate_plan?.id !== "workers_free" || row.price !== 0
      )
    )
      throw new Error(
        "Workers AI free-only mode cannot verify a Workers Free plan. Paid Workers accounts can incur overages; no inference was sent. Do not change your existing plan just for this CLI."
      );
  }
  return {
    paid: false,
    source: PRICING,
    checked: new Date().toISOString().slice(0, 10),
    condition:
      "Workers Free plan verified; 10,000 shared neurons/day, provider hard stop at quota. Standard billing only.",
  };
}

export async function workersAIEntries(env: Environment = process.env) {
  const c = config(env);
  const body = await jsonRequest(
    `${c.base}/ai/models/search?search=flux-1-schnell`,
    { headers: c.headers }
  );
  if (
    !Array.isArray(body.result) ||
    !body.result.some((row: { name?: string }) => row.name === WORKERS_AI_IMAGE)
  )
    throw new Error(
      "Workers AI catalog does not list the supported FLUX.1 Schnell model"
    );
  const billing = await checkWorkersAIFreeBilling(env, true);
  return [
    {
      id: `workers-ai/${WORKERS_AI_IMAGE}`,
      provider: "workers-ai" as const,
      creator: "black-forest-labs",
      name: "FLUX.1 Schnell (Cloudflare-hosted)",
      capabilities: ["image" as const],
      source: "Workers AI catalog + live billing check",
      ...(billing.paid ? {} : { freeTier: billing }),
    },
  ];
}

export function workersAIImage(
  modelId: string,
  env: Environment = process.env
): ImageModel {
  if (modelId !== WORKERS_AI_IMAGE)
    throw new Error(
      `Workers AI image adapter currently supports only ${WORKERS_AI_IMAGE}`
    );
  return {
    specificationVersion: "v4",
    provider: "workers-ai",
    modelId,
    maxImagesPerCall: 1,
    async doGenerate(options) {
      if (options.files?.length || options.mask)
        throw new Error(
          "Workers AI FLUX.1 Schnell supports text-to-image only"
        );
      // The published schema exposes prompt/steps, not arbitrary resolution or
      // aspect ratio. Reject unsupported controls instead of pretending savings.
      if (options.size || options.aspectRatio || options.seed !== undefined)
        throw new Error(
          "Workers AI FLUX.1 Schnell does not advertise size/aspect-ratio/seed controls in its current schema; omit these options."
        );
      await checkWorkersAIFreeBilling(env, env.AI_CLI_FREE_ONLY !== "1");
      const c = config(env);
      const body = await jsonRequest(`${c.base}/ai/run/${WORKERS_AI_IMAGE}`, {
        method: "POST",
        headers: {
          ...c.headers,
          "cf-aig-gateway-id": c.gateway,
        },
        body: JSON.stringify({ prompt: options.prompt, steps: 4 }),
        signal: options.abortSignal ?? AbortSignal.timeout(60000),
      });
      if (typeof body.result?.image !== "string" || !body.result.image.length)
        throw new Error("Workers AI returned no image");
      return {
        images: [body.result.image],
        warnings: [],
        response: { timestamp: new Date(), modelId, headers: {} },
      };
    },
  };
}
