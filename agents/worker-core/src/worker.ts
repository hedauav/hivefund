// A worker agent. Each tick it reads the market from the hub contract, learns from the outcomes of
// its own bids, decides independently whether to bid on each open bounty, and delivers work for the
// bounties it won. Nothing here knows (or decides) who wins: the coordinator does that on-chain.
import { bidPayload, signBid } from "@hivefund/shared";
import type { Bid, BidStatus, Bounty, BountySpec, CatalogSource, Outcome, StrategyChange } from "@hivefund/shared";
import { canProduce, generateDeliverable, type GenerationMode } from "./generate.ts";
import type { HubLike, LlmClient, StoreLike } from "./ports.ts";
import { quote, type Quality } from "./pricing.ts";
import { AdaptiveStrategy, StaticStrategy, type Strategy } from "./strategy.ts";

export interface WorkerProfile {
  /** short name, e.g. "cheap" */
  name: string;
  /** must match the tier the owner registered on-chain with add_worker */
  tier: 1 | 2 | 3;
  margin: number;
  /** eta multiplier: >1 slower, <1 faster */
  speed: number;
  quality: Quality;
  /** present => adaptive strategy with these margin bounds */
  adaptive?: { minMargin: number; maxMargin: number };
}

export interface WorkerOptions {
  accountId: string;
  /** hub contract account id (part of the signed bid payload) */
  contract: string;
  /** ed25519 bid-signing secret key ("ed25519:..."); its public key is registered via add_worker */
  bidKey: string;
  profile: WorkerProfile;
  /** NEAR AI Cloud client; null => template fallback only */
  llm?: LlmClient | null;
  bountiesDir?: string;
  /** procurement bounties: catalog fetcher (default live fetch; mock mode passes the recorded fixture) */
  catalog?: CatalogSource;
  /** compute floor per job in yoctoNEAR (default 0: no fixed minimum price) */
  minCostYocto?: bigint;
  now?: () => number;
  log?: (msg: string) => void;
}

export interface TickReport {
  worker: string;
  bids: { bounty_id: number; round: number; bid_id: unknown; price_yocto: string; eta_ms: number; txHash: string }[];
  skips: { bounty_id: number; round: number; reason: string }[];
  submissions: {
    bounty_id: number;
    round: number;
    deliverable_hash: string;
    mode: GenerationMode;
    model: string | null;
    note?: string;
    txHash: string;
  }[];
  outcomes: { bounty_id: number; bid_id: number; outcome: Outcome }[];
  strategyChanges: StrategyChange[];
  errors: { bounty_id: number; action: string; message: string }[];
}

/** gas for worker calls; agent function-call keys carry only a 0.05 NEAR allowance */
export const WORKER_CALL_GAS_TGAS = 30;

const OUTCOME_OF: Partial<Record<BidStatus, Outcome>> = { Won: "win", Lost: "loss", Failed: "fail" };

export class Worker {
  readonly accountId: string;
  readonly profile: WorkerProfile;
  readonly strategy: Strategy;
  private readonly o: WorkerOptions;
  private readonly llm: LlmClient | null;
  private readonly now: () => number;
  private readonly seen = new Map<number, BidStatus>();
  private readonly submitted = new Set<string>();
  private readonly specs = new Map<string, BountySpec>();

  constructor(o: WorkerOptions) {
    this.o = o;
    this.accountId = o.accountId;
    this.profile = o.profile;
    this.llm = o.llm ?? null;
    this.now = o.now ?? Date.now;
    this.strategy = o.profile.adaptive
      ? new AdaptiveStrategy({
          worker: o.accountId,
          initialMargin: o.profile.margin,
          minMargin: o.profile.adaptive.minMargin,
          maxMargin: o.profile.adaptive.maxMargin,
          initialQuality: o.profile.quality,
          now: this.now,
        })
      : new StaticStrategy(o.profile.margin, o.profile.quality);
  }

  private log(msg: string): void {
    this.o.log?.(`[${this.profile.name}] ${msg}`);
  }

  private async spec(store: StoreLike, hash: string): Promise<BountySpec> {
    let s = this.specs.get(hash);
    if (!s) {
      s = (await store.get(hash)) as BountySpec;
      this.specs.set(hash, s);
    }
    return s;
  }

  async tick(hub: HubLike, store: StoreLike): Promise<TickReport> {
    const r: TickReport = {
      worker: this.accountId,
      bids: [],
      skips: [],
      submissions: [],
      outcomes: [],
      strategyChanges: [],
      errors: [],
    };
    const bounties = await hub.view<Bounty[]>("get_bounties", { from_index: 0, limit: 100 });
    const bidsBy = new Map<number, Bid[]>();
    for (const b of bounties) bidsBy.set(b.id, await hub.view<Bid[]>("get_bids", { bounty_id: b.id }));

    // 1) Learn from outcomes first so this tick's bids already reflect them.
    for (const b of bounties) {
      for (const bid of bidsBy.get(b.id)!) {
        if (bid.worker !== this.accountId) continue;
        if (this.seen.get(bid.id) === bid.status) continue;
        this.seen.set(bid.id, bid.status);
        const outcome = OUTCOME_OF[bid.status];
        if (!outcome) continue;
        r.outcomes.push({ bounty_id: b.id, bid_id: bid.id, outcome });
        for (const c of this.strategy.onOutcome(outcome, b.id)) await this.recordChange(store, c, r);
      }
    }

    // 2) Deliver work we won, 3) bid on open bounties.
    for (const b of bounties) {
      const bids = bidsBy.get(b.id)!;
      try {
        if (b.status === "InProgress") await this.maybeSubmit(hub, store, b, bids, r);
        else if (b.status === "Open" || b.status === "Bidding") await this.maybeBid(hub, store, b, bids, r);
      } catch (e) {
        const message = (e as Error).message;
        r.errors.push({ bounty_id: b.id, action: b.status === "InProgress" ? "submit_work" : "place_bid", message });
        this.log(`bounty #${b.id}: ${message}`);
      }
    }
    return r;
  }

