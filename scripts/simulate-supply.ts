// 60-day HIVE supply simulation. OFFLINE — this is NOT on-chain data.
//
// What is REAL here (imported, not re-implemented):
//   - MockChain from @hivefund/shared/node: the in-memory port of the deployed bounty-hub + hive-token rules
//     (treasury spend cap + escrow, bid rejections, select/submit/verify, 2-failure cancel + refund, mint formula,
//      supply history). The same class backs `npm run demo:mock` and the e2e tests.
//   - mintAmount / bidUnits from @hivefund/shared (the formula the contract enforces: bid_units × score / 100 × mint_rate).
//   - scoreBids from @hivefund/shared (the coordinator's selection formula incl. the cold-start reputation prior).
//   - quote() and AdaptiveStrategy / StaticStrategy from @hivefund/worker-core (real worker pricing + adaptive margins).
//   - The real bounty specs in /bounties (they drive quote() complexity).
//
// What is MODELLED (assumptions, stated in the output):
//   - How many bounties get posted per day, their budgets, and treasury top-ups (scenario parameters).
//   - Whether a deliverable passes verification and its score (seeded random draw per worker quality),
//     instead of running an LLM + test suite. Parameters are taken from the recorded testnet run.
//
// Usage:  npm run simulate:supply            # print markdown to stdout
//         npm run simulate:supply -- --write # also write docs/HIVE_SIMULATION.md
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_MINT_RATE,
  bidUnits,
  formatHive,
  formatNear,
  mintAmount,
  parseNear,
  scoreBids,
  sha256Hex,
  type Bid,
  type Bounty,
  type BountySpec,
  type Treasury,
  type WorkerView,
} from "@hivefund/shared";
import { MockChain, type HubClient } from "@hivefund/shared/node";
import { AdaptiveStrategy, StaticStrategy, quote, type Quality, type Strategy } from "@hivefund/worker-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DAY_MS = 86_400_000;
const T0 = Date.UTC(2026, 10, 15); // simulated day 0 (clock is simulated, not wall time)

// ---------------- deterministic PRNG ----------------
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randInt(r: () => number, lo: number, hi: number): number {
  return lo + Math.floor(r() * (hi - lo + 1));
}
/** Poisson draw (Knuth) — bounties posted per day. */
function poisson(r: () => number, lambda: number): number {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= r();
  } while (p > L);
  return k - 1;
}

// ---------------- scenario model ----------------
export interface QualityModel {
  /** probability a deliverable at this quality passes all checks + rubric threshold */
  pass: number;
  /** inclusive score range on a pass */
  passScore: [number, number];
}
export interface Scenario {
  id: string;
  title: string;
  description: string;
  seed: number;
  days: number;
  /** mean bounties posted per day (Poisson) */
  bountiesPerDay: number;
  /** bounty budget range, NEAR */
  budgetNear: [number, number];
  initialFundNear: number;
  /** treasury top-ups: day -> NEAR */
  topUps: Record<number, number>;
  spendCapNear: number;
  quality: Record<Quality, QualityModel>;
  /** score given on a failed verification */
  failScore: [number, number];
}

// Pass rates / scores from the recorded testnet run (data/testnet-run): passes scored 87–100; real failures happened
// (truncated LLM output, a RangeError bug at 11/37 checks). Healthy = those numbers; low-quality = a much worse swarm.
const HEALTHY: Record<Quality, QualityModel> = {
  low: { pass: 0.6, passScore: [72, 90] },
  medium: { pass: 0.78, passScore: [80, 95] },
  high: { pass: 0.92, passScore: [87, 100] },
};
const LOW_QUALITY: Record<Quality, QualityModel> = {
  low: { pass: 0.25, passScore: [70, 82] },
  medium: { pass: 0.4, passScore: [72, 86] },
  high: { pass: 0.55, passScore: [75, 90] },
};

