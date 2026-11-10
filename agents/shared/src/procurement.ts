// Procurement helpers (isomorphic). A procurement bounty asks workers to recommend the best-value REAL item
// from a public priced catalog under a budget; the verifier re-fetches the live catalog to check it.
// Catalog adapter "nearai-models": NEAR AI Cloud GET /v1/models (no key needed). Prices are USD per 1M tokens.
import type { CatalogItem, ProcurementRequirements, ProcurementSpec } from "./types.ts";

/** Fetches a catalog URL and returns the raw JSON body. Injectable so tests/mock runs use a recorded fixture. */
export type CatalogSource = (url: string) => Promise<unknown>;

export const liveCatalog: CatalogSource = async (url) => {
  const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`catalog ${url} returned HTTP ${res.status}`);
  return res.json();
};

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Normalize the NEAR AI /v1/models body into CatalogItems (entries without usable prices are dropped). */
export function parseCatalog(raw: unknown): CatalogItem[] {
  const list = Array.isArray((raw as { data?: unknown })?.data) ? ((raw as { data: unknown[] }).data) : Array.isArray(raw) ? raw : [];
  const out: CatalogItem[] = [];
  for (const m of list as Record<string, any>[]) {
    if (!m || typeof m.id !== "string") continue;
    const input = num(m.pricing?.input);
    const output = num(m.pricing?.output);
    if (input === null || output === null) continue;
    out.push({
      id: m.id,
      name: typeof m.name === "string" ? m.name : null,
      // Normalize float noise from the API (e.g. 3.3000000000000003).
      pricing: { input: round6(input), output: round6(output) },
      context_length: num(m.context_length),
      supported_features: strs(m.supported_features),
      input_modalities: strs(m.input_modalities ?? m.architecture?.inputModalities),
      output_modalities: strs(m.output_modalities ?? m.architecture?.outputModalities),
    });
  }
  return out;
}

export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** USD cost of the spec's workload on this item. */
export function workloadCost(pricing: { input: number; output: number }, workload: ProcurementSpec["workload"]): number {
  return round6(pricing.input * workload.input_mtok + pricing.output * workload.output_mtok);
}

export interface RequirementCheck {
  requirement: string;
  expected: string;
  actual: string;
  passed: boolean;
}

/** Evaluate every hard requirement against a catalog item. */
export function checkRequirements(item: CatalogItem, req: ProcurementRequirements): RequirementCheck[] {
  const out: RequirementCheck[] = [];
  const has = (list: string[], want: string[]) => want.filter((w) => !list.includes(w));
  if (req.supported_features?.length) {
    const missing = has(item.supported_features, req.supported_features);
    out.push({
      requirement: "supported_features",
      expected: req.supported_features.join(", "),
      actual: item.supported_features.join(", ") || "(none)",
      passed: missing.length === 0,
    });
  }
  if (req.min_context_length !== undefined) {
    out.push({
      requirement: "min_context_length",
      expected: `>= ${req.min_context_length}`,
      actual: String(item.context_length ?? "unknown"),
      passed: item.context_length !== null && item.context_length >= req.min_context_length,
    });
  }
  if (req.input_modalities?.length) {
    out.push({
      requirement: "input_modalities",
      expected: req.input_modalities.join(", "),
      actual: item.input_modalities.join(", ") || "(none)",
      passed: has(item.input_modalities, req.input_modalities).length === 0,
    });
  }
  if (req.output_modalities?.length) {
    out.push({
      requirement: "output_modalities",
      expected: req.output_modalities.join(", "),
      actual: item.output_modalities.join(", ") || "(none)",
      passed: has(item.output_modalities, req.output_modalities).length === 0,
    });
  }
  return out;
}

export interface CompliantOption {
  item: CatalogItem;
  workload_cost_usd: number;
}

/** Items meeting every requirement and the budget, cheapest first (ties by id). */
export function compliantOptions(items: CatalogItem[], p: ProcurementSpec): CompliantOption[] {
  return items
    .filter((i) => checkRequirements(i, p.requirements).every((c) => c.passed))
    .map((item) => ({ item, workload_cost_usd: workloadCost(item.pricing, p.workload) }))
    .filter((o) => o.workload_cost_usd <= p.product_budget_usd)
    .sort((a, b) => a.workload_cost_usd - b.workload_cost_usd || a.item.id.localeCompare(b.item.id));
}

/** Quoted price matches live price within the relative tolerance (both components). */
export function priceMatches(
  quoted: { input: number; output: number },
  live: { input: number; output: number },
  tolerancePct: number,
): boolean {
  const ok = (q: number, l: number) => Math.abs(q - l) <= Math.max(1e-9, (Math.abs(l) * tolerancePct) / 100);
  return ok(quoted.input, live.input) && ok(quoted.output, live.output);
}

/** Public page for an item id in the catalog (used as source_url). */
export function itemSourceUrl(p: ProcurementSpec, id: string): string {
  return `${p.catalog_url.replace(/\/+$/, "")}#${encodeURIComponent(id)}`;
}

/** Structural validation for a procurement section; returns problems. */
export function validateProcurement(p: unknown): string[] {
  const x = p as Partial<ProcurementSpec> | null;
  const out: string[] = [];
  if (!x || typeof x !== "object") return ["procurement must be an object"];
  if (x.catalog !== "nearai-models") out.push('procurement.catalog must be "nearai-models"');
  if (typeof x.catalog_url !== "string" || !/^https:\/\//.test(x.catalog_url)) out.push("procurement.catalog_url must be https");
  if (x.currency !== "USD") out.push('procurement.currency must be "USD"');
  if (typeof x.product_budget_usd !== "number" || !(x.product_budget_usd > 0)) out.push("procurement.product_budget_usd must be > 0");
  if (!x.workload || typeof x.workload.input_mtok !== "number" || typeof x.workload.output_mtok !== "number")
    out.push("procurement.workload needs input_mtok and output_mtok numbers");
  if (!x.requirements || typeof x.requirements !== "object") out.push("procurement.requirements must be an object");
  if (typeof x.price_tolerance_pct !== "number" || x.price_tolerance_pct < 0 || x.price_tolerance_pct > 50)
    out.push("procurement.price_tolerance_pct must be 0..50");
  if (typeof x.delivery_check !== "boolean") out.push("procurement.delivery_check must be boolean");
  return out;
}
