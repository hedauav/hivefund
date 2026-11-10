// Generates web/fixtures/: a self-consistent mock market run the dashboard can
// render before the contracts are deployed. Hashes are real hashJson() values, so
// the "recomputed hash" checks in the UI pass. Replaced by data/sample/ once
// Stream B's mock demo writes it.
//
//   npm -w web run fixture
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  canonicalize,
  hashJson,
  mintAmount,
  bidUnits,
  DEFAULT_MINT_RATE,
  DEFAULT_SELECTION_WEIGHTS,
  bidPayload,
  type ActivityEntry,
  type ActivityKind,
  type Bid,
  type Bounty,
  type BountySpec,
  type Deliverable,
  type SelectionRationale,
  type StrategyChange,
  type SupplyPoint,
  type VerificationReport,
  type WorkerView,
} from "@hivefund/shared";

const OUT = path.join(import.meta.dirname, "..", "fixtures");
const ROOT = "hivefund-2026.testnet";
const HUB = `hub.${ROOT}`;
const TOKEN = `hive.${ROOT}`;
const COORD = `coordinator.${ROOT}`;
const VERIFIER = `verifier.${ROOT}`;
const W = {
  cheap: `cheap.${ROOT}`,
  quality: `quality.${ROOT}`,
  adaptive: `adaptive.${ROOT}`,
  forger: `forger.${ROOT}`,
};
const NEAR = 10n ** 24n;
const near = (x: number) => ((BigInt(Math.round(x * 1000)) * NEAR) / 1000n).toString();
const T0 = Date.UTC(2026, 10, 10, 4, 0, 0);
let clock = T0;
let height = 214_500_000;
const tick = (ms = 2000) => {
  clock += ms;
  height += Math.max(1, Math.round(ms / 1000));
  return clock;
};

// ---------- off-chain store ----------
const offchain: Record<string, unknown> = {};
const index: { hash: string; kind: string; bounty_id?: number; round?: number; actor: string; ts_ms: number }[] = [];
function put(obj: unknown, meta: { kind: string; bounty_id?: number; round?: number; actor: string }) {
  const h = hashJson(obj);
  offchain[h] = obj;
  index.push({ hash: h, ...meta, ts_ms: clock });
  return h;
}
const txs: { ts: number; actor: string; method: string; args?: unknown; txHash: string }[] = [];
let txn = 0;
function tx(actor: string, method: string, args?: unknown) {
  const h = fakeTxHash(`${actor}:${method}:${txn++}`);
  txs.push({ ts: clock, actor, method, args, txHash: h });
  return h;
}
function fakeTxHash(seed: string) {
  // base58-looking deterministic hash for links (mock only)
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const hex = hashJson(seed);
  let out = "";
  for (let i = 0; i < 44; i++) out += alphabet[parseInt(hex.slice((i * 2) % 62, ((i * 2) % 62) + 2), 16) % 58];
  return out;
}

// ---------- chain state ----------
const activity: ActivityEntry[] = [];
function log(actor: string, kind: ActivityKind, detail: string, extra: Partial<ActivityEntry> = {}) {
  activity.push({
    id: activity.length,
    ts_ms: clock,
    block_height: height,
    actor,
    kind,
    bounty_id: null,
    bid_id: null,
    amount: null,
    detail,
    ...extra,
  });
}
const treasury = {
  spend_cap: near(20),
  committed_total: 0n,
  funded_total: 0n,
  available: 0n,
  escrowed: 0n,
  paid_out: 0n,
  refunded_total: 0n,
};
const workers: Record<string, WorkerView> = {};
function addWorker(acct: string, tier: number) {
  workers[acct] = {
    account_id: acct,
    tier,
    signing_pk: "ed25519:" + fakeTxHash("pk" + acct),
    active: true,
    completed: 0,
    failed: 0,
    total_score: 0,
    earned_yocto: "0",
    hive_earned: "0",
    reputation: 0,
  };
  log(ROOT, "WorkerAdded", `${acct} registered at tier ${tier}`);
}
const rep = (w: WorkerView) => Math.max(0, w.completed * 10 + Math.floor(w.total_score / 10) - w.failed * 15);
const bounties: Bounty[] = [];
const bids: Bid[] = [];
const supply: SupplyPoint[] = [];
let totalMinted = 0n;