export const SCENARIOS: Scenario[] = [
  {
    id: "busy",
    title: "A. Busy, healthy market",
    description: "≈4 bounties/day, budgets 0.03–0.10 NEAR, treasury 2 NEAR + 1 NEAR top-up every 7 days, workers at testnet pass rates.",
    seed: 20261115,
    days: 60,
    bountiesPerDay: 4,
    budgetNear: [0.03, 0.1],
    initialFundNear: 2,
    topUps: { 7: 1, 14: 1, 21: 1, 28: 1, 35: 1, 42: 1, 49: 1, 56: 1 },
    spendCapNear: 100,
    quality: HEALTHY,
    failScore: [10, 65],
  },
  {
    id: "quiet",
    title: "B. Quiet market",
    description: "≈0.5 bounties/day, same budgets and worker quality, treasury 0.5 NEAR (the deployed testnet amount), no top-ups.",
    seed: 20261116,
    days: 60,
    bountiesPerDay: 0.5,
    budgetNear: [0.03, 0.1],
    initialFundNear: 0.5,
    topUps: {},
    spendCapNear: 1,
    quality: HEALTHY,
    failScore: [10, 65],
  },
  {
    id: "low-quality",
    title: "C. Low-quality swarm (high failure rate)",
    description: "Same demand and funding as A, but workers pass only 25–55% of the time and score lower when they do.",
    seed: 20261115,
    days: 60,
    bountiesPerDay: 4,
    budgetNear: [0.03, 0.1],
    initialFundNear: 2,
    topUps: { 7: 1, 14: 1, 21: 1, 28: 1, 35: 1, 42: 1, 49: 1, 56: 1 },
    spendCapNear: 100,
    quality: LOW_QUALITY,
    failScore: [10, 65],
  },
  {
    id: "whale",
    title: "D. Whale funding spike",
    description: "Identical to A (same seed), plus a single 20 NEAR deposit on day 30. Funding alone mints nothing.",
    seed: 20261115,
    days: 60,
    bountiesPerDay: 4,
    budgetNear: [0.03, 0.1],
    initialFundNear: 2,
    topUps: { 7: 1, 14: 1, 21: 1, 28: 1, 30: 20, 35: 1, 42: 1, 49: 1, 56: 1 },
    spendCapNear: 100,
    quality: HEALTHY,
    failScore: [10, 65],
  },
];

// ---------------- agents (real worker pricing + strategies) ----------------
interface SimWorker {
  id: string;
  tier: number;
  speed: number;
  strategy: Strategy;
}
function makeWorkers(): SimWorker[] {
  return [
    { id: "cheap.sim", tier: 1, speed: 1.6, strategy: new StaticStrategy(0.05, "low") },
    { id: "quality.sim", tier: 3, speed: 0.7, strategy: new StaticStrategy(0.35, "high") },
    {
      id: "adaptive.sim",
      tier: 2,
      speed: 1.0,
      strategy: new AdaptiveStrategy({
        worker: "adaptive.sim",
        initialMargin: 0.2,
        minMargin: 0.05,
        maxMargin: 0.5,
        initialQuality: "medium",
        now: () => 0,
      }),
    },
  ];
}

function loadSpecs(): BountySpec[] {
  const files = ["bounties/slugify.json", "bounties/subaccount-checklist.json", "bounties/starter/near-glossary.json"];
  return files.map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8")) as BountySpec);
}

// ---------------- result types ----------------
export interface Checkpoint {
  day: number;
  posted: number;
  passed: number;
  failedVerifications: number;
  cancelled: number;
  skippedNoFunds: number;
  supplyRaw: bigint;
  treasury: Treasury;
}
export interface PassRecord {
  bountyId: number;
  priceYocto: bigint;
  score: number;
  mintedRaw: bigint;
}
export interface ScenarioResult {
  scenario: Scenario;
  checkpoints: Checkpoint[];
  passes: PassRecord[];
  failedVerifications: number;
  cancelled: number;
  refundedYocto: bigint;
  supplyRaw: bigint;
  tokenSupplyRaw: bigint;
  paidOutYocto: bigint;
  fundedYocto: bigint;
  strategyChanges: number;
  adaptiveMarginRange: [number, number];
  /** Σ bid_units × mint_rate over passes: what supply would be if every pass scored 100 */
  maxSupplyAtScore100: bigint;
  winsByWorker: Record<string, number>;
}

const CHECK_DAYS = [0, 7, 14, 30, 45, 60];

function hashOf(...parts: unknown[]): string {
  return sha256Hex(JSON.stringify(parts));
}

