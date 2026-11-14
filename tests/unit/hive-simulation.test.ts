import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MINT_RATE, mintAmount } from "@hivefund/shared";
import { SCENARIOS, runScenario, type Scenario } from "../../scripts/simulate-supply.ts";

const short = (over: Partial<Scenario>): Scenario => ({ ...SCENARIOS[0]!, days: 10, topUps: {}, ...over });

test("simulation: supply == Σ mints over passed bounties, each mint uses the production formula", async () => {
  const res = await runScenario(short({ id: "t-busy" }));
  assert.ok(res.passes.length > 0, "some work passed");
  const sum = res.passes.reduce((s, p) => s + p.mintedRaw, 0n);
  assert.equal(res.supplyRaw, sum);
  assert.equal(res.tokenSupplyRaw, res.supplyRaw, "token ft_total_supply matches hub total_minted");
  for (const p of res.passes) assert.equal(p.mintedRaw, mintAmount(p.priceYocto, p.score, DEFAULT_MINT_RATE));
  // bounded by treasury spend: at most paid milliNEAR × mint_rate
  assert.ok(res.supplyRaw <= (res.paidOutYocto / 10n ** 21n) * DEFAULT_MINT_RATE);
});

test("simulation: no pass → no mint; failed bounties are cancelled and refunded", async () => {
  const neverPass = { pass: 0, passScore: [80, 90] as [number, number] };
  const res = await runScenario(short({ id: "t-fail", quality: { low: neverPass, medium: neverPass, high: neverPass } }));
  const last = res.checkpoints.at(-1)!;
  assert.ok(last.posted > 0);
  assert.equal(res.passes.length, 0);
  assert.equal(res.supplyRaw, 0n, "nothing minted without a verified pass");
  assert.equal(res.paidOutYocto, 0n, "nothing paid without a verified pass");
  assert.equal(res.cancelled, last.posted, "every bounty ends cancelled");
  assert.ok(res.refundedYocto > 0n, "budgets were refunded");
  assert.equal(BigInt(last.treasury.available), res.fundedYocto, "treasury got every yocto back");
  assert.equal(BigInt(last.treasury.escrowed), 0n);
});

test("simulation is deterministic for a seed", async () => {
  const a = await runScenario(short({ id: "t-det" }));
  const b = await runScenario(short({ id: "t-det" }));
  assert.equal(a.supplyRaw, b.supplyRaw);
  assert.equal(a.passes.length, b.passes.length);
});
