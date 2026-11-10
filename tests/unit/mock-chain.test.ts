// MockChain behaves like the bounty-hub contract: role checks, ERR_* strings, bid rejection reasons,
// treasury math, reopen/cancel, mint + callback failure + retry_mint, restricted token mint.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bidPayload, bidPublicKey, hashJson, newBidKey, parseNear, signBid } from "@hivefund/shared";
import { MockChain, type HubClient } from "@hivefund/shared/node";

const A = {
  owner: "root.testnet",
  hub: "hub.root.testnet",
  token: "hive.root.testnet",
  coord: "coordinator.root.testnet",
  ver: "verifier.root.testnet",
  cheap: "cheap.root.testnet",
  quality: "quality.root.testnet",
  stranger: "stranger.testnet",
};
const H = (s: string) => hashJson({ s });
const NEAR = (n: string) => parseNear(n).toString();

async function setup() {
  const chain = new MockChain({ owner: A.owner, hub: A.hub, token: A.token, spendCapYocto: NEAR("1"), mintRate: "10000000000000000", nowMs: 1_000_000 });
  const owner = chain.client(A.owner);
  await owner.call("set_coordinator", { account_id: A.coord });
  await owner.call("set_verifier", { account_id: A.ver });
  const keys = { cheap: newBidKey(), quality: newBidKey() };
  await owner.call("add_worker", { account_id: A.cheap, tier: 1, signing_pk: bidPublicKey(keys.cheap) });
  await owner.call("add_worker", { account_id: A.quality, tier: 3, signing_pk: bidPublicKey(keys.quality) });
  await owner.call("fund_treasury", {}, { depositYocto: NEAR("0.5") });
  return {
    chain,
    owner,
    coord: chain.client(A.coord),
    ver: chain.client(A.ver),
    cheap: chain.client(A.cheap),
    quality: chain.client(A.quality),
    stranger: chain.client(A.stranger),
    keys,
  };
}

async function post(coord: HubClient, budget = "0.1", minTier = 1, deadline = 10_000_000) {
  const r = await coord.call<number>("post_bounty", { title: "t", spec_hash: H("spec" + Math.random()), budget_yocto: NEAR(budget), deadline_ms: deadline, min_tier: minTier });
  return r.result;
}

async function bid(c: HubClient, key: string, worker: string, bounty: number, price: string, round = 0) {
  const p = bidPayload({ bounty_id: bounty, contract: A.hub, eta_ms: 1000, price_yocto: NEAR(price), round, worker });
  return (await c.call<number>("place_bid", { bounty_id: bounty, price_yocto: NEAR(price), eta_ms: 1000, signature: signBid(p, key) })).result;
}

const rejects = (p: Promise<unknown>, code: string) => assert.rejects(p, (e: Error) => e.message.includes(code));

test("role separation: coordinator cannot verify, verifier cannot select, non-workers cannot bid", async () => {
  const m = await setup();
  const b = await post(m.coord);
  const id = await bid(m.cheap, m.keys.cheap, A.cheap, b, "0.06");
  await rejects(m.ver.call("select_winner", { bounty_id: b, bid_id: id }), "ERR_NOT_COORDINATOR");
  await rejects(m.cheap.call("select_winner", { bounty_id: b, bid_id: id }), "ERR_NOT_COORDINATOR");
  await rejects(m.stranger.call("place_bid", { bounty_id: b, price_yocto: NEAR("0.01"), eta_ms: 1, signature: "ed25519:x" }), "ERR_NOT_WORKER");
  await m.coord.call("select_winner", { bounty_id: b, bid_id: id });
  await m.cheap.call("submit_work", { bounty_id: b, deliverable_hash: H("d") });
  await rejects(m.coord.call("verify_bounty", { bounty_id: b, passed: true, score: 90, check_results_hash: H("r") }), "ERR_NOT_VERIFIER");
  await rejects(m.stranger.call("set_coordinator", { account_id: A.stranger }), "ERR_NOT_OWNER");
  await rejects(m.stranger.call("post_bounty", { title: "x", spec_hash: H("x"), budget_yocto: NEAR("0.01"), deadline_ms: 9e9, min_tier: 1 }), "ERR_NOT_POSTER");
  await rejects(m.owner.call("set_verifier", { account_id: A.coord }), "ERR_ROLE_CONFLICT");
  await rejects(m.owner.call("add_worker", { account_id: A.ver, tier: 1, signing_pk: "ed25519:x" }), "ERR_ROLE_CONFLICT");
  await rejects(m.owner.call("add_worker", { account_id: "w.testnet", tier: 4, signing_pk: "ed25519:x" }), "ERR_BAD_TIER");
});