export async function runScenario(sc: Scenario): Promise<ScenarioResult> {
  const r = mulberry32(sc.seed);
  const chain = new MockChain({
    owner: "owner.sim",
    hub: "hub.sim",
    token: "hive.sim",
    spendCapYocto: parseNear(String(sc.spendCapNear)).toString(),
    mintRate: DEFAULT_MINT_RATE.toString(),
    nowMs: T0,
  });
  const owner = chain.client("owner.sim");
  const coord = chain.client("coordinator.sim");
  const verifier = chain.client("verifier.sim");
  await owner.call("set_coordinator", { account_id: "coordinator.sim" });
  await owner.call("set_verifier", { account_id: "verifier.sim" });
  const workers = makeWorkers();
  const wClient = new Map<string, HubClient>();
  for (const w of workers) {
    await owner.call("add_worker", { account_id: w.id, tier: w.tier, signing_pk: `ed25519:${w.id}` });
    wClient.set(w.id, chain.client(w.id));
  }
  const funder = chain.client("community.sim");
  await funder.call("fund_treasury", {}, { depositYocto: parseNear(String(sc.initialFundNear)).toString() });

  const specs = loadSpecs();
  const checkpoints: Checkpoint[] = [];
  const passes: PassRecord[] = [];
  let posted = 0;
  let failedVerifications = 0;
  let cancelled = 0;
  let skippedNoFunds = 0;
  let strategyChanges = 0;
  const adaptive = workers.find((w) => w.id === "adaptive.sim")!;
  let mMin = adaptive.strategy.margin;
  let mMax = adaptive.strategy.margin;
  const winsByWorker: Record<string, number> = Object.fromEntries(workers.map((w) => [w.id, 0]));

  const snap = async (day: number) => {
    const t = await owner.view<Treasury>("get_treasury");
    const cfg = await owner.view<{ total_minted: string }>("get_config");
    checkpoints.push({
      day,
      posted,
      passed: passes.length,
      failedVerifications,
      cancelled,
      skippedNoFunds,
      supplyRaw: BigInt(cfg.total_minted),
      treasury: t,
    });
  };
  await snap(0);

  const record = (w: SimWorker, outcome: "win" | "loss" | "fail", bountyId: number) => {
    const ch = w.strategy.onOutcome(outcome, bountyId);
    strategyChanges += ch.length;
    if (w === adaptive) {
      mMin = Math.min(mMin, adaptive.strategy.margin);
      mMax = Math.max(mMax, adaptive.strategy.margin);
    }
  };

  for (let day = 1; day <= sc.days; day++) {
    chain.setNow(T0 + day * DAY_MS);
    const top = sc.topUps[day];
    if (top) await funder.call("fund_treasury", {}, { depositYocto: parseNear(String(top)).toString() });

    const n = poisson(r, sc.bountiesPerDay);
    for (let i = 0; i < n; i++) {
      const spec = specs[randInt(r, 0, specs.length - 1)]!;
      const budgetMilli = randInt(r, Math.round(sc.budgetNear[0] * 1000), Math.round(sc.budgetNear[1] * 1000));
      const budget = parseNear((budgetMilli / 1000).toFixed(3));
      const t = await owner.view<Treasury>("get_treasury");
      if (BigInt(t.available) < budget) {
        skippedNoFunds++;
        continue;
      }
      const posting = await coord.call<number>("post_bounty", {
        title: `${spec.title} (day ${day} #${i})`.slice(0, 120),
        spec_hash: hashOf(spec.title, day, i),
        budget_yocto: budget.toString(),
        deadline_ms: T0 + (day + 3) * DAY_MS,
        min_tier: spec.min_tier,
      });
      const bountyId = posting.result;
      posted++;

      // up to 2 rounds (contract cancels + refunds after the 2nd failed verification)
      for (let round = 0; round < 2; round++) {
        const bounty = (await owner.view<Bounty>("get_bounty", { bounty_id: bountyId }))!;
        if (bounty.status === "Cancelled" || bounty.status === "Completed") break;
        const reps = await owner.view<WorkerView[]>("get_reputation", {});
        const repOf = new Map(reps.map((x) => [x.account_id, x]));
        const bidders: { w: SimWorker; bidId: number; eta: number; price: bigint }[] = [];
        for (const w of workers) {
          if (w.tier < spec.min_tier || bounty.excluded.includes(w.id)) continue;
          let q = quote(spec, budget, w.strategy.margin, w.strategy.quality, w.speed);
          if (q.expectedProfit < 0n) {
            const ch = w.strategy.onUnprofitable(bountyId);
            if (ch) strategyChanges++;
            q = quote(spec, budget, w.strategy.margin, w.strategy.quality, w.speed);
            if (q.expectedProfit < 0n) continue;
          }
          if (q.price > budget) continue; // a real worker skips over-budget bounties
          const bid = await wClient.get(w.id)!.call<number>("place_bid", {
            bounty_id: bountyId,
            price_yocto: q.price.toString(),
            eta_ms: q.etaMs,
            signature: `ed25519:sim-${w.id}-${bountyId}-${round}`,
          });
          bidders.push({ w, bidId: bid.result, eta: q.etaMs, price: q.price });
        }
        if (bidders.length === 0) {
          await coord.call("cancel_bounty", { bounty_id: bountyId });
          cancelled++;
          break;
        }
        const bids = await owner.view<Bid[]>("get_bids", { bounty_id: bountyId });
        const pending = bids.filter((b) => b.status === "Pending" && b.round === bounty.round);
        const ranked = scoreBids(
          pending.map((b) => {
            const rep = repOf.get(b.worker);
            return {
              bid_id: b.id,
              worker: b.worker,
              price_yocto: b.price_yocto,
              eta_ms: b.eta_ms,
              reputation: rep?.reputation ?? 0,
              history: (rep?.completed ?? 0) + (rep?.failed ?? 0),
              sig_valid: true,
            };
          }),
          budget.toString(),
          spec.selection_weights,
        );
        const winner = ranked[0]!;
        await coord.call("select_winner", { bounty_id: bountyId, bid_id: winner.bid_id });
        for (const b of bidders) if (b.bidId !== winner.bid_id) record(b.w, "loss", bountyId);
        const ww = bidders.find((b) => b.bidId === winner.bid_id)!;
        await wClient.get(ww.w.id)!.call("submit_work", { bounty_id: bountyId, deliverable_hash: hashOf("d", bountyId, round) });

        // MODELLED verification outcome (the real verifier runs schema/tests/LLM rubric)
        const qm = sc.quality[ww.w.strategy.quality];
        const passed = r() < qm.pass;
        const score = passed ? randInt(r, qm.passScore[0], qm.passScore[1]) : randInt(r, sc.failScore[0], sc.failScore[1]);
        const before = BigInt((await owner.view<{ total_minted: string }>("get_config")).total_minted);
        await verifier.call("verify_bounty", {
          bounty_id: bountyId,
          passed,
          score,
          check_results_hash: hashOf("r", bountyId, round, passed, score),
        });
        const after = BigInt((await owner.view<{ total_minted: string }>("get_config")).total_minted);
        if (passed) {
          passes.push({ bountyId, priceYocto: ww.price, score, mintedRaw: after - before });
          winsByWorker[ww.w.id] = (winsByWorker[ww.w.id] ?? 0) + 1;
          record(ww.w, "win", bountyId);
          break;
        }
        failedVerifications++;
        record(ww.w, "fail", bountyId);
        const b2 = (await owner.view<Bounty>("get_bounty", { bounty_id: bountyId }))!;
        if (b2.status === "Cancelled") {
          cancelled++;
          break;
        }
      }
    }
    if (CHECK_DAYS.includes(day) || day === sc.days) await snap(day);
  }

  const cfg = await owner.view<{ total_minted: string }>("get_config");
  const tokenSupply = await chain.tokenClient("owner.sim").view<string>("ft_total_supply");
  const t = await owner.view<Treasury>("get_treasury");
  return {
    scenario: sc,
    checkpoints,
    passes,
    failedVerifications,
    cancelled,
    refundedYocto: BigInt(t.refunded_total),
    supplyRaw: BigInt(cfg.total_minted),
    tokenSupplyRaw: BigInt(tokenSupply),
    paidOutYocto: BigInt(t.paid_out),
    fundedYocto: BigInt(t.funded_total),
    strategyChanges,
    adaptiveMarginRange: [mMin, mMax],
    maxSupplyAtScore100: passes.reduce((s, p) => s + bidUnits(p.priceYocto) * DEFAULT_MINT_RATE, 0n),
    winsByWorker,
  };
}

