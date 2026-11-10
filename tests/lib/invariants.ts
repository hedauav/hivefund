// Market invariants checked after a full run, identical for mock and testnet.
import assert from "node:assert/strict";
import { INVALID_SIGNATURE_REASON, mintAmount, type Bounty } from "@hivefund/shared";
import type { ChainState } from "@hivefund/shared/node";

export interface InvariantReport {
  completed: number;
  cancelled: number;
  forgedRejected: number;
  failedVerifications: number;
  reopened: number;
  minted: bigint;
  paid: bigint;
}

export function checkRunInvariants(before: ChainState, after: ChainState, runBountyIds: number[], forger: string): InvariantReport {
  const ids = new Set(runBountyIds);
  const bounties = after.bounties.filter((b) => ids.has(b.id));
  assert.ok(bounties.length > 0, "run posted bounties");
  const activity = after.activity.slice(before.activity.length);
  const newSupply = after.supply_history.slice(before.supply_history.length);

  let paid = 0n;
  let minted = 0n;
  let completed = 0;
  let cancelled = 0;
  for (const b of bounties) {
    assert.ok(b.status === "Completed" || b.status === "Cancelled", `bounty ${b.id} terminal (got ${b.status})`);
    const bids = after.bids[String(b.id)];
    if (b.status === "Cancelled") {
      cancelled++;
      assert.equal(b.attempts, 2, `cancelled bounty ${b.id} had two failed attempts`);
      continue;
    }
    completed++;
    const win = bids.find((x) => x.id === b.winner_bid_id);
    assert.ok(win, `bounty ${b.id} has a winner`);
    assert.equal(win.status, "Paid");
    assert.ok(BigInt(win.price_yocto) <= BigInt(b.budget_yocto), "winner price within budget");
    assert.notEqual(win.worker, forger, "the forger never wins");
    assert.ok(b.check_results_hash && /^[0-9a-f]{64}$/.test(b.check_results_hash), "check_results_hash recorded");
    paid += BigInt(win.price_yocto);
    const expected = mintAmount(win.price_yocto, b.score!, after.config.mint_rate);
    if (expected > 0n) {
      const sp = newSupply.find((s) => s.bounty_id === b.id);
      assert.ok(sp, `supply point for bounty ${b.id}`);
      assert.equal(BigInt(sp.amount), expected, `mint for bounty ${b.id} = units×score/100×rate`);
      assert.equal(sp.recipient, win.worker);
      assert.equal(BigInt(b.hive_minted), expected);
      minted += expected;
    }
    const kinds = activity.filter((a) => a.bounty_id === b.id).map((a) => a.kind);
    for (const k of ["BountyPosted", "WinnerSelected", "WorkSubmitted", "VerificationPassed", "Payout"]) {
      assert.ok(kinds.includes(k as never), `bounty ${b.id} activity has ${k}`);
    }
    if (expected > 0n) assert.ok(kinds.includes("Mint"), `bounty ${b.id} activity has Mint`);
  }

  assert.equal(BigInt(after.treasury.committed_total), BigInt(after.treasury.escrowed) + BigInt(after.treasury.paid_out), "committed_total = escrowed + paid_out");
  // treasury: escrow fully released, available reduced by exactly what was paid
  const t0 = before.treasury;
  const t1 = after.treasury;
  const funded = BigInt(t1.funded_total) - BigInt(t0.funded_total);
  assert.equal(BigInt(t1.paid_out) - BigInt(t0.paid_out), paid, "paid_out delta = sum of winning prices");
  assert.equal(BigInt(t1.escrowed), BigInt(t0.escrowed), "no escrow left behind by the run");
  assert.equal(BigInt(t1.available), BigInt(t0.available) + funded - paid, "available reduced by exactly the payouts");

  // supply + balances
  assert.equal(BigInt(after.config.total_minted) - BigInt(before.config.total_minted), minted, "total_minted delta");
  for (const w of after.reputation) {
    const delta = BigInt(after.token_state.balances[w.account_id] ?? "0") - BigInt(before.token_state.balances[w.account_id] ?? "0");
    const exp = newSupply.filter((s) => s.recipient === w.account_id).reduce((a, s) => a + BigInt(s.amount), 0n);
    assert.equal(delta, exp, `ft_balance_of(${w.account_id}) delta matches its mints`);
  }

  // forged bids: rejected on-chain with the signature reason, never selected
  const forged = bounties.flatMap((b) => after.bids[String(b.id)].filter((x) => x.worker === forger));
  for (const f of forged) assert.equal(f.status, "Rejected", `forged bid ${f.id} rejected`);
  const forgedRejected = activity.filter(
    (a) => a.kind === "BidRejected" && a.detail.includes(forger.split(".")[0]) && a.detail.includes(INVALID_SIGNATURE_REASON),
  ).length;

  return {
    completed,
    cancelled,
    forgedRejected,
    failedVerifications: activity.filter((a) => a.kind === "VerificationFailed" && ids.has(a.bounty_id!)).length,
    reopened: activity.filter((a) => a.kind === "BountyReopened" && ids.has(a.bounty_id!)).length,
    minted,
    paid,
  };
}

export const terminal = (b: Bounty) => b.status === "Completed" || b.status === "Cancelled";