const margins: Record<string, number> = { [W.cheap]: 0.05, [W.quality]: 0.35, [W.adaptive]: 0.2, [W.forger]: 0.0 };
const speed: Record<string, number> = { [W.cheap]: 1.6, [W.quality]: 0.7, [W.adaptive]: 1.0, [W.forger]: 1.0 };
const strategy: Record<string, StrategyChange[]> = { [W.adaptive]: [] };
const outcomes: ("win" | "loss" | "fail")[] = [];

function postBounty(spec: BountySpec): Bounty {
  tick(4000);
  const specHash = put(spec, { kind: "spec", actor: COORD });
  const b: Bounty = {
    id: bounties.length,
    title: spec.title,
    spec_hash: specHash,
    poster: COORD,
    budget_yocto: spec.budget_yocto,
    deadline_ms: clock + spec.deadline_minutes * 60_000,
    min_tier: spec.min_tier,
    status: "Open",
    round: 0,
    attempts: 0,
    bid_ids: [],
    winner_bid_id: null,
    deliverable_hash: null,
    check_results_hash: null,
    score: null,
    excluded: [],
    created_ms: clock,
    updated_ms: clock,
    hive_minted: "0",
  };
  bounties.push(b);
  const budget = BigInt(spec.budget_yocto);
  treasury.available -= budget;
  treasury.escrowed += budget;
  treasury.committed_total += budget;
  tx(COORD, "post_bounty", { title: spec.title, spec_hash: specHash, budget_yocto: spec.budget_yocto });
  log(COORD, "BountyPosted", `"${spec.title}" posted, budget ${Number(budget * 1000n / NEAR) / 1000} NEAR`, {
    bounty_id: b.id,
    amount: spec.budget_yocto,
  });
  return b;
}

function placeBid(b: Bounty, worker: string, complexity: number, opts: { forged?: boolean } = {}): Bid {
  tick(1500);
  const budget = Number(BigInt(b.budget_yocto) / 10n ** 21n) / 1000;
  const price = near(budget * complexity * (1 + margins[worker]));
  const eta = Math.round(3_600_000 * speed[worker]);
  const w = workers[worker];
  const payload = bidPayload({ bounty_id: b.id, contract: HUB, eta_ms: eta, price_yocto: price, round: b.round, worker });
  let status: Bid["status"] = "Pending";
  let reason: string | null = null;
  if (BigInt(price) > BigInt(b.budget_yocto)) reason = "price exceeds budget";
  else if (w.tier < b.min_tier) reason = "tier below min_tier";
  else if (b.excluded.includes(worker)) reason = "worker excluded";
  if (reason) status = "Rejected";
  const bid: Bid = {
    id: bids.length,
    bounty_id: b.id,
    round: b.round,
    worker,
    tier: w.tier,
    price_yocto: price,
    eta_ms: eta,
    signature: "ed25519:" + fakeTxHash((opts.forged ? "forged" : "sig") + payload),
    signed_payload: payload,
    status,
    reject_reason: reason,
    created_ms: clock,
  };
  bids.push(bid);
  b.bid_ids.push(bid.id);
  tx(worker, "place_bid", { bounty_id: b.id, price_yocto: price, eta_ms: eta });
  if (reason) {
    log(worker, "BidRejected", `bid #${bid.id} rejected: ${reason}`, { bounty_id: b.id, bid_id: bid.id, amount: price });
  } else {
    if (b.status === "Open") b.status = "Bidding";
    log(worker, "BidPlaced", `bid #${bid.id} at ${Number(BigInt(price) / 10n ** 21n) / 1000} NEAR, eta ${Math.round(eta / 60000)}m`, {
      bounty_id: b.id,
      bid_id: bid.id,
      amount: price,
    });
  }
  return bid;
}

