// End-to-end: coordinator + the real Stream C workers and verifier + the forger, through the full
// bounty lifecycle. The mock run is the offline regression test; the testnet run is the real thing and
// executes when HIVEFUND_E2E_TESTNET=1 and config/deployment.testnet.json exists.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createMockMarket,
  createTestnetMarket,
  loadDeployment,
  loadEnv,
  openStore,
  readChainState,
  type ChainState,
} from "@hivefund/shared/node";
import { runMarket } from "@hivefund/coordinator";
import { checkRunInvariants } from "../lib/invariants.ts";

test("e2e (mock): post, 3 honest workers + forger, forgery rejected, fail -> reopen -> rebid -> pass, payout, mint", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hivefund-e2e-"));
  try {
    const market = await createMockMarket({ store: openStore(dir), logSink: () => {} });
    const before: ChainState = await readChainState(market.coordinator.hub, market.token, "mock");
    const run = await runMarket(market, { maxSteps: 8, log: () => {} });
    const after = await readChainState(market.coordinator.hub, market.token, "mock");
    assert.ok(run.allTerminal, "all bounties terminal");
    assert.equal(run.postedIds.length, 2, "both fixtures posted");

    // three honest workers bid (cheap is tier 1, so it only bids on the tier-1 bounty)
    const honest = new Set(Object.values(after.bids).flat().filter((b) => b.round === 0 && !b.worker.startsWith("forger")).map((b) => b.worker));
    assert.equal(honest.size, 3, "cheap, quality and adaptive all bid");

    const r = checkRunInvariants(before, after, run.postedIds, market.forger.accountId);
    assert.ok(r.forgedRejected >= 1, "forged bid rejected on-chain with 'invalid bid signature'");
    assert.ok(r.failedVerifications >= 1, "an automated check failed at least once");
    assert.ok(r.reopened >= 1, "the failed bounty reopened for a new round");
    assert.ok(r.completed >= 1 && r.minted > 0n, "at least one bounty paid out and minted HIVE");

    // every on-chain hash resolves to a stored off-chain object with that exact hash
    for (const b of after.bounties) {
      for (const h of [b.spec_hash, b.deliverable_hash, b.check_results_hash].filter(Boolean) as string[]) {
        assert.ok(market.store.has(h), `off-chain object ${h.slice(0, 12)} stored`);
        market.store.get(h); // re-hash check
      }
    }
    // the adaptive worker logged at least one strategy change with a reason
    const changes = market.store.readStrategy(market.workers.adaptive.accountId);
    assert.ok(changes.length >= 1 && changes.every((c) => c.reason.length > 0));
    // every hub call was logged
    assert.ok(market.store.readTx().some((t) => t.method === "verify_bounty"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const runTestnet = process.env.HIVEFUND_E2E_TESTNET === "1";
test(
  "e2e (testnet): the same lifecycle with real transactions on NEAR testnet",
  { skip: runTestnet ? false : "set HIVEFUND_E2E_TESTNET=1 (needs config/deployment.testnet.json + agent keys in .env.local)", timeout: 15 * 60_000 },
  async () => {
    loadEnv();
    assert.ok(loadDeployment(), "config/deployment.testnet.json exists (run npm run setup:testnet)");
    const market = createTestnetMarket({ logSink: (l) => console.log(l) });
    const before = await readChainState(market.coordinator.hub, market.token, "testnet");
    const t = before.treasury;
    const need = 150_000_000_000_000_000_000_000n; // the two fixtures need 0.15 NEAR available
    assert.ok(BigInt(t.available) >= need, `treasury available ${t.available} >= 0.15 NEAR (fund_treasury first)`);
    const run = await runMarket(market, { maxSteps: 10, log: (l) => console.log(l) });
    const after = await readChainState(market.coordinator.hub, market.token, "testnet");
    market.store.writeJson("chain-state.json", after);
    assert.ok(run.allTerminal, "all bounties terminal on testnet");
    const r = checkRunInvariants(before, after, run.postedIds, market.forger.accountId);
    assert.ok(r.forgedRejected >= 1, "forged bid rejected on-chain");
    assert.ok(r.completed >= 1, "at least one bounty paid on-chain");
    // every tx of the run is in data/tx.jsonl with an explorer link
    const txs = market.store.readTx().filter((x) => x.ts >= run.startedAt - 1000);
    assert.ok(txs.length > 0 && txs.filter((x) => x.ok).every((x) => x.txHash && x.explorer?.includes("/txns/")));
    console.log(JSON.stringify({ ...r, minted: r.minted.toString(), paid: r.paid.toString() }));
  },
);

test(
  "testnet role separation: keys and contract both refuse cross-role calls",
  { skip: runTestnet ? false : "set HIVEFUND_E2E_TESTNET=1", timeout: 5 * 60_000 },
  async () => {
    loadEnv();
    const market = createTestnetMarket({ logSink: () => {} });
    const H = "0".repeat(64);
    // Function-call keys are restricted to each agent's own methods (access-key layer)…
    const keyOrContract = /ERR_NOT_VERIFIER|ERR_NOT_COORDINATOR|ERR_NOT_WORKER|MethodName|AccessKey|Access key does not allow/i;
    await assert.rejects(market.coordinator.hub.call("verify_bounty", { bounty_id: 0, passed: true, score: 100, check_results_hash: H }), keyOrContract);
    await assert.rejects(market.verifier.hub.call("select_winner", { bounty_id: 0, bid_id: 0 }), keyOrContract);
    // …and the contract enforces roles even for a full-access key (owner is none of these roles).
    if (market.owner) {
      await assert.rejects(market.owner.call("verify_bounty", { bounty_id: 0, passed: true, score: 100, check_results_hash: H }), /ERR_NOT_VERIFIER/);
      await assert.rejects(market.owner.call("select_winner", { bounty_id: 0, bid_id: 0 }), /ERR_NOT_COORDINATOR/);
      await assert.rejects(market.owner.call("place_bid", { bounty_id: 0, price_yocto: "1", eta_ms: 1, signature: "ed25519:x" }), /ERR_NOT_WORKER/);
    }
  },
);