test("post_bounty errors and escrow accounting", async () => {
  const m = await setup();
  await rejects(m.coord.call("post_bounty", { title: "x", spec_hash: H("a"), budget_yocto: NEAR("0.6"), deadline_ms: 9e9, min_tier: 1 }), "ERR_TREASURY_INSUFFICIENT");
  await rejects(m.coord.call("post_bounty", { title: "x", spec_hash: H("a"), budget_yocto: NEAR("0.1"), deadline_ms: 1, min_tier: 1 }), "ERR_DEADLINE_PAST");
  await rejects(m.coord.call("post_bounty", { title: "x", spec_hash: "nothex", budget_yocto: NEAR("0.1"), deadline_ms: 9e9, min_tier: 1 }), "ERR_BAD_HASH");
  await rejects(m.coord.call("post_bounty", { title: "x".repeat(121), spec_hash: H("a"), budget_yocto: NEAR("0.1"), deadline_ms: 9e9, min_tier: 1 }), "ERR_TOO_LONG");
  await post(m.coord, "0.1");
  await post(m.coord, "0.05");
  const t = await m.coord.view<Record<string, string>>("get_treasury");
  assert.equal(t.escrowed, NEAR("0.15"));
  assert.equal(t.available, NEAR("0.35"));
  assert.equal(t.committed_total, NEAR("0.15"));
  // spend cap 1 NEAR: fund more, then exceed the cap
  await m.owner.call("fund_treasury", {}, { depositYocto: NEAR("2") });
  await rejects(m.coord.call("post_bounty", { title: "x", spec_hash: H("b"), budget_yocto: NEAR("0.9"), deadline_ms: 9e9, min_tier: 1 }), "ERR_SPEND_CAP");
  await rejects(m.stranger.call("fund_treasury", {}), "ERR_ZERO_DEPOSIT");
  // a failed call rolls back everything
  const after = await m.coord.view<Record<string, string>>("get_treasury");
  assert.equal(after.committed_total, NEAR("0.15"));
});

test("place_bid business rules store Rejected bids (no panic) with exact reasons", async () => {
  const m = await setup();
  const b = await post(m.coord, "0.1", 2);
  const tierBid = await bid(m.cheap, m.keys.cheap, A.cheap, b, "0.05");
  const overBid = await bid(m.quality, m.keys.quality, A.quality, b, "0.2");
  const ok = await bid(m.quality, m.keys.quality, A.quality, b, "0.09");
  const dup = await bid(m.quality, m.keys.quality, A.quality, b, "0.08");
  const bids = await m.coord.view<{ id: number; status: string; reject_reason: string | null }[]>("get_bids", { bounty_id: b });
  const by = (id: number) => bids.find((x) => x.id === id)!;
  assert.equal(by(tierBid).reject_reason, "tier below min_tier");
  assert.equal(by(overBid).reject_reason, "price exceeds budget");
  assert.equal(by(ok).status, "Pending");
  assert.equal(by(dup).reject_reason, "duplicate bid this round");
  const bounty = await m.coord.view<{ status: string }>("get_bounty", { bounty_id: b });
  assert.equal(bounty.status, "Bidding");
  const log = await m.coord.view<{ kind: string }[]>("get_activity_log", {});
  assert.equal(log.filter((x) => x.kind === "BidRejected").length, 3);
  // deadline passed
  m.chain.setNow(20_000_000);
  const late = await bid(m.quality, m.keys.quality, A.quality, b, "0.01");
  assert.equal((await m.coord.view<{ id: number; reject_reason: string }[]>("get_bids", { bounty_id: b })).find((x) => x.id === late)!.reject_reason, "deadline passed");
});