// ---------------- report ----------------
function hive(raw: bigint): string {
  return formatHive(raw, 3);
}
function near(y: bigint | string): string {
  return formatNear(BigInt(y), 3);
}

export function renderScenario(res: ScenarioResult): string {
  const sc = res.scenario;
  const lines: string[] = [];
  lines.push(`### ${sc.title}`, "", sc.description, "");
  lines.push(
    "| Day | Bounties posted | Passed | Failed verifications | Cancelled (refunded) | HIVE supply | HIVE per verified job | Treasury available | Paid out | Refunded |",
    "|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  );
  for (const c of res.checkpoints) {
    const per = c.passed > 0 ? hive(c.supplyRaw / BigInt(c.passed)) : "—";
    lines.push(
      `| ${c.day} | ${c.posted} | ${c.passed} | ${c.failedVerifications} | ${c.cancelled} | ${hive(c.supplyRaw)} | ${per} | ${near(c.treasury.available)} | ${near(c.treasury.paid_out)} | ${near(c.treasury.refunded_total)} |`,
    );
  }
  const avgScore = res.passes.length ? res.passes.reduce((s, p) => s + p.score, 0) / res.passes.length : 0;
  const bound = (res.paidOutYocto / 10n ** 21n) * DEFAULT_MINT_RATE; // paid milliNEAR × mint_rate
  const lost = res.maxSupplyAtScore100 - res.supplyRaw;
  lines.push(
    "",
    `- Funded **${near(res.fundedYocto)} NEAR**, paid to verified work **${near(res.paidOutYocto)} NEAR**, refunded from cancelled bounties **${near(res.refundedYocto)} NEAR**; ${res.checkpoints.at(-1)!.skippedNoFunds} bounties could not be posted because the treasury was short.`,
    `- HIVE supply **${hive(res.supplyRaw)}** (token \`ft_total_supply\` ${hive(res.tokenSupplyRaw)}); ceiling from payouts (paid milliNEAR × mint_rate) **${hive(bound)}**.`,
    `- Average score of passed work **${avgScore.toFixed(1)}**; quality-weighting withheld **${hive(lost)} HIVE** (${res.maxSupplyAtScore100 > 0n ? ((Number(lost) / Number(res.maxSupplyAtScore100)) * 100).toFixed(1) : "0"}% of what score-100 work would have minted).`,
    `- Wins: ${Object.entries(res.winsByWorker).map(([w, n]) => `${w.replace(".sim", "")} ${n}`).join(", ")}; adaptive margin moved within ${res.adaptiveMarginRange[0]}–${res.adaptiveMarginRange[1]} (${res.strategyChanges} strategy changes).`,
    "",
  );
  return lines.join("\n");
}

export function renderReport(results: ScenarioResult[]): string {
  const by = Object.fromEntries(results.map((x) => [x.scenario.id, x]));
  const a = by.busy!;
  const c = by["low-quality"]!;
  const d = by.whale!;
  const out: string[] = [];
  out.push(
    "# HIVE supply — 60-day simulation",
    "",
    "> **Offline simulation using the production mint math — not on-chain data.** Generated by `npm run simulate:supply -- --write` (`scripts/simulate-supply.ts`). Deterministic: the same seed always produces the same tables.",
    "",
    "## How it works",
    "",
    "- **Real code:** every bounty runs through `MockChain` (`agents/shared/src/node/mock-chain.ts`), the in-memory port of the deployed `bounty-hub` + `hive-token` rules: treasury escrow and spend cap, bid rejection, select → submit → verify, reopen after a failed verification, cancel + refund after two, and the mint `bid_units × score / 100 × mint_rate`. Winners are picked with the real `scoreBids` (incl. the cold-start prior); bids are priced with the real worker `quote()` and the real `AdaptiveStrategy` margins; bounty specs are the real files in `/bounties`.",
    "- **Modelled:** demand (Poisson bounties/day), budgets, treasury top-ups, and verification outcomes (a seeded pass/score draw per worker quality instead of running tests + an LLM rubric).",
    `- **Parameters** (from the recorded testnet run): bounty budgets 0.03–0.10 NEAR; \`mint_rate\` = 1e16 (1 NEAR of verified work at score 100 = 10 HIVE); healthy pass rates low/medium/high quality = ${HEALTHY.low.pass}/${HEALTHY.medium.pass}/${HEALTHY.high.pass} with pass scores ${HEALTHY.high.passScore.join("–")} for high quality (testnet passes scored 87–100); failed work scores ${a.scenario.failScore.join("–")} and mints nothing.`,
    "",
    "## Results",
    "",
  );
  for (const r of results) out.push(renderScenario(r));
  const ratioA = Number(a.supplyRaw) / Number(a.paidOutYocto / 10n ** 21n || 1n) / 1e16;
  out.push(
    "## Takeaways",
    "",
    `1. **Supply grows only with verified work.** In every scenario, HIVE supply equals the sum of mints over passed bounties (${a.passes.length} in A, ${c.passes.length} in C); days with no passes add nothing.`,
    `2. **Failures mint 0 and money goes back.** Scenario C had ${c.failedVerifications} failed verifications and ${c.cancelled} cancelled bounties: they minted 0 HIVE and ${near(c.refundedYocto)} NEAR was refunded to the treasury. C ends with ${hive(c.supplyRaw)} HIVE vs ${hive(a.supplyRaw)} in A under the same demand.`,
    `3. **Supply is bounded by treasury spend.** HIVE ≤ paid-out milliNEAR × mint_rate, i.e. at most 10 HIVE per NEAR actually paid for verified work. In A, ${near(a.paidOutYocto)} NEAR paid → ${hive(a.supplyRaw)} HIVE (${ratioA.toFixed(2)}× the per-NEAR ceiling).`,
    `4. **Funding is not minting.** D is A plus a 20 NEAR deposit on day 30. The deposit itself minted nothing: D ends with ${hive(d.supplyRaw)} HIVE vs ${hive(a.supplyRaw)} in A. The only difference (${hive(d.supplyRaw - a.supplyRaw)} HIVE) comes from ${d.passes.length - a.passes.length} extra bounties that A had to skip for lack of funds (A skipped ${a.checkpoints.at(-1)!.skippedNoFunds}, D skipped ${d.checkpoints.at(-1)!.skippedNoFunds}) and that were then actually completed and verified. Most of the 20 NEAR (${near(d.checkpoints.at(-1)!.treasury.available)} NEAR) is still sitting unspent in the treasury.`,
    `5. **Quality-weighting cuts mint for mediocre work.** The score factor withheld ${hive(a.maxSupplyAtScore100 - a.supplyRaw)} HIVE in A and ${hive(c.maxSupplyAtScore100 - c.supplyRaw)} HIVE in C compared with score-100 work for the same payouts.`,
    "",
    "## What this does not model",
    "",
    "- **No decay or burn.** Inactivity decay is not built (cut from scope), so supply never shrinks.",
    "- **Owner admin keys exist.** The hub owner can call `set_mint_rate` and the token owner can call `set_minter`; the simulation assumes neither is used. Freezing/renouncing them is future work.",
    "- **No market for HIVE.** There is no price, trading, demand or speculation — this is a supply mechanic only.",
    "- **Verification outcomes are drawn, not computed.** Real deliverables, tests and LLM rubric scores are replaced with seeded draws; selection, pricing, escrow, refunds and minting are the real rules.",
    "- **Single coordinator and verifier, three workers, no forger.** Gas and storage costs, RPC failures and mint-callback failures are not simulated.",
    "",
  );
  return out.join("\n");
}

export async function runAll(): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  for (const sc of SCENARIOS) results.push(await runScenario(sc));
  return results;
}

// re-export so tests can check the formula directly
export { mintAmount };

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const results = await runAll();
  const md = renderReport(results);
  if (process.argv.includes("--write")) {
    const out = path.join(ROOT, "docs", "HIVE_SIMULATION.md");
    fs.writeFileSync(out, md);
    console.error(`wrote ${path.relative(ROOT, out)}`);
  }
  process.stdout.write(md);
}