function select(b: Bounty, forged: Set<number>) {
  tick(3000);
  const roundBids = bids.filter((x) => x.bounty_id === b.id && x.round === b.round && x.status === "Pending");
  const rejected: SelectionRationale["rejected"] = [];
  for (const x of roundBids.filter((x) => forged.has(x.id))) {
    x.status = "Rejected";
    x.reject_reason = "invalid bid signature";
    rejected.push({ bid_id: x.id, reason: "invalid bid signature" });
    tx(COORD, "reject_bid", { bounty_id: b.id, bid_id: x.id, reason: "invalid bid signature" });
    log(COORD, "BidRejected", `bid #${x.id} from ${x.worker} rejected: invalid bid signature`, { bounty_id: b.id, bid_id: x.id });
  }
  const valid = roundBids.filter((x) => !forged.has(x.id));
  const budget = Number(BigInt(b.budget_yocto));
  const maxEta = Math.max(...valid.map((x) => x.eta_ms));
  const maxRep = Math.max(1, ...valid.map((x) => rep(workers[x.worker])));
  const wts = DEFAULT_SELECTION_WEIGHTS;
  const candidates = roundBids.map((x) => {
    const sigValid = !forged.has(x.id);
    const r = rep(workers[x.worker]);
    const score = sigValid
      ? wts.price * (1 - Number(x.price_yocto) / budget) + wts.eta * (1 - x.eta_ms / (maxEta * 1.25)) + wts.reputation * (r / maxRep)
      : 0;
    return { bid_id: x.id, worker: x.worker, price_yocto: x.price_yocto, eta_ms: x.eta_ms, reputation: r, sig_valid: sigValid, score: Math.round(score * 1000) / 1000 };
  });
  const winner = candidates.filter((c) => c.sig_valid).sort((a, z) => z.score - a.score || Number(BigInt(a.price_yocto) - BigInt(z.price_yocto)))[0];
  const rationale: SelectionRationale = { bounty_id: b.id, round: b.round, weights: wts, candidates, winner_bid_id: winner.bid_id, rejected };
  put(rationale, { kind: "selection", bounty_id: b.id, round: b.round, actor: COORD });
  for (const x of valid) x.status = x.id === winner.bid_id ? "Won" : "Lost";
  b.winner_bid_id = winner.bid_id;
  b.status = "InProgress";
  b.updated_ms = clock;
  tx(COORD, "select_winner", { bounty_id: b.id, bid_id: winner.bid_id });
  log(COORD, "WinnerSelected", `bid #${winner.bid_id} (${winner.worker}) selected, score ${winner.score}`, { bounty_id: b.id, bid_id: winner.bid_id });
  for (const x of valid) {
    if (x.worker === W.adaptive) adapt(x.id === winner.bid_id ? "win" : "loss", b.id);
  }
  return bids[winner.bid_id];
}

function adapt(outcome: "win" | "loss" | "fail", bountyId: number) {
  outcomes.push(outcome);
  if (outcomes.length > 5) outcomes.shift();
  const old = margins[W.adaptive];
  let next = old;
  let reason = "";
  if (outcome === "win") {
    next = Math.min(0.5, old + 0.05);
    reason = `won bounty #${bountyId}: raising margin +0.05 to test pricing power`;
  } else if (outcome === "loss") {
    next = Math.max(0.05, old - 0.04);
    reason = `lost bounty #${bountyId} on price: cutting margin -0.04`;
  } else {
    reason = `verification failed on bounty #${bountyId}: switching deliverable quality medium -> high`;
  }
  next = Math.round(next * 100) / 100;
  margins[W.adaptive] = next;
  strategy[W.adaptive].push({ ts_ms: clock, worker: W.adaptive, bounty_id: bountyId, old_margin: old, new_margin: next, reason, window: [...outcomes] });
}

function submit(b: Bounty, bid: Bid, deliverable: Deliverable) {
  tick(bid.eta_ms / 120);
  const h = put(deliverable, { kind: "deliverable", bounty_id: b.id, round: b.round, actor: bid.worker });
  b.deliverable_hash = h;
  b.status = "Verifying";
  b.updated_ms = clock;
  tx(bid.worker, "submit_work", { bounty_id: b.id, deliverable_hash: h });
  log(bid.worker, "WorkSubmitted", `deliverable ${h.slice(0, 10)}… submitted`, { bounty_id: b.id, bid_id: bid.id });
}