test("verify fail -> excluded + reopen -> rebid -> pass: payout, mint, treasury and supply math", async () => {
  const m = await setup();
  const b = await post(m.coord, "0.1");
  const c0 = await bid(m.cheap, m.keys.cheap, A.cheap, b, "0.06");
  const q0 = await bid(m.quality, m.keys.quality, A.quality, b, "0.08");
  await m.coord.call("select_winner", { bounty_id: b, bid_id: c0 });
  await rejects(m.quality.call("submit_work", { bounty_id: b, deliverable_hash: H("x") }), "ERR_NOT_WINNER");
  await m.cheap.call("submit_work", { bounty_id: b, deliverable_hash: H("cheap") });
  await m.ver.call("verify_bounty", { bounty_id: b, passed: false, score: 0, check_results_hash: H("fail") });
  let bounty = await m.coord.view<{ status: string; round: number; attempts: number; excluded: string[] }>("get_bounty", { bounty_id: b });
  assert.deepEqual([bounty.status, bounty.round, bounty.attempts], ["Open", 1, 1]);
  assert.deepEqual(bounty.excluded, [A.cheap]);
  // old-round bid cannot be selected; excluded worker is rejected
  await rejects(m.coord.call("select_winner", { bounty_id: b, bid_id: q0 }), "ERR_BAD_STATUS");
  const cx = await bid(m.cheap, m.keys.cheap, A.cheap, b, "0.05", 1);
  const q1 = await bid(m.quality, m.keys.quality, A.quality, b, "0.08", 1);
  const bids = await m.coord.view<{ id: number; status: string; reject_reason: string | null }[]>("get_bids", { bounty_id: b });
  assert.equal(bids.find((x) => x.id === cx)!.reject_reason, "worker excluded");
  assert.equal(bids.find((x) => x.id === q0)!.status, "Lost"); // lost to the round-0 winner
  await rejects(m.coord.call("select_winner", { bounty_id: b, bid_id: cx }), "ERR_BID_NOT_SELECTABLE");
  await m.coord.call("select_winner", { bounty_id: b, bid_id: q1 });
  await m.quality.call("submit_work", { bounty_id: b, deliverable_hash: H("quality") });
  await rejects(m.ver.call("verify_bounty", { bounty_id: b, passed: true, score: 101, check_results_hash: H("r") }), "ERR_BAD_SCORE");
  await m.ver.call("verify_bounty", { bounty_id: b, passed: true, score: 80, check_results_hash: H("pass") });

  bounty = await m.coord.view("get_bounty", { bounty_id: b });
  assert.equal(bounty.status, "Completed");
  const t = await m.coord.view<Record<string, string>>("get_treasury");
  assert.equal(t.paid_out, NEAR("0.08"));
  assert.equal(t.escrowed, "0");
  assert.equal(t.available, NEAR("0.42")); // 0.5 - 0.08
  assert.equal(m.chain.nearBalance(A.quality), parseNear("0.08"));
  const supply = await m.coord.view<{ amount: string; bid_units: string; score: number }[]>("get_supply_history", {});
  assert.equal(supply.length, 1);
  assert.equal(supply[0].bid_units, "80");
  assert.equal(supply[0].amount, "640000000000000000"); // 0.64 HIVE
  const tok = m.chain.tokenClient(A.stranger);
  assert.equal(await tok.view("ft_balance_of", { account_id: A.quality }), "640000000000000000");
  assert.equal(await tok.view("ft_total_supply"), "640000000000000000");
  const rep = await m.coord.view<{ account_id: string; reputation: number; completed: number; failed: number }[]>("get_reputation", {});
  assert.equal(rep.find((w) => w.account_id === A.quality)!.reputation, 18); // 1*10 + 80/10
  assert.equal(rep.find((w) => w.account_id === A.cheap)!.reputation, 0); // max(0, -15)
  const kinds = (await m.coord.view<{ kind: string }[]>("get_activity_log", {})).map((x) => x.kind);
  for (const k of ["VerificationFailed", "BountyReopened", "VerificationPassed", "Payout", "Mint"]) assert.ok(kinds.includes(k), k);
});

