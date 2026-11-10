import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bidPayload, bidPublicKey, newBidKey, verifyBid } from "@hivefund/shared";
import type { Outcome } from "@hivefund/shared";
import { AdaptiveStrategy, Worker, generateDeliverable, quote, type WorkerProfile } from "../src/index.ts";
import { FakeMarket, FakeStore, loadSpec } from "./fakes.ts";

const CHEAP: WorkerProfile = { name: "cheap", tier: 1, margin: 0.05, speed: 1.6, quality: "low" };
const QUALITY: WorkerProfile = { name: "quality", tier: 3, margin: 0.35, speed: 0.7, quality: "high" };
const ADAPTIVE: WorkerProfile = {
  name: "adaptive",
  tier: 2,
  margin: 0.2,
  speed: 1,
  quality: "medium",
  adaptive: { minMargin: 0.05, maxMargin: 0.5 },
};
const HUB = "hub.hivefund-2026.testnet";

function mkWorker(name: string, profile: WorkerProfile, extra: Partial<ConstructorParameters<typeof Worker>[0]> = {}) {
  const bidKey = newBidKey();
  const w = new Worker({ accountId: `${name}.test`, contract: HUB, bidKey, profile, llm: null, ...extra });
  return { w, bidKey };
}

describe("pricing at small budgets", () => {
  it("prices 0.1 NEAR and 0.05 NEAR bounties without rounding to zero or exceeding budget", () => {
    for (const [file, budget] of [
      ["slugify.json", 100000000000000000000000n],
      ["subaccount-checklist.json", 50000000000000000000000n],
    ] as const) {
      const spec = loadSpec(file);
      assert.equal(BigInt(spec.budget_yocto), budget);
      for (const p of [CHEAP, QUALITY, ADAPTIVE]) {
        const q = quote(spec, budget, p.margin, p.quality, p.speed);
        assert.ok(q.price > 0n, `${p.name} price > 0`);
        assert.ok(q.price <= budget, `${p.name} price <= budget`);
        assert.ok(q.expectedProfit >= 0n, `${p.name} profitable`);
        assert.ok(q.price / 10n ** 21n > 0n, "at least 1 milliNEAR so HIVE mint units are non-zero");
      }
    }
  });
});

describe("worker bid decisions", () => {
  it("places a correctly signed bid and does not bid twice in a round", async () => {
    const m = new FakeMarket();
    const store = new FakeStore();
    const spec = loadSpec("slugify.json");
    m.addBounty(store.put(spec, { kind: "spec", actor: "c" }), spec.budget_yocto, 1);
    const { w, bidKey } = mkWorker("cheap", CHEAP);
    const r1 = await w.tick(m.client(w.accountId), store);
    assert.equal(r1.bids.length, 1);
    const bid = m.bids[0]!;
    const payload = bidPayload({
      bounty_id: 0,
      contract: HUB,
      eta_ms: bid.eta_ms,
      price_yocto: bid.price_yocto,
      round: 0,
      worker: w.accountId,
    });
    assert.ok(verifyBid(payload, bid.signature, bidPublicKey(bidKey)));
    const r2 = await w.tick(m.client(w.accountId), store);
    assert.equal(r2.bids.length, 0);
    assert.equal(m.bids.length, 1);
  });

  it("skips bounties below its tier", async () => {
    const m = new FakeMarket();
    const store = new FakeStore();
    const spec = loadSpec("subaccount-checklist.json");
    m.addBounty(store.put(spec, { kind: "spec", actor: "c" }), spec.budget_yocto, spec.min_tier);
    const { w } = mkWorker("cheap", CHEAP);
    const r = await w.tick(m.client(w.accountId), store);
    assert.equal(r.bids.length, 0);
    assert.match(r.skips[0]!.reason, /tier 1 below min_tier 2/);
  });

  it("skips bounties it would have to price over budget", async () => {
    const m = new FakeMarket();
    const store = new FakeStore();
    const spec = loadSpec("slugify.json");
    m.addBounty(store.put(spec, { kind: "spec", actor: "c" }), "1000", 1);
    // This worker has a real compute floor of 0.001 NEAR per job, far above a 1000-yocto budget.
    const { w } = mkWorker("cheap", CHEAP, { minCostYocto: 10n ** 21n });
    const r = await w.tick(m.client(w.accountId), store);
    assert.equal(r.bids.length, 0);
    assert.equal(r.skips[0]!.reason, "price would exceed budget");
  });

  it("skips expired and excluded bounties, and bounties it cannot produce without an LLM", async () => {
    const m = new FakeMarket();
    const store = new FakeStore();
    const spec = loadSpec("slugify.json");
    const h = store.put(spec, { kind: "spec", actor: "c" });
    m.addBounty(h, spec.budget_yocto, 1, { deadline_ms: 1 });
    m.addBounty(h, spec.budget_yocto, 1, { excluded: ["quality.test"] });
    const unknown = { ...spec, deliverable_schema: { ...spec.deliverable_schema, $id: "hivefund:unknown" } };
    m.addBounty(store.put(unknown, { kind: "spec", actor: "c" }), spec.budget_yocto, 1);
    const { w } = mkWorker("quality", QUALITY);
    const r = await w.tick(m.client(w.accountId), store);
    assert.equal(r.bids.length, 0);
    assert.deepEqual(
      r.skips.map((s) => s.reason),
      ["deadline passed", "excluded after failed delivery", "cannot produce this deliverable type without an LLM"],
    );
  });

  it("delivers work after winning and learns from outcomes", async () => {
    const m = new FakeMarket();
    const store = new FakeStore();
    const spec = loadSpec("slugify.json");
    m.addBounty(store.put(spec, { kind: "spec", actor: "c" }), spec.budget_yocto, 1);
    const a = mkWorker("adaptive", ADAPTIVE).w;
    const c = mkWorker("cheap", CHEAP).w;
    await a.tick(m.client(a.accountId), store);
    await c.tick(m.client(c.accountId), store);
    assert.equal(m.bids.length, 2);
    m.select(0, m.bids.find((b) => b.worker === a.accountId)!.id);

    const r = await a.tick(m.client(a.accountId), store);
    assert.deepEqual(r.outcomes.map((o) => o.outcome), ["win"]);
    assert.equal(r.strategyChanges.length, 1);
    assert.equal(a.strategy.margin, 0.25);
    assert.equal(r.submissions.length, 1);
    assert.equal(r.submissions[0]!.mode, "template");
    const sub = m.calls.find((x) => x.method === "submit_work")!;
    assert.equal(sub.caller, a.accountId);
    const d = store.get(sub.args.deliverable_hash) as any;
    assert.equal(d.worker, a.accountId);
    assert.ok(d.code["slugify.mjs"].includes("function slugify"));

    const rc = await c.tick(m.client(c.accountId), store);
    assert.deepEqual(rc.outcomes.map((o) => o.outcome), ["loss"]);
    assert.equal(rc.strategyChanges.length, 0, "static workers never change strategy");
    assert.equal(store.strategy.length, 1);
    assert.equal(store.strategy[0]!.worker, a.accountId);
  });
});

