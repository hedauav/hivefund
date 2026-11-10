import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { COLD_START_PRIOR, parseNear, scoreBids, validateSpec, type BountySpec } from "@hivefund/shared";

test("selection cold start: a worker with no history gets the neutral prior, not 0", () => {
  assert.equal(COLD_START_PRIOR, 0.5);
  const budget = parseNear("0.1").toString();
  const bids = [
    { bid_id: 1, worker: "newbie", price_yocto: parseNear("0.06").toString(), eta_ms: 1000, reputation: 0, history: 0, sig_valid: true },
    { bid_id: 2, worker: "veteran", price_yocto: parseNear("0.08").toString(), eta_ms: 1000, reputation: 30, history: 4, sig_valid: true },
    { bid_id: 3, worker: "failer", price_yocto: parseNear("0.07").toString(), eta_ms: 1000, reputation: 0, history: 2, sig_valid: true },
  ];
  const c = scoreBids(bids, budget);
  const newbie = c.find((x) => x.worker === "newbie")!;
  const failer = c.find((x) => x.worker === "failer")!;
  // newbie: reputation = 0.5 × 30 = 15 → 0.5·0.4 + 0.2·0 + 0.3·0.5 = 0.35
  assert.equal(newbie.reputation, 15);
  assert.equal(newbie.reputation_source, "cold_start_prior");
  assert.equal(newbie.score, 0.35);
  // a worker WITH history keeps its real reputation (0 here): the prior never rewards failures
  assert.equal(failer.reputation, 0);
  assert.equal(failer.reputation_source, "history");
  // veteran: 0.5·0.2 + 0 + 0.3·1 = 0.4 → still wins; the prior only makes the newcomer competitive
  assert.equal(c[0]!.worker, "veteran");
  assert.equal(c[0]!.score, 0.4);
  // callers that don't pass history keep the old behaviour
  const legacy = scoreBids(bids.map(({ history: _h, ...b }) => b), budget);
  assert.equal(legacy.find((x) => x.worker === "newbie")!.reputation, 0);
  assert.equal(legacy.find((x) => x.worker === "newbie")!.reputation_source, undefined);
  // nobody has history yet → everyone's reputation is 0 (equal footing)
  const fresh = scoreBids(bids.map((b) => ({ ...b, reputation: 0, history: 0 })), budget);
  assert.ok(fresh.every((x) => x.reputation === 0));
});

test("per-bounty selection_weights are validated (each 0..1, sum to 1)", () => {
  const spec = JSON.parse(
    fs.readFileSync(new URL("../../bounties/starter/near-glossary.json", import.meta.url), "utf8"),
  ) as BountySpec;
  assert.deepEqual(validateSpec(spec), []);
  assert.ok(validateSpec({ ...spec, selection_weights: { price: 0.9, eta: 0.2, reputation: 0.2 } }).some((p) => /sum to 1/.test(p)));
  assert.ok(validateSpec({ ...spec, selection_weights: { price: 2, eta: -1, reputation: 0 } }).some((p) => /0\.\.1/.test(p)));
});

test("procurement spec validates; bad catalog_url is rejected", () => {
  const proc = JSON.parse(
    fs.readFileSync(new URL("../../bounties/procurement/llm-for-support-agent.json", import.meta.url), "utf8"),
  ) as BountySpec;
  assert.deepEqual(validateSpec(proc), []);
  assert.equal(proc.min_tier, 1, "every tier can compete on procurement");
  assert.ok(validateSpec({ ...proc, procurement: { ...proc.procurement!, catalog_url: "http://x" } }).length > 0);
});
