import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hashJson } from "@hivefund/shared";
import type { BountySpec, Deliverable } from "@hivefund/shared";
import { generateDeliverable, TEMPLATES } from "@hivefund/worker-core";
import { Verifier, verify } from "../src/index.ts";
import { BOUNTIES_DIR, FakeMarket, FakeStore, loadSpec } from "../../worker-core/test/fakes.ts";

const slugify = loadSpec("slugify.json");
const checklist = loadSpec("subaccount-checklist.json");
const fixed = () => 1_700_000_000_000;

function deliverable(spec: BountySpec, quality: "low" | "medium" | "high"): Deliverable {
  const id = spec.deliverable_schema.$id as string;
  const out = TEMPLATES[id]!(quality);
  return { bounty_id: 0, round: 0, worker: `${quality}.test`, ...out };
}

const opts = { verifier: "verifier.test", llm: null, bountiesDir: BOUNTIES_DIR, now: fixed };
const check = (r: { checks: { id: string; passed: boolean }[] }, id: string) => r.checks.find((c) => c.id === id)!;

describe("slugify bounty (executable acceptance test)", () => {
  it("fails a low-effort implementation on the real test run", async () => {
    const r = await verify(slugify, deliverable(slugify, "low"), opts);
    assert.equal(check(r, "schema").passed, true);
    assert.equal(check(r, "sections").passed, true);
    assert.equal(check(r, "test").passed, false);
    assert.match(r.checks.find((c) => c.id === "test")!.details, /FAIL slugify/);
    assert.equal(r.rubric, null, "rubric only runs after automated checks pass");
    assert.equal(r.passed, false);
    assert.equal(r.score, 0);
  });

  it("fails a medium implementation that has no unicode handling", async () => {
    const r = await verify(slugify, deliverable(slugify, "medium"), opts);
    assert.equal(check(r, "test").passed, false);
    assert.match(r.checks.find((c) => c.id === "test")!.details, /Héllo/);
  });

  it("passes a high-quality implementation (test + fallback rubric)", async () => {
    const r = await verify(slugify, deliverable(slugify, "high"), opts);
    assert.equal(check(r, "test").passed, true, r.checks.find((c) => c.id === "test")!.details);
    assert.equal(r.rubric!.mode, "fallback");
    assert.ok(r.rubric!.total >= slugify.rubric.pass_threshold, `rubric ${r.rubric!.total}`);
    assert.equal(r.passed, true);
    assert.equal(r.score, r.rubric!.total);
  });

  it("produces an identical report hash for identical input without an LLM key", async () => {
    const d = deliverable(slugify, "high");
    const a = await verify(slugify, d, opts);
    const b = await verify(slugify, d, opts);
    assert.equal(hashJson(a), hashJson(b));
    const f1 = await verify(slugify, deliverable(slugify, "low"), opts);
    const f2 = await verify(slugify, deliverable(slugify, "low"), opts);
    assert.equal(hashJson(f1), hashJson(f2));
  });
});

describe("test runner sandboxing", () => {
  const d = deliverable(slugify, "high");
  for (const [label, test] of [
    ["parent traversal", { runner: "node", file: "../package.json", timeout_ms: 5000 }],
    ["absolute path", { runner: "node", file: process.execPath, timeout_ms: 5000 }],
    ["nested traversal", { runner: "node", file: "tests/../../agents/verifier/src/index.ts", timeout_ms: 5000 }],
    ["non-node runner", { runner: "bash", file: "tests/slugify.test.mjs", timeout_ms: 5000 }],
  ] as const) {
    it(`refuses ${label}`, async () => {
      const spec = { ...slugify, test: test as unknown as BountySpec["test"] };
      const r = await verify(spec, d, opts);
      const t = r.checks.find((c) => c.id === "test")!;
      assert.equal(t.passed, false);
      assert.match(t.details, /refused/);
      assert.equal(r.passed, false);
    });
  }

  it("refuses unsafe deliverable file names", async () => {
    const bad = { ...d, code: { "../escape.mjs": "export const x = 1" } };
    const t = (await verify(slugify, bad, opts)).checks.find((c) => c.id === "test")!;
    assert.equal(t.passed, false);
    assert.match(t.details, /bad code file name/);
  });

  it("times out runaway code", async () => {
    const spec = { ...slugify, test: { runner: "node" as const, file: "tests/slugify.test.mjs", timeout_ms: 1000 } };
    const hang = { ...d, code: { "slugify.mjs": "while (true) {}\nexport function slugify(s) { return s }" } };
    const t = (await verify(spec, hang, opts)).checks.find((c) => c.id === "test")!;
    assert.equal(t.passed, false);
    assert.match(t.details, /timed out/);
  });
});

