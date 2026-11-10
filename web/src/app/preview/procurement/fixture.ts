// FIXTURE for the procurement preview page only. Illustrative values shaped exactly like the real
// off-chain objects (docs/notes/procurement.md); never shown on the dashboard, never presented as live.
import type { Deliverable, ProcurementSpec, VerificationReport } from "@hivefund/shared";

export const FIXTURE_SPEC: ProcurementSpec = {
  catalog: "nearai-models",
  catalog_url: "https://cloud-api.near.ai/v1/models",
  currency: "USD",
  product_budget_usd: 3,
  workload: { input_mtok: 3, output_mtok: 1 },
  requirements: {
    supported_features: ["tools", "structured_outputs"],
    min_context_length: 200000,
    input_modalities: ["text"],
    output_modalities: ["text"],
  },
  price_tolerance_pct: 1,
  delivery_check: true,
};

const T = Date.UTC(2026, 10, 11, 9, 30);

export const FIXTURE_DELIVERABLE: Deliverable = {
  bounty_id: 4,
  round: 0,
  worker: "quality.hivefund-2026.testnet",
  sections: { summary: "…", comparison: "…", recommendation: "…" },
  data: {
    item_id: "openai/gpt-5-nano",
    source_url: "https://cloud-api.near.ai/v1/models#openai%2Fgpt-5-nano",
    quoted_pricing: { input: 0.05, output: 0.4 },
    quoted_workload_cost_usd: 0.55,
    catalog_fetched_at_ms: T,
    considered_count: 64,
    alternatives: [
      { item_id: "google/gemini-2.5-flash-lite", workload_cost_usd: 0.7 },
      { item_id: "openai/gpt-4.1-mini", workload_cost_usd: 2.8 },
    ],
    justification: "Cheapest item that meets every hard requirement; long context and tool use cover the support-agent workload.",
  },
  generator: { mode: "llm", model: "deepseek/deepseek-v3.2" },
};

const ev = {
  catalog_url: "https://cloud-api.near.ai/v1/models",
  fetched_at_ms: T + 95_000,
  catalog_size: 64,
  item_id: "openai/gpt-5-nano",
  found: true,
  quoted_pricing: { input: 0.05, output: 0.4 },
  live_pricing: { input: 0.05, output: 0.4 },
  price_match: true,
  quoted_workload_cost_usd: 0.55,
  live_workload_cost_usd: 0.55,
  budget_usd: 3,
  within_budget: true,
  requirement_checks: [
    { requirement: "supported_features", expected: "tools, structured_outputs", actual: "tools, structured_outputs, json_mode", passed: true },
    { requirement: "min_context_length", expected: ">= 200000", actual: "400000", passed: true },
    { requirement: "input_modalities", expected: "text", actual: "text, image", passed: true },
    { requirement: "output_modalities", expected: "text", actual: "text", passed: true },
  ],
  compliant_count: 9,
  cheapest_compliant: { id: "openai/gpt-5-nano", workload_cost_usd: 0.55 },
  delivery: { model: "openai/gpt-5-nano", ok: true, http_status: 200, prompt_tokens: 14, completion_tokens: 3, cost_usd: 0.000002, details: "returned usage" },
} satisfies VerificationReport["procurement"];

export const FIXTURE_REPORT_PASS: VerificationReport = {
  bounty_id: 4,
  round: 0,
  worker: "quality.hivefund-2026.testnet",
  spec_hash: "0".repeat(64),
  deliverable_hash: "1".repeat(64),
  checks: [
    { id: "schema", passed: true, details: "data matches hivefund:procurement-v1", duration_ms: 3 },
    { id: "sections", passed: true, details: "summary, comparison, recommendation present", duration_ms: 1 },
    { id: "test", passed: true, skipped: true, details: "procurement specs have no test command", duration_ms: 0 },
    { id: "catalog", passed: true, details: "found; price within 1%; $0.55 ≤ $3; 4/4 requirements", duration_ms: 410 },
    { id: "delivery", passed: true, details: "1 real call, HTTP 200", duration_ms: 900 },
    { id: "rubric", passed: true, details: "total 88 ≥ 70", duration_ms: 2100 },
  ],
  rubric: {
    mode: "llm",
    model: "z-ai/glm-5.3-flash",
    scores: [
      { criterion: "value", score: 95, rationale: "Cheapest compliant option in the live catalog." },
      { criterion: "fit", score: 80, rationale: "Small model; adequate for support answers." },
      { criterion: "justification", score: 85, rationale: "Comparison cites live prices." },
    ],
    total: 88,
    threshold: 70,
  },
  passed: true,
  score: 88,
  verifier: "verifier.hivefund-2026.testnet",
  created_ms: T + 120_000,
  procurement: ev,
};

export const FIXTURE_REPORT_FAIL: VerificationReport = {
  ...FIXTURE_REPORT_PASS,
  round: 1,
  worker: "cheap.hivefund-2026.testnet",
  checks: FIXTURE_REPORT_PASS.checks.map((c) =>
    c.id === "catalog"
      ? { ...c, passed: false, details: "quoted price differs from live by more than 1%; context 128000 < 200000" }
      : c.id === "delivery" || c.id === "rubric"
        ? { ...c, passed: false, skipped: true, details: "not run: an automated check failed" }
        : c,
  ),
  rubric: null,
  passed: false,
  score: 0,
  procurement: {
    ...ev,
    item_id: "google/gemini-2.5-flash-lite",
    quoted_pricing: { input: 0.08, output: 0.3 },
    live_pricing: { input: 0.1, output: 0.4 },
    price_match: false,
    quoted_workload_cost_usd: 0.54,
    live_workload_cost_usd: 0.7,
    requirement_checks: ev.requirement_checks.map((r) => (r.requirement === "min_context_length" ? { ...r, actual: "128000", passed: false } : r)),
    delivery: null,
  },
};