  private async recordChange(store: StoreLike, c: StrategyChange, r: TickReport): Promise<void> {
    r.strategyChanges.push(c);
    this.log(`strategy: margin ${c.old_margin} -> ${c.new_margin}: ${c.reason}`);
    await store.appendStrategy?.(this.accountId, c);
  }

  private skip(r: TickReport, b: Bounty, reason: string): void {
    r.skips.push({ bounty_id: b.id, round: b.round, reason });
  }

  private async maybeBid(hub: HubLike, store: StoreLike, b: Bounty, bids: Bid[], r: TickReport): Promise<void> {
    if (bids.some((x) => x.worker === this.accountId && x.round === b.round)) return; // already bid this round
    if (b.excluded.includes(this.accountId)) return this.skip(r, b, "excluded after failed delivery");
    if (this.profile.tier < b.min_tier) return this.skip(r, b, `tier ${this.profile.tier} below min_tier ${b.min_tier}`);
    if (b.deadline_ms <= this.now()) return this.skip(r, b, "deadline passed");

    const spec = await this.spec(store, b.spec_hash);
    if (!canProduce(spec, this.llm)) return this.skip(r, b, "cannot produce this deliverable type without an LLM");

    const budget = BigInt(b.budget_yocto);
    let q = quote(spec, budget, this.strategy.margin, this.strategy.quality, this.profile.speed, this.o.minCostYocto);
    if (q.expectedProfit < 0n) {
      const c = this.strategy.onUnprofitable(b.id);
      if (c) {
        await this.recordChange(store, c, r);
        q = quote(spec, budget, this.strategy.margin, this.strategy.quality, this.profile.speed, this.o.minCostYocto);
      }
      if (q.expectedProfit < 0n) return this.skip(r, b, "expected profit is negative at this budget");
    }
    if (q.price <= 0n) return this.skip(r, b, "budget too small to price");
    if (q.price > budget) return this.skip(r, b, "price would exceed budget");

    const payload = bidPayload({
      bounty_id: b.id,
      contract: this.o.contract,
      eta_ms: q.etaMs,
      price_yocto: q.price.toString(),
      round: b.round,
      worker: this.accountId,
    });
    const signature = signBid(payload, this.o.bidKey);
    const res = await hub.call("place_bid", {
      bounty_id: b.id,
      price_yocto: q.price.toString(),
      eta_ms: q.etaMs,
      signature,
    }, { gasTGas: WORKER_CALL_GAS_TGAS });
    r.bids.push({ bounty_id: b.id, round: b.round, bid_id: res.result, price_yocto: q.price.toString(), eta_ms: q.etaMs, txHash: res.txHash });
    this.log(`bid on #${b.id} r${b.round}: price ${q.price} yocto, eta ${q.etaMs} ms, margin ${this.strategy.margin}`);
  }

  private async maybeSubmit(hub: HubLike, store: StoreLike, b: Bounty, bids: Bid[], r: TickReport): Promise<void> {
    const winner = bids.find((x) => x.id === b.winner_bid_id);
    if (!winner || winner.worker !== this.accountId) return;
    const key = `${b.id}:${b.round}`;
    if (this.submitted.has(key)) return;

    const spec = await this.spec(store, b.spec_hash);
    const g = await generateDeliverable(spec, {
      bountyId: b.id,
      round: b.round,
      worker: this.accountId,
      quality: this.strategy.quality,
      llm: this.llm,
      bountiesDir: this.o.bountiesDir,
      catalog: this.o.catalog,
      now: this.o.now,
    });
    const hash = await store.put(g.deliverable, { kind: "deliverable", bounty_id: b.id, round: b.round, actor: this.accountId });
    const res = await hub.call(
      "submit_work",
      { bounty_id: b.id, deliverable_hash: hash },
      { gasTGas: WORKER_CALL_GAS_TGAS },
    );
    this.submitted.add(key);
    r.submissions.push({
      bounty_id: b.id,
      round: b.round,
      deliverable_hash: hash,
      mode: g.mode,
      model: g.model,
      note: g.note,
      txHash: res.txHash,
    });
    this.log(`submitted #${b.id} r${b.round} (${g.mode}${g.model ? ` ${g.model}` : ""}${g.note ? `; ${g.note}` : ""}) -> ${hash.slice(0, 12)}…`);
  }
}
