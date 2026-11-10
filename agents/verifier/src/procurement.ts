// Procurement checks. The verifier never trusts the worker's numbers: it re-fetches the LIVE catalog, finds the
// item, compares the quoted price with the live price (relative tolerance from the spec), recomputes the workload
// cost against the budget and evaluates every hard requirement. Optionally it then "uses the purchase": one tiny
// real call to the chosen model through NEAR AI, recording HTTP status, token usage and cost at live prices.
import {
  checkRequirements,
  compliantOptions,
  liveCatalog,
  parseCatalog,
  priceMatches,
  round6,
  workloadCost,
  type CatalogItem,
  type CatalogSource,
  type CheckResult,
  type CompliantOption,
  type Deliverable,
  type ProcurementEvidence,
  type ProcurementSpec,
} from "@hivefund/shared";
import type { Clock } from "./checks.ts";

export interface DeliveryResult {
  ok: boolean;
  http_status: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  details: string;
}

/** Makes one tiny real request to `model`. */
export type DeliveryProbe = (model: string) => Promise<DeliveryResult>;

/** NEAR AI probe from env (NEARAI_API_KEY); null when no key is configured. */
export function nearAiDeliveryProbeFromEnv(env: NodeJS.ProcessEnv = process.env): DeliveryProbe | null {
  const key = env.NEARAI_API_KEY;
  if (!key) return null;
  const base = (env.NEARAI_BASE_URL || "https://cloud-api.near.ai/v1").replace(/\/+$/, "");
  // Providers behind NEAR AI accept different parameter sets (OpenAI reasoning models reject max_tokens and
  // chat_template_kwargs; GLM needs enable_thinking:false). Send the minimal portable body first, then retry
  // once with the provider-specific variant if the first is rejected as a bad parameter.
  const bodies = (model: string): Record<string, unknown>[] => {
    const messages = [{ role: "user", content: 'Reply with the single word "ok".' }];
    if (model.startsWith("z-ai/")) return [{ model, messages, max_tokens: 64, chat_template_kwargs: { enable_thinking: false } }];
    return [
      { model, messages, max_tokens: 256 },
      { model, messages, max_completion_tokens: 256 },
    ];
  };
  return async (model) => {
    try {
      let res: Response | null = null;
      let text = "";
      for (const body of bodies(model)) {
        res = await fetch(`${base}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(60_000),
        });
        text = await res.text();
        if (!(res.status === 400 && /parameter/i.test(text))) break;
      }
      if (!res) throw new Error("no request made");
      let j: any = null;
      try {
        j = JSON.parse(text);
      } catch {
        /* non-JSON */
      }
      const pt = Number(j?.usage?.prompt_tokens);
      const ct = Number(j?.usage?.completion_tokens);
      const usage = Number.isFinite(pt) && Number.isFinite(ct);
      const content = String(j?.choices?.[0]?.message?.content ?? "").trim();
      return {
        ok: res.ok && usage,
        http_status: res.status,
        prompt_tokens: usage ? pt : null,
        completion_tokens: usage ? ct : null,
        details: res.ok
          ? `HTTP ${res.status}; reply ${JSON.stringify(content.slice(0, 40))}`
          : `HTTP ${res.status}: ${(j?.error?.message ?? text).toString().slice(0, 160)}`,
      };
    } catch (e) {
      return { ok: false, http_status: null, prompt_tokens: null, completion_tokens: null, details: `request failed: ${(e as Error).message}`.slice(0, 200) };
    }
  };
}

interface ProposalData {
  item_id?: unknown;
  quoted_pricing?: { input?: unknown; output?: unknown };
}

export interface CatalogCheckOutput {
  check: CheckResult;
  evidence: ProcurementEvidence;
  item: CatalogItem | null;
  options: CompliantOption[];
}

export async function checkCatalog(
  p: ProcurementSpec,
  d: Deliverable,
  source: CatalogSource | undefined,
  now: Clock,
): Promise<CatalogCheckOutput> {
  const t0 = now();
  const data = (d.data ?? {}) as ProposalData;
  const itemId = typeof data.item_id === "string" ? data.item_id : "";
  const qi = Number(data.quoted_pricing?.input);
  const qo = Number(data.quoted_pricing?.output);
  const quoted = Number.isFinite(qi) && Number.isFinite(qo) ? { input: qi, output: qo } : null;

  const evidence: ProcurementEvidence = {
    catalog_url: p.catalog_url,
    fetched_at_ms: now(),
    catalog_size: 0,
    item_id: itemId,
    found: false,
    quoted_pricing: quoted,
    live_pricing: null,
    price_match: false,
    quoted_workload_cost_usd: quoted ? workloadCost(quoted, p.workload) : null,
    live_workload_cost_usd: null,
    budget_usd: p.product_budget_usd,
    within_budget: false,
    requirement_checks: [],
    compliant_count: 0,
    cheapest_compliant: null,
    delivery: null,
  };

  let items: CatalogItem[];
  try {
    items = parseCatalog(await (source ?? liveCatalog)(p.catalog_url));
  } catch (e) {
    return {
      check: { id: "catalog", passed: false, details: `could not fetch live catalog: ${(e as Error).message}`.slice(0, 600), duration_ms: now() - t0 },
      evidence,
      item: null,
      options: [],
    };
  }
  evidence.catalog_size = items.length;
  const options = compliantOptions(items, p);
  evidence.compliant_count = options.length;
  evidence.cheapest_compliant = options[0] ? { id: options[0].item.id, workload_cost_usd: options[0].workload_cost_usd } : null;

  const item = items.find((i) => i.id === itemId) ?? null;
  const problems: string[] = [];
  if (!item) {
    problems.push(itemId ? `item ${JSON.stringify(itemId)} not in the live catalog` : "no item_id in the proposal");
  } else {
    evidence.found = true;
    evidence.live_pricing = item.pricing;
    evidence.live_workload_cost_usd = workloadCost(item.pricing, p.workload);
    evidence.within_budget = evidence.live_workload_cost_usd <= p.product_budget_usd;
    evidence.price_match = quoted !== null && priceMatches(quoted, item.pricing, p.price_tolerance_pct);
    evidence.requirement_checks = checkRequirements(item, p.requirements);
    if (!quoted) problems.push("no numeric quoted_pricing");
    else if (!evidence.price_match)
      problems.push(
        `quoted price in $${quoted.input}/out $${quoted.output} does not match live in $${item.pricing.input}/out $${item.pricing.output} (tolerance ${p.price_tolerance_pct}%)`,
      );
    if (!evidence.within_budget) problems.push(`live workload cost $${evidence.live_workload_cost_usd} exceeds budget $${p.product_budget_usd}`);
    for (const c of evidence.requirement_checks) if (!c.passed) problems.push(`requirement ${c.requirement}: expected ${c.expected}, got ${c.actual}`);
  }
  const passed = problems.length === 0;
  return {
    check: {
      id: "catalog",
      passed,
      details: (passed
        ? `${itemId} found in the fetched catalog (${items.length} items); price matches; $${evidence.live_workload_cost_usd} <= $${p.product_budget_usd}; ${evidence.requirement_checks.length} requirements met`
        : problems.join("; ")
      ).slice(0, 600),
      duration_ms: now() - t0,
    },
    evidence,
    item,
    options,
  };
}

export async function checkDelivery(
  p: ProcurementSpec,
  item: CatalogItem,
  probe: DeliveryProbe | null,
  evidence: ProcurementEvidence,
  now: Clock,
): Promise<CheckResult> {
  if (!p.delivery_check) return { id: "delivery", passed: true, skipped: true, details: "spec does not ask for a delivery check", duration_ms: 0 };
  if (!probe) return { id: "delivery", passed: true, skipped: true, details: "skipped: no NEAR AI key (simulation)", duration_ms: 0 };
  const t0 = now();
  const r = await probe(item.id);
  const cost =
    r.prompt_tokens !== null && r.completion_tokens !== null
      ? round6((r.prompt_tokens * item.pricing.input + r.completion_tokens * item.pricing.output) / 1_000_000)
      : null;
  evidence.delivery = { model: item.id, ok: r.ok, http_status: r.http_status, prompt_tokens: r.prompt_tokens, completion_tokens: r.completion_tokens, cost_usd: cost, details: r.details };
  return {
    id: "delivery",
    passed: r.ok,
    details: `one real call to ${item.id}: ${r.details}${r.prompt_tokens !== null ? `; ${r.prompt_tokens}+${r.completion_tokens} tokens ≈ $${cost}` : ""}`.slice(0, 600),
    duration_ms: now() - t0,
  };
}

/** Grounding for the rubric: the live compliant options the pick is judged against. */
export function procurementContext(p: ProcurementSpec, options: CompliantOption[], evidence: ProcurementEvidence): string {
  return [
    `Live catalog evidence fetched by the verifier (${evidence.catalog_size} items, ${options.length} meet every hard requirement and the $${p.product_budget_usd} budget for ${p.workload.input_mtok}M in + ${p.workload.output_mtok}M out tokens):`,
    ...options.slice(0, 25).map((o) => `- ${o.item.id}: $${o.workload_cost_usd} | ctx ${o.item.context_length} | ${o.item.supported_features.join(",")}`),
    `The worker picked ${evidence.item_id} at a live workload cost of $${evidence.live_workload_cost_usd}.`,
  ].join("\n");
}

/** Deterministic value score for the fallback rubric: 100 * sqrt(cheapest / chosen). */
export function valueScore(evidence: ProcurementEvidence): number | null {
  if (!evidence.cheapest_compliant || !evidence.live_workload_cost_usd) return null;
  const ratio = evidence.cheapest_compliant.workload_cost_usd / evidence.live_workload_cost_usd;
  return Math.max(0, Math.min(100, Math.round(100 * Math.sqrt(Math.min(1, ratio)))));
}