function verify(b: Bounty, bid: Bid, report: Omit<VerificationReport, "spec_hash" | "deliverable_hash" | "created_ms" | "verifier" | "bounty_id" | "round" | "worker">) {
  tick(5000);
  const full: VerificationReport = {
    bounty_id: b.id,
    round: b.round,
    worker: bid.worker,
    spec_hash: b.spec_hash,
    deliverable_hash: b.deliverable_hash!,
    verifier: VERIFIER,
    created_ms: clock,
    ...report,
  };
  const h = put(full, { kind: "report", bounty_id: b.id, round: b.round, actor: VERIFIER });
  b.check_results_hash = h;
  b.score = full.score;
  b.updated_ms = clock;
  tx(VERIFIER, "verify_bounty", { bounty_id: b.id, passed: full.passed, score: full.score, check_results_hash: h });
  const w = workers[bid.worker];
  const budget = BigInt(b.budget_yocto);
  if (full.passed) {
    bid.status = "Paid";
    b.status = "Completed";
    const price = BigInt(bid.price_yocto);
    treasury.escrowed -= budget;
    treasury.paid_out += price;
    treasury.available += budget - price;
    w.completed += 1;
    w.total_score += full.score;
    w.earned_yocto = (BigInt(w.earned_yocto) + price).toString();
    log(VERIFIER, "VerificationPassed", `passed with score ${full.score}; report ${h.slice(0, 10)}…`, { bounty_id: b.id, bid_id: bid.id });
    log(HUB, "Payout", `paid ${bid.worker} ${Number(price / 10n ** 21n) / 1000} NEAR`, { bounty_id: b.id, bid_id: bid.id, amount: bid.price_yocto });
    tick(1000);
    const amount = mintAmount(bid.price_yocto, full.score, DEFAULT_MINT_RATE);
    totalMinted += amount;
    supply.push({
      id: supply.length,
      ts_ms: clock,
      block_height: height,
      bounty_id: b.id,
      recipient: bid.worker,
      bid_units: bidUnits(bid.price_yocto).toString(),
      score: full.score,
      mint_rate: DEFAULT_MINT_RATE.toString(),
      amount: amount.toString(),
      total_minted_after: totalMinted.toString(),
    });
    b.hive_minted = amount.toString();
    w.hive_earned = (BigInt(w.hive_earned) + amount).toString();
    log(HUB, "Mint", `minted ${Number(amount / 10n ** 14n) / 10000} HIVE to ${bid.worker}`, { bounty_id: b.id, bid_id: bid.id, amount: amount.toString() });
  } else {
    bid.status = "Failed";
    b.excluded.push(bid.worker);
    w.failed += 1;
    b.attempts += 1;
    log(VERIFIER, "VerificationFailed", `failed (${full.checks.filter((c) => !c.passed && !c.skipped).map((c) => c.id).join(", ")}); report ${h.slice(0, 10)}…`, { bounty_id: b.id, bid_id: bid.id });
    if (b.attempts >= 2) {
      b.status = "Cancelled";
      treasury.escrowed -= budget;
      treasury.available += budget;
      treasury.refunded_total += budget;
      log(HUB, "TreasuryRefund", "escrow returned to treasury", { bounty_id: b.id, amount: b.budget_yocto });
      log(HUB, "BountyCancelled", "cancelled after 2 failed verifications", { bounty_id: b.id });
    } else {
      b.round += 1;
      for (const x of bids) if (x.bounty_id === b.id && x.status === "Pending") x.status = "Superseded";
      b.status = "Open";
      b.winner_bid_id = null;
      log(HUB, "BountyReopened", `reopened for round ${b.round}; ${bid.worker} excluded`, { bounty_id: b.id });
    }
    if (bid.worker === W.adaptive) adapt("fail", b.id);
  }
  for (const k of Object.keys(workers)) workers[k].reputation = rep(workers[k]);
}