test("two failed verifications cancel the bounty and refund the treasury", async () => {
  const m = await setup();
  const b = await post(m.coord, "0.1");
  for (const [c, key, acct] of [
    [m.cheap, m.keys.cheap, A.cheap],
    [m.quality, m.keys.quality, A.quality],
  ] as const) {
    const bounty = await m.coord.view<{ round: number }>("get_bounty", { bounty_id: b });
    const id = await bid(c, key, acct, b, "0.05", bounty.round);
    await m.coord.call("select_winner", { bounty_id: b, bid_id: id });
    await c.call("submit_work", { bounty_id: b, deliverable_hash: H(acct) });
    await m.ver.call("verify_bounty", { bounty_id: b, passed: false, score: 10, check_results_hash: H("f" + acct) });
  }
  const bounty = await m.coord.view<{ status: string; attempts: number }>("get_bounty", { bounty_id: b });
  assert.deepEqual([bounty.status, bounty.attempts], ["Cancelled", 2]);
  const t = await m.coord.view<Record<string, string>>("get_treasury");
  assert.equal(t.available, NEAR("0.5"));
  assert.equal(t.refunded_total, NEAR("0.1"));
  assert.equal(t.escrowed, "0");
});

test("mint failure keeps a PendingMint; only the owner can retry_mint; nobody else can mint HIVE", async () => {
  const m = await setup();
  const b = await post(m.coord, "0.05");
  const id = await bid(m.quality, m.keys.quality, A.quality, b, "0.05");
  await m.coord.call("select_winner", { bounty_id: b, bid_id: id });
  await m.quality.call("submit_work", { bounty_id: b, deliverable_hash: H("w") });
  m.chain.failNextMints = 1;
  await m.ver.call("verify_bounty", { bounty_id: b, passed: true, score: 100, check_results_hash: H("ok") });
  let pending = await m.coord.view<{ amount: string }[]>("get_pending_mints");
  assert.equal(pending.length, 1);
  assert.equal(pending[0].amount, "500000000000000000");
  await rejects(m.coord.call("retry_mint", { bounty_id: b }), "ERR_NOT_OWNER");
  await m.owner.call("retry_mint", { bounty_id: b });
  pending = await m.coord.view("get_pending_mints");
  assert.equal(pending.length, 0);
  await rejects(m.owner.call("retry_mint", { bounty_id: b }), "ERR_NO_PENDING_MINT");
  // HIVE has no admin mint: even the owner calling the token directly is refused
  await rejects(m.chain.tokenClient(A.owner).call("mint", { account_id: A.owner, amount: "1" }), "ERR_NOT_MINTER");
  const kinds = (await m.coord.view<{ kind: string }[]>("get_activity_log", {})).map((x) => x.kind);
  assert.ok(kinds.includes("MintFailed") && kinds.includes("Mint"));
});

test("cancel_bounty and reject_bid", async () => {
  const m = await setup();
  const b = await post(m.coord, "0.1");
  const id = await bid(m.cheap, m.keys.cheap, A.cheap, b, "0.05");
  await rejects(m.cheap.call("reject_bid", { bounty_id: b, bid_id: id, reason: "x" }), "ERR_NOT_COORDINATOR");
  await m.coord.call("reject_bid", { bounty_id: b, bid_id: id, reason: "invalid bid signature" });
  await rejects(m.coord.call("reject_bid", { bounty_id: b, bid_id: id, reason: "again" }), "ERR_BID_NOT_SELECTABLE");
  await rejects(m.stranger.call("cancel_bounty", { bounty_id: b }), "ERR_NOT_POSTER");
  await m.coord.call("cancel_bounty", { bounty_id: b });
  await rejects(m.coord.call("cancel_bounty", { bounty_id: b }), "ERR_BAD_STATUS");
  const t = await m.coord.view<Record<string, string>>("get_treasury");
  assert.equal(t.available, NEAR("0.5"));
});
