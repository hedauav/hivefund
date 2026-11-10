// Procurement proposals: the worker reads the REAL catalog and recommends one item. Effort differs genuinely:
//   low (cheap):     LLM sees only the first 12 raw catalog entries (no pre-filter); the LLM's own quoted
//                    prices are submitted as-is, so a misread price fails the verifier's catalog check.
//   medium (adaptive): first 30 entries, pre-filtered by code to compliant ones; prices filled from the catalog.
//   high (quality):  whole catalog, pre-filtered to compliant options with costs; prices filled from the catalog.
// Without an LLM (mock/simulation only) a deterministic heuristic picks with the same scan depths.
import {
  compliantOptions,
  itemSourceUrl,
  liveCatalog,
  parseCatalog,
  round6,
  workloadCost,
  type CatalogItem,
  type CatalogSource,
  type CompliantOption,
  type ProcurementSpec,
} from "@hivefund/shared";
import type { BountySpec } from "@hivefund/shared";
import type { LlmClient } from "./ports.ts";
import type { Quality } from "./pricing.ts";
import type { TemplateOutput } from "./templates/index.ts";

export const SCAN_DEPTH: Record<Quality, number> = { low: 12, medium: 30, high: Number.POSITIVE_INFINITY };

export interface ProcurementContext {
  quality: Quality;
  llm: LlmClient | null;
  catalog?: CatalogSource;
  maxTokens: number;
  style: string;
  now?: () => number;
}

interface Proposal {
  item_id: string;
  quoted_pricing: { input: number; output: number };
  justification: string;
  sections: Record<string, string>;
  alternatives: { item_id: string; workload_cost_usd: number }[];
}

export async function generateProcurement(spec: BountySpec, ctx: ProcurementContext): Promise<TemplateOutput> {
  const p = spec.procurement as ProcurementSpec;
  const fetchedAt = (ctx.now ?? Date.now)();
  const items = parseCatalog(await (ctx.catalog ?? liveCatalog)(p.catalog_url));
  if (items.length === 0) throw new Error("catalog returned no priced items");
  const depth = SCAN_DEPTH[ctx.quality];
  const scanned = items.slice(0, Math.min(items.length, depth));
  const filtered = ctx.quality === "low" ? null : compliantOptions(scanned, p);

  const proposal = ctx.llm
    ? await proposeWithLlm(spec, p, ctx, scanned, filtered)
    : proposeHeuristic(p, ctx.quality, scanned, filtered);

  // Careful workers re-read the price from the catalog; the cheap worker trusts what its LLM wrote.
  const chosen = items.find((i) => i.id === proposal.item_id);
  const quoted = ctx.quality === "low" || !chosen ? proposal.quoted_pricing : chosen.pricing;
  return {
    sections: proposal.sections,
    data: {
      item_id: proposal.item_id,
      source_url: itemSourceUrl(p, proposal.item_id),
      quoted_pricing: { input: quoted.input, output: quoted.output },
      quoted_workload_cost_usd: workloadCost(quoted, p.workload),
      catalog_fetched_at_ms: fetchedAt,
      considered_count: scanned.length,
      alternatives: proposal.alternatives.slice(0, 10),
      justification: proposal.justification,
    },
  };
}

function describe(i: CatalogItem, p: ProcurementSpec): string {
  return (
    `${i.id} | in $${i.pricing.input}/1M out $${i.pricing.output}/1M | workload $${workloadCost(i.pricing, p.workload)} | ` +
    `ctx ${i.context_length ?? "?"} | features ${i.supported_features.join(",") || "-"} | in ${i.input_modalities.join(",")} out ${i.output_modalities.join(",")}`
  );
}