// ---------- scenario ----------
function run() {
  log(ROOT, "RoleChanged", `coordinator set to ${COORD}`);
  log(ROOT, "RoleChanged", `verifier set to ${VERIFIER}`);
  addWorker(W.cheap, 1);
  addWorker(W.adaptive, 2);
  addWorker(W.quality, 3);
  addWorker(W.forger, 1);
  tick(5000);
  treasury.funded_total += BigInt(near(5));
  treasury.available += BigInt(near(5));
  tx(ROOT, "fund_treasury");
  log(ROOT, "TreasuryFunded", "community funded 5 NEAR", { amount: near(5) });

  const slugSpec: BountySpec = {
    version: 1,
    title: "slugify(): unicode-safe URL slugs",
    description: "Implement slugify(input) that lowercases, strips diacritics, collapses separators and handles unicode and emoji input.",
    deliverable_schema: {
      type: "object",
      required: ["function_name", "language"],
      properties: { function_name: { const: "slugify" }, language: { enum: ["javascript", "typescript"] } },
    },
    required_sections: ["summary", "approach", "edge_cases"],
    test: { runner: "node", file: "slugify/test.mjs", timeout_ms: 10_000 },
    rubric: {
      criteria: [
        { id: "clarity", description: "Code and docs are clear and idiomatic", weight: 0.4 },
        { id: "edge_cases", description: "Edge cases are enumerated and handled", weight: 0.6 },
      ],
      pass_threshold: 70,
    },
    budget_yocto: near(1),
    min_tier: 1,
    deadline_minutes: 180,
  };
  const reportSpec: BountySpec = {
    version: 1,
    title: "NEAR testnet activity brief (last 24h)",
    description: "Summarise testnet activity for community readers with three sourced metrics.",
    deliverable_schema: {
      type: "object",
      required: ["metrics"],
      properties: { metrics: { type: "array", minItems: 3, items: { type: "object", required: ["name", "value", "source"] } } },
    },
    required_sections: ["summary", "metrics", "sources"],
    test: null,
    rubric: {
      criteria: [
        { id: "accuracy", description: "Metrics are sourced and plausible", weight: 0.5 },
        { id: "readability", description: "Readable by a non-technical community member", weight: 0.5 },
      ],
      pass_threshold: 75,
    },
    budget_yocto: near(1.5),
    min_tier: 2,
    deadline_minutes: 240,
  };
  const daoSpec: BountySpec = {
    version: 1,
    title: "Explain HIVE decay in 150 words",
    description: "Write a plain-language explainer of the HIVE inactivity decay rule for the community page.",
    deliverable_schema: { type: "object", required: ["word_count"], properties: { word_count: { type: "integer", maximum: 160 } } },
    required_sections: ["explainer"],
    test: null,
    rubric: { criteria: [{ id: "clarity", description: "Accurate and plain", weight: 1 }], pass_threshold: 70 },
    budget_yocto: near(0.8),
    min_tier: 1,
    deadline_minutes: 120,
  };

  // Bounty 0: cheap wins on price, fails the unicode test; reopens; adaptive wins round 1.
  const b0 = postBounty(slugSpec);
  const b1 = postBounty(reportSpec);
  const forged = new Set<number>();
  placeBid(b0, W.cheap, 0.4);
  placeBid(b0, W.quality, 0.6);
  placeBid(b0, W.adaptive, 0.5);
  forged.add(placeBid(b0, W.forger, 0.3, { forged: true }).id);
  const w0 = select(b0, forged);
  submit(b0, w0, {
    bounty_id: b0.id,
    round: 0,
    worker: w0.worker,
    sections: { summary: "Basic slugify.", approach: "lowercase + replace spaces with dashes", edge_cases: "none" },
    data: { function_name: "slugify", language: "javascript" },
    code: { "slugify.mjs": "export function slugify(s){return s.toLowerCase().replace(/\\s+/g,'-')}" },
  });
  verify(b0, w0, {
    checks: [
      { id: "schema", passed: true, details: "data matches deliverable_schema", duration_ms: 3 },
      { id: "sections", passed: true, details: "summary, approach, edge_cases present", duration_ms: 1 },
      { id: "test", passed: false, details: "slugify/test.mjs: 3/7 cases failed (\"Crème Brûlée\" -> expected \"creme-brulee\", got \"crème-brûlée\")", duration_ms: 412 },
      { id: "rubric", passed: false, skipped: true, details: "skipped: automated checks failed", duration_ms: 0 },
    ],
    rubric: null,
    passed: false,
    score: 0,
  });

  placeBid(b0, W.quality, 0.6);
  placeBid(b0, W.adaptive, 0.5);
  placeBid(b0, W.cheap, 0.4); // excluded -> rejected
  const w0b = select(b0, new Set());
  submit(b0, w0b, {
    bounty_id: b0.id,
    round: 1,
    worker: w0b.worker,
    sections: {
      summary: "Unicode-safe slugify with NFKD normalisation.",
      approach: "NFKD normalise, strip combining marks, map non-alphanumerics to '-', collapse and trim dashes.",
      edge_cases: "Diacritics, emoji, consecutive separators, leading/trailing punctuation, empty input, CJK passthrough.",
    },
    data: { function_name: "slugify", language: "typescript" },
    code: { "slugify.mjs": "export function slugify(s){return s.normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().replace(/[^\\p{L}\\p{N}]+/gu,'-').replace(/^-+|-+$/g,'')}" },
  });
  verify(b0, w0b, {
    checks: [
      { id: "schema", passed: true, details: "data matches deliverable_schema", duration_ms: 2 },
      { id: "sections", passed: true, details: "summary, approach, edge_cases present", duration_ms: 1 },
      { id: "test", passed: true, details: "slugify/test.mjs: 7/7 cases passed", duration_ms: 388 },
      { id: "rubric", passed: true, details: "weighted rubric 86 >= threshold 70", duration_ms: 1840 },
    ],
    rubric: {
      mode: "fallback",
      model: null,
      scores: [
        { criterion: "clarity", score: 80, rationale: "approach section names each transform step" },
        { criterion: "edge_cases", score: 90, rationale: "6 of 6 expected edge-case keywords covered" },
      ],
      total: 86,
      threshold: 70,
    },
    passed: true,
    score: 86,
  });

  // Bounty 1: tier-gated; cheap rejected on tier.
  placeBid(b1, W.cheap, 0.4);
  placeBid(b1, W.quality, 0.55);
  placeBid(b1, W.adaptive, 0.5);
  const w1 = select(b1, new Set());
  submit(b1, w1, {
    bounty_id: b1.id,
    round: 0,
    worker: w1.worker,
    sections: {
      summary: "Testnet saw steady contract activity with a spike in FT transfers.",
      metrics: "transactions: 1.92M; active accounts: 41.3k; new contracts: 212",
      sources: "nearblocks testnet stats API; fastnear RPC",
    },
    data: {
      metrics: [
        { name: "transactions_24h", value: 1920000, source: "nearblocks" },
        { name: "active_accounts_24h", value: 41300, source: "nearblocks" },
        { name: "new_contracts_24h", value: 212, source: "fastnear" },
      ],
    },
  });
  verify(b1, w1, {
    checks: [
      { id: "schema", passed: true, details: "data matches deliverable_schema", duration_ms: 2 },
      { id: "sections", passed: true, details: "summary, metrics, sources present", duration_ms: 1 },
      { id: "test", passed: true, skipped: true, details: "no test command in spec", duration_ms: 0 },
      { id: "rubric", passed: true, details: "weighted rubric 91 >= threshold 75", duration_ms: 2210 },
    ],
    rubric: {
      mode: "llm",
      model: "z-ai/glm-5.3-flash",
      scores: [
        { criterion: "accuracy", score: 88, rationale: "all three metrics cite a source" },
        { criterion: "readability", score: 94, rationale: "short, jargon-free summary" },
      ],
      total: 91,
      threshold: 75,
    },
    passed: true,
    score: 91,
  });

  // Bounty 2: still in bidding.
  const b2 = postBounty(daoSpec);
  placeBid(b2, W.cheap, 0.45);
  placeBid(b2, W.adaptive, 0.5);
}

