// Procurement verification against the RECORDED snapshot of the real NEAR AI catalog
// (bounties/procurement/fixtures/nearai-models.recorded.json). One live test runs only with HIVEFUND_LIVE_CATALOG=1.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { compliantOptions, parseCatalog, workloadCost } from "@hivefund/shared";
import type { BountySpec, CatalogSource, Deliverable, VerificationReport } from "@hivefund/shared";
import { generateDeliverable } from "@hivefund/worker-core";
import { valueScore, verify, type DeliveryProbe } from "../src/index.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const spec = JSON.parse(fs.readFileSync(path.join(root, "bounties/procurement/llm-for-support-agent.json"), "utf8")) as BountySpec;
const raw = JSON.parse(fs.readFileSync(path.join(root, "bounties/procurement/fixtures/nearai-models.recorded.json"), "utf8"));
const recorded: CatalogSource = async () => raw;
const items = parseCatalog(raw);
const p = spec.procurement!;
const fixed = () => 1_700_000_000_000;
const opts = { verifier: "verifier.test", llm: null, now: fixed, catalog: recorded };
const check = (r: VerificationReport, id: string) => r.checks.find((c) => c.id === id)!;

function proposal(item_id: string, pricing?: { input: number; output: number }): Deliverable {
  const item = items.find((i) => i.id === item_id);
  const quoted = pricing ?? item!.pricing;
  return {
    bounty_id: 0,
    round: 0,
    worker: "w.test",
    sections: {
      summary: `Recommend ${item_id} for the support agent workload.`,
      comparison: "Compared tool-calling, structured-output models with long context by live workload cost.",
      recommendation: `Use ${item_id}; it supports tools and structured outputs with a long context for chat histories.`,
    },
    data: {
      item_id,
      source_url: `${p.catalog_url}#${encodeURIComponent(item_id)}`,
      quoted_pricing: quoted,
      quoted_workload_cost_usd: workloadCost(quoted, p.workload),
      catalog_fetched_at_ms: fixed(),
      considered_count: items.length,
      alternatives: [],
      justification: `${item_id} meets every hard requirement and is good value for the stated workload and budget.`,
    },
  };
}

const options = compliantOptions(items, p);
const cheapest = options[0]!.item.id;

describe("procurement verification (recorded real catalog)", () => {
  it("the recorded catalog has several compliant options under budget", () => {
    assert.ok(items.length > 20);
    assert.ok(options.length >= 3);
    assert.ok(options.every((o) => o.workload_cost_usd <= p.product_budget_usd));
  });

  it("accepts a valid pick: found, price matches, within budget, every requirement met", async () => {
    const r = await verify(spec, proposal(cheapest), opts);
    assert.equal(check(r, "catalog").passed, true, check(r, "catalog").details);
    assert.equal(check(r, "delivery").skipped, true, "no probe => delivery skipped");
    const ev = r.procurement!;
    assert.equal(ev.found, true);
    assert.equal(ev.price_match, true);
    assert.equal(ev.within_budget, true);
    assert.equal(ev.requirement_checks.length, 4);
    assert.ok(ev.requirement_checks.every((c) => c.passed));
    assert.equal(ev.cheapest_compliant!.id, cheapest);
    assert.equal(r.rubric!.scores.find((s) => s.criterion === "value")!.score, 100, "cheapest compliant => value 100 (fallback)");
    assert.equal(r.passed, r.score >= spec.rubric.pass_threshold);
  });

  it("rejects an over-budget pick", async () => {
    const pricey = items.find((i) => workloadCost(i.pricing, p.workload) > p.product_budget_usd && i.supported_features.includes("tools"))!;
    const r = await verify(spec, proposal(pricey.id), opts);
    assert.equal(check(r, "catalog").passed, false);
    assert.equal(r.procurement!.within_budget, false);
    assert.match(check(r, "catalog").details, /exceeds budget/);
    assert.equal(r.rubric, null);
    assert.equal(r.passed, false);
  });

  it("rejects a price that does not match the live catalog", async () => {
    const item = items.find((i) => i.id === cheapest)!;
    const r = await verify(spec, proposal(cheapest, { input: item.pricing.input * 0.5, output: item.pricing.output }), opts);
    assert.equal(check(r, "catalog").passed, false);
    assert.equal(r.procurement!.price_match, false);
    assert.match(check(r, "catalog").details, /does not match live/);
  });

  it("rejects a pick that misses a hard requirement", async () => {
    const noTools = items.find((i) => !i.supported_features.includes("tools") && workloadCost(i.pricing, p.workload) <= p.product_budget_usd)!;
    const r = await verify(spec, proposal(noTools.id), opts);
    assert.equal(check(r, "catalog").passed, false);
    assert.ok(r.procurement!.requirement_checks.some((c) => c.requirement === "supported_features" && !c.passed));
  });

  it("rejects an item that is not in the catalog", async () => {
    const d = proposal(cheapest);
    (d.data as { item_id: string }).item_id = "made-up/model-9000";
    const r = await verify(spec, d, opts);
    assert.equal(r.procurement!.found, false);
    assert.equal(check(r, "catalog").passed, false);
  });

  it("delivery check records the probe result and its cost at live prices; a failed call fails verification", async () => {
    const probe: DeliveryProbe = async () => ({ ok: true, http_status: 200, prompt_tokens: 20, completion_tokens: 2, details: "HTTP 200" });
    const r = await verify(spec, proposal(cheapest), { ...opts, delivery: probe });
    assert.equal(check(r, "delivery").passed, true);
    const it0 = items.find((i) => i.id === cheapest)!;
    assert.equal(r.procurement!.delivery!.cost_usd, Math.round(((20 * it0.pricing.input + 2 * it0.pricing.output) / 1e6) * 1e6) / 1e6);
    const bad: DeliveryProbe = async () => ({ ok: false, http_status: 404, prompt_tokens: null, completion_tokens: null, details: "HTTP 404" });
    const r2 = await verify(spec, proposal(cheapest), { ...opts, delivery: bad });
    assert.equal(check(r2, "delivery").passed, false);
    assert.equal(r2.passed, false);
  });

  it("value score: 100·sqrt(cheapest/chosen)", () => {
    assert.equal(valueScore({ cheapest_compliant: { id: "a", workload_cost_usd: 0.5 }, live_workload_cost_usd: 2 } as never), 50);
  });

  it("simulation workers scan to different depths and both picks verify", async () => {
    const mk = (quality: "low" | "high") =>
      generateDeliverable(spec, { bountyId: 0, round: 0, worker: `${quality}.test`, quality, llm: null, catalog: recorded, now: fixed });
    const low = await mk("low");
    const high = await mk("high");
    assert.equal(low.mode, "template");
    assert.equal((low.deliverable.data as { considered_count: number }).considered_count, 12);
    assert.equal((high.deliverable.data as { considered_count: number }).considered_count, items.length);
    for (const g of [low, high]) {
      const r = await verify(spec, g.deliverable, opts);
      assert.equal(check(r, "catalog").passed, true, check(r, "catalog").details);
    }
  });

  it("LIVE catalog: the cheapest live compliant pick verifies", { skip: process.env.HIVEFUND_LIVE_CATALOG !== "1" }, async () => {
    const live = parseCatalog(await (await fetch(p.catalog_url)).json());
    const best = compliantOptions(live, p)[0]!;
    const r = await verify(spec, proposal(best.item.id, best.item.pricing), { verifier: "verifier.test", llm: null, now: fixed });
    assert.equal(check(r, "catalog").passed, true, check(r, "catalog").details);
  });
});