async function proposeWithLlm(
  spec: BountySpec,
  p: ProcurementSpec,
  ctx: ProcurementContext,
  scanned: CatalogItem[],
  filtered: CompliantOption[] | null,
): Promise<Proposal> {
  const llm = ctx.llm!;
  const list = filtered ? filtered.map((o) => o.item) : scanned;
  if (list.length === 0) throw new Error("no catalog entries to choose from in the scanned range");
  const ids = list.map((i) => i.id);
  const schema = {
    type: "object",
    required: ["item_id", "quoted_pricing", "alternatives", "justification", "sections"],
    properties: {
      item_id: { type: "string", enum: ids },
      quoted_pricing: {
        type: "object",
        required: ["input", "output"],
        properties: { input: { type: "number" }, output: { type: "number" } },
      },
      alternatives: {
        type: "array",
        items: {
          type: "object",
          required: ["item_id", "workload_cost_usd"],
          properties: { item_id: { type: "string" }, workload_cost_usd: { type: "number" } },
        },
      },
      justification: { type: "string" },
      sections: {
        type: "object",
        required: spec.required_sections,
        properties: Object.fromEntries(spec.required_sections.map((s) => [s, { type: "string" }])),
      },
    },
  };
  const user = [
    `Bounty: ${spec.title}`,
    `Task: ${spec.description}`,
    `Workload: ${p.workload.input_mtok}M input + ${p.workload.output_mtok}M output tokens. Budget: <= ${p.product_budget_usd} ${p.currency}.`,
    `Hard requirements: ${JSON.stringify(p.requirements)}`,
    `Rubric: ${spec.rubric.criteria.map((c) => `${c.id} (w ${c.weight}): ${c.description}`).join(" | ")}`,
    filtered
      ? `Catalog options already checked against the hard requirements and budget (${list.length} of the first ${scanned.length} entries):`
      : `Catalog entries you looked at (the first ${scanned.length} entries, NOT pre-checked; verify the requirements yourself):`,
    ...list.map((i) => `- ${describe(i, p)}`),
    `Pick exactly one item_id. quoted_pricing must be the catalog's USD per 1M tokens for that item. List up to 5 alternatives with their workload cost. ` +
      `Write the sections ${spec.required_sections.join(", ")} as markdown and a justification of at least two sentences.`,
  ].join("\n");
  const raw = (await llm.chat(
    [
      { role: "system", content: `${ctx.style} You are a procurement agent in the HiveFund market. Respond with JSON only.` },
      { role: "user", content: user },
    ],
    { schema: { name: "procurement_proposal", schema, strict: false }, maxTokens: ctx.maxTokens, temperature: 0.2 },
  )) as Record<string, any>;

  if (!raw || typeof raw.item_id !== "string") throw new Error("LLM proposal has no item_id");
  const qp = raw.quoted_pricing ?? {};
  const sections: Record<string, string> = {};
  for (const [k, v] of Object.entries((raw.sections ?? {}) as Record<string, unknown>)) {
    if (typeof v === "string") sections[k] = v;
  }
  const alternatives = Array.isArray(raw.alternatives)
    ? raw.alternatives
        .filter((a: any) => a && typeof a.item_id === "string" && Number.isFinite(Number(a.workload_cost_usd)))
        .map((a: any) => ({ item_id: a.item_id, workload_cost_usd: round6(Number(a.workload_cost_usd)) }))
    : [];
  return {
    item_id: raw.item_id,
    quoted_pricing: { input: Number(qp.input), output: Number(qp.output) },
    justification: String(raw.justification ?? ""),
    sections,
    alternatives,
  };
}

/**
 * No-LLM simulation (mock mode only): deterministic picks with the same scan depths.
 * low: first entry in scan order that meets the requirements and budget; medium/high: cheapest compliant
 * option in the scanned range, preferring ones that also support json_mode/reasoning when within 25% of the cheapest.
 */
export function proposeHeuristic(
  p: ProcurementSpec,
  quality: Quality,
  scanned: CatalogItem[],
  filtered: CompliantOption[] | null,
): Proposal {
  const options = filtered ?? compliantOptions(scanned, p);
  let pick: CompliantOption | undefined;
  if (quality === "low") {
    const ids = new Set(options.map((o) => o.item.id));
    const first = scanned.find((i) => ids.has(i.id));
    pick = options.find((o) => o.item.id === first?.id);
  } else {
    const cheapest = options[0];
    const extra = (o: CompliantOption) => ["json_mode", "reasoning"].filter((f) => o.item.supported_features.includes(f)).length;
    pick = cheapest
      ? options
          .filter((o) => o.workload_cost_usd <= cheapest.workload_cost_usd * 1.25)
          .sort((a, b) => extra(b) - extra(a) || a.workload_cost_usd - b.workload_cost_usd)[0]
      : undefined;
  }
  if (!pick) throw new Error("no compliant option in the scanned catalog range");
  const alts = options.filter((o) => o.item.id !== pick!.item.id).slice(0, 5);
  const line = (o: CompliantOption) =>
    `- ${o.item.id}: $${o.workload_cost_usd} for the workload (in $${o.item.pricing.input}/1M, out $${o.item.pricing.output}/1M, ` +
    `context ${o.item.context_length}, features ${o.item.supported_features.join(", ")})`;
  const i = pick.item;
  const extras = ["json_mode", "reasoning"].filter((f) => i.supported_features.includes(f));
  const cheapest = options[0]!.workload_cost_usd;
  return {
    item_id: i.id,
    quoted_pricing: i.pricing,
    justification:
      `${i.id} meets every hard requirement (tools, structured_outputs, context ${i.context_length}, text in/out) and costs ` +
      `$${pick.workload_cost_usd} for the workload against a budget of $${p.product_budget_usd}; the cheapest compliant option in the ` +
      `scanned range costs $${cheapest}. Chosen by a deterministic simulation heuristic (no LLM) from ${scanned.length} scanned catalog entries.`,
    sections: {
      summary:
        `Recommend ${i.id} at $${pick.workload_cost_usd} per month for ${p.workload.input_mtok}M input + ` +
        `${p.workload.output_mtok}M output tokens (simulation heuristic, no LLM).`,
      comparison: [
        `Compliant options under budget in the scanned range (${options.length}), with catalog prices and workload cost:`,
        line(pick),
        ...alts.map(line),
      ].join("\n"),
      recommendation:
        `Use ${i.id}: in $${i.pricing.input}/1M, out $${i.pricing.output}/1M, context ${i.context_length}. ` +
        "Tool calling and structured output cover wallet lookups, docs search and JSON answers for the support agent; " +
        "the long context keeps chat histories" +
        (extras.length ? `; it also supports ${extras.join(" and ")}, which helps structured output reliability.` : ".") +
        ` Its workload cost is ${Math.round((100 * pick.workload_cost_usd) / cheapest)}% of the cheapest compliant option.`,
    },
    alternatives: alts.map((o) => ({ item_id: o.item.id, workload_cost_usd: o.workload_cost_usd })),
  };
}