run();

const snapshot = {
  source: "fixture",
  generated_ms: clock,
  config: {
    owner: ROOT,
    coordinator: COORD,
    verifier: VERIFIER,
    hive_token: TOKEN,
    mint_rate: DEFAULT_MINT_RATE.toString(),
    total_minted: totalMinted.toString(),
    version: "0.1.0",
  },
  bounties,
  bids,
  treasury: Object.fromEntries(Object.entries(treasury).map(([k, v]) => [k, v.toString()])),
  reputation: Object.values(workers),
  activity,
  supply,
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(path.join(OUT, "offchain"), { recursive: true });
mkdirSync(path.join(OUT, "strategy"), { recursive: true });
writeFileSync(path.join(OUT, "chain-snapshot.json"), JSON.stringify(snapshot, null, 2));
for (const [h, obj] of Object.entries(offchain)) writeFileSync(path.join(OUT, "offchain", `${h}.json`), canonicalize(obj));
writeFileSync(path.join(OUT, "index.jsonl"), index.map((e) => JSON.stringify(e)).join("\n") + "\n");
writeFileSync(path.join(OUT, "tx.jsonl"), txs.map((e) => JSON.stringify(e)).join("\n") + "\n");
for (const [w, list] of Object.entries(strategy)) {
  writeFileSync(path.join(OUT, "strategy", `${w}.jsonl`), list.map((e) => JSON.stringify(e)).join("\n") + (list.length ? "\n" : ""));
}
console.log(`fixture: ${bounties.length} bounties, ${bids.length} bids, ${supply.length} mints, ${Object.keys(offchain).length} off-chain objects -> ${OUT}`);