describe("checklist bounty (rubric only)", () => {
  it("fails the schema for a 3-item checklist", async () => {
    const r = await verify(checklist, deliverable(checklist, "low"), opts);
    assert.equal(check(r, "schema").passed, false);
    assert.equal(r.passed, false);
  });

  it("passes a thorough checklist and fails a shallow one on the rubric", async () => {
    const hi = await verify(checklist, deliverable(checklist, "high"), opts);
    assert.equal(hi.checks.find((c) => c.id === "test")!.skipped, true);
    assert.equal(hi.passed, true, `rubric ${hi.rubric?.total}`);
    const mid = await verify(checklist, deliverable(checklist, "medium"), opts);
    assert.equal(check(mid, "schema").passed, true);
    assert.ok(mid.rubric!.total < hi.rubric!.total);
    assert.equal(mid.passed, false, `medium rubric ${mid.rubric?.total} should be below ${checklist.rubric.pass_threshold}`);
  });
});

describe("LLM rubric", () => {
  it("records mode llm and the model when the LLM answers", async () => {
    const llm = {
      model: "z-ai/glm-5.3-flash",
      chat: async () => ({
        scores: [
          { criterion: "approach", score: 90, rationale: "clear" },
          { criterion: "edge_cases", score: 70, rationale: "ok" },
        ],
      }),
    };
    const r = await verify(slugify, deliverable(slugify, "high"), { ...opts, llm });
    assert.equal(r.rubric!.mode, "llm");
    assert.equal(r.rubric!.model, "z-ai/glm-5.3-flash");
    assert.equal(r.rubric!.total, 82); // 0.6*90 + 0.4*70
    assert.equal(r.passed, true);
  });

  it("falls back honestly when the LLM fails", async () => {
    const llm = {
      model: "z-ai/glm-5.3-flash",
      chat: async () => {
        throw new Error("NEAR AI HTTP 500");
      },
    };
    const r = await verify(slugify, deliverable(slugify, "high"), { ...opts, llm });
    assert.equal(r.rubric!.mode, "fallback");
    assert.match(r.checks.find((c) => c.id === "rubric")!.details, /LLM failed: NEAR AI HTTP 500/);
  });
});

describe("Verifier agent", () => {
  it("verifies Verifying bounties once and records the report hash on-chain", async () => {
    const m = new FakeMarket();
    const store = new FakeStore();
    const specHash = store.put(slugify, { kind: "spec", actor: "c" });
    m.addBounty(specHash, slugify.budget_yocto, 1);
    await m.client("worker.test").call("place_bid", { bounty_id: 0, price_yocto: "1", eta_ms: 1, signature: "x" });
    m.select(0, 0);
    const g = await generateDeliverable(slugify, { bountyId: 0, round: 0, worker: "worker.test", quality: "high", llm: null });
    const dh = store.put(g.deliverable, { kind: "deliverable", actor: "worker.test" });
    await m.client("worker.test").call("submit_work", { bounty_id: 0, deliverable_hash: dh });

    const v = new Verifier({ accountId: "verifier.test", llm: null, now: fixed });
    const out = await v.tick(m.client("verifier.test"), store);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.passed, true);
    const call = m.calls.find((c) => c.method === "verify_bounty")!;
    assert.equal(call.caller, "verifier.test");
    assert.equal(call.gasTGas, 60);
    assert.equal(call.args.check_results_hash, out[0]!.check_results_hash);
    const report = store.get(call.args.check_results_hash) as any;
    assert.equal(hashJson(report), call.args.check_results_hash);
    assert.equal(report.deliverable_hash, dh);
    assert.equal(report.spec_hash, specHash);
    assert.equal(report.worker, "worker.test");
    assert.equal((await v.tick(m.client("verifier.test"), store)).length, 0, "not re-verified");
  });

  it("fails a deliverable whose hash cannot be loaded", async () => {
    const m = new FakeMarket();
    const store = new FakeStore();
    m.addBounty(store.put(slugify, { kind: "spec", actor: "c" }), slugify.budget_yocto, 1, {
      status: "Verifying",
      deliverable_hash: "0".repeat(64),
    });
    const out = await new Verifier({ accountId: "verifier.test", llm: null }).tick(m.client("verifier.test"), store);
    assert.equal(out[0]!.passed, false);
    assert.equal(out[0]!.score, 0);
  });
});