describe("adaptive strategy", () => {
  it("stays within bounds over 20 outcomes and logs every change with a reason", () => {
    const s = new AdaptiveStrategy({
      worker: "adaptive.test",
      initialMargin: 0.2,
      minMargin: 0.05,
      maxMargin: 0.5,
      initialQuality: "medium",
      now: () => 0,
    });
    // Deterministic pseudo-random sequence (LCG) of outcomes.
    let seed = 42;
    const seq: Outcome[] = [];
    for (let i = 0; i < 20; i++) {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      seq.push((["win", "loss", "loss", "fail"] as Outcome[])[seed % 4]!);
    }
    // Force both bounds to be hit.
    seq.push(...Array<Outcome>(8).fill("win"), ...Array<Outcome>(12).fill("loss"));

    let observed = 0;
    let logged = 0;
    for (const [i, o] of seq.entries()) {
      const beforeM = s.margin;
      const beforeQ = s.quality;
      const changes = s.onOutcome(o, i);
      if (s.margin !== beforeM || s.quality !== beforeQ) observed++;
      logged += changes.length;
      assert.ok(s.margin >= 0.05 && s.margin <= 0.5, `margin ${s.margin} in bounds`);
      assert.ok(s.window.length <= 5);
      for (const c of changes) {
        assert.ok(c.reason.length > 10);
        assert.equal(c.new_margin, s.margin);
        assert.equal(c.old_margin, beforeM);
        assert.ok(c.window.length <= 5);
      }
    }
    assert.equal(logged, observed, "every observed change has a log entry");
    assert.equal(s.margin, 0.05);
    assert.equal(s.quality, "high");
  });

  it("raises its margin to break-even instead of bidding at a loss", () => {
    const s = new AdaptiveStrategy({
      worker: "adaptive.test",
      initialMargin: 0.05,
      minMargin: 0.05,
      maxMargin: 0.5,
      initialQuality: "high",
    });
    const c = s.onUnprofitable(3);
    assert.ok(c);
    assert.equal(s.margin, 0.25);
    assert.match(c!.reason, /break-even/);
  });
});

describe("deliverable generation", () => {
  it("submits an honest failed deliverable (not template code) when the configured LLM fails", async () => {
    const spec = loadSpec("slugify.json");
    const llm = {
      model: "test-model",
      chat: async () => {
        throw new Error("HTTP 503");
      },
    };
    const g = await generateDeliverable(spec, { bountyId: 1, round: 0, worker: "w.test", quality: "high", llm });
    assert.equal(g.mode, "failed");
    assert.equal(g.deliverable.generator.mode, "failed");
    assert.equal(g.deliverable.generator.model, "test-model");
    assert.equal(g.deliverable.code, undefined);
    assert.match(g.note!, /HTTP 503/);
  });

  it("uses LLM output when valid, with effort scaled by quality", async () => {
    const spec = loadSpec("slugify.json");
    const seen: number[] = [];
    let sawTest = false;
    const llm = {
      model: "test-model",
      chat: async (messages: { content: string }[], opts?: { maxTokens?: number }) => {
        seen.push(opts?.maxTokens ?? 0);
        sawTest ||= messages.some((m) => m.content.includes("const cases"));
        return {
          sections: { approach: "a", edge_cases: "b" },
          data: { function_name: "slugify", file: "slugify.mjs", examples: [] },
          code: {
            "slugify.mjs": "export function slugify(s) {\n  return String(s).toLowerCase();\n}\n",
            "../evil.mjs": "x",
          },
        };
      },
    };
    const low = await generateDeliverable(spec, { bountyId: 1, round: 0, worker: "w", quality: "low", llm });
    assert.equal(low.mode, "llm");
    assert.equal(sawTest, false, "low-effort worker does not read the acceptance test");
    const high = await generateDeliverable(spec, { bountyId: 1, round: 0, worker: "w", quality: "high", llm });
    assert.equal(sawTest, true, "high-effort worker reads the acceptance test");
    assert.ok(seen[1]! > seen[0]!);
    assert.deepEqual(Object.keys(high.deliverable.code!), ["slugify.mjs"], "unsafe file names dropped");
  });
});
