// Pure-ish verification of one deliverable against its spec (no chain access). Order:
//   1) schema + required sections   2) executable test (if the spec has one)   3) rubric (only if 1 and 2 pass)
// passed = all automated checks pass AND rubric total >= pass_threshold; score = rubric total (0 if no rubric ran).
import { hashJson } from "@hivefund/shared";
import type { BountySpec, CatalogSource, CheckResult, Deliverable, ProcurementEvidence, VerificationReport } from "@hivefund/shared";
import { checkCatalog, checkDelivery, procurementContext, valueScore, type DeliveryProbe } from "./procurement.ts";
import type { RubricExtras } from "./rubric.ts";
import { DEFAULT_BOUNTIES_DIR, type LlmClient } from "@hivefund/worker-core";
import { checkSchema, checkSections, checkTest, type Clock } from "./checks.ts";
import { scoreRubric } from "./rubric.ts";

export interface VerifyOptions {
  /** verifier account id recorded in the report */
  verifier: string;
  /** NEAR AI client; null => deterministic fallback rubric (recorded as mode "fallback") */
  llm?: LlmClient | null;
  bountiesDir?: string;
  /** clock for created_ms and durations (inject a constant clock for reproducible report hashes) */
  now?: Clock;
  specHash?: string;
  deliverableHash?: string;
  /** override (e.g. when the deliverable could not be loaded) */
  worker?: string;
  /** procurement: catalog fetcher (default: live fetch of spec.procurement.catalog_url) */
  catalog?: CatalogSource;
  /** procurement: one-call delivery probe for the chosen model; null/undefined => delivery check skipped */
  delivery?: DeliveryProbe | null;
}

export async function verify(spec: BountySpec, deliverable: Deliverable, o: VerifyOptions): Promise<VerificationReport> {
  const now = o.now ?? Date.now;
  const checks: CheckResult[] = [];
  checks.push(checkSchema(spec, deliverable, now));
  checks.push(checkSections(spec, deliverable, now));
  checks.push(await checkTest(spec, deliverable, o.bountiesDir ?? DEFAULT_BOUNTIES_DIR, now));

  // Procurement: live catalog check, then (only if everything so far passed) one real delivery call.
  let evidence: ProcurementEvidence | undefined;
  const extras: RubricExtras = {};
  if (spec.procurement) {
    const c = await checkCatalog(spec.procurement, deliverable, o.catalog, now);
    evidence = c.evidence;
    checks.push(c.check);
    if (c.item && checks.every((x) => x.passed)) {
      checks.push(await checkDelivery(spec.procurement, c.item, o.delivery ?? null, c.evidence, now));
    } else {
      checks.push({ id: "delivery", passed: true, skipped: true, details: "skipped: earlier checks failed", duration_ms: 0 });
    }
    extras.context = procurementContext(spec.procurement, c.options, c.evidence);
    const v = valueScore(c.evidence);
    if (v !== null) {
      extras.fallbackOverrides = {
        value: { score: v, rationale: `fallback: 100*sqrt(cheapest compliant ${c.evidence.cheapest_compliant?.workload_cost_usd} / chosen ${c.evidence.live_workload_cost_usd})` },
      };
    }
  }
  const automatedPass = checks.every((c) => c.passed);

  let rubric: VerificationReport["rubric"] = null;
  if (automatedPass) {
    const t0 = now();
    const r = await scoreRubric(spec, deliverable, o.llm ?? null, extras);
    rubric = { mode: r.mode, model: r.model, scores: r.scores, total: r.total, threshold: r.threshold };
    checks.push({
      id: "rubric",
      passed: r.total >= r.threshold,
      details:
        `${r.mode === "llm" ? `NEAR AI ${r.model}` : "deterministic fallback"}: weighted total ${r.total} vs threshold ${r.threshold}` +
        (r.llm_error ? ` (LLM failed: ${r.llm_error})` : ""),
      duration_ms: now() - t0,
    });
  } else {
    checks.push({ id: "rubric", passed: false, skipped: true, details: "skipped: automated checks failed", duration_ms: 0 });
  }

  const passed = automatedPass && rubric !== null && rubric.total >= rubric.threshold && rubric.total > 0;
  return {
    bounty_id: deliverable.bounty_id,
    round: deliverable.round,
    worker: o.worker ?? deliverable.worker,
    spec_hash: o.specHash ?? hashJson(spec),
    deliverable_hash: o.deliverableHash ?? hashJson(deliverable),
    checks,
    rubric,
    passed,
    score: rubric ? rubric.total : 0,
    verifier: o.verifier,
    created_ms: now(),
    ...(evidence ? { procurement: evidence } : {}),
  };
}
