// MockChain: an in-memory TypeScript port of the bounty-hub + hive-token contracts (docs/PLAN.md §2).
// FOR UNIT TESTS AND OFFLINE DEVELOPMENT ONLY. The demo of record runs against testnet (NearHubClient).
// Same method names, JSON args, ERR_* panic strings, non-panicking bid rejections, treasury + mint math.
import type {
  AccountId,
  ActivityEntry,
  ActivityKind,
  Bid,
  BidRejectReason,
  Bounty,
  HubConfig,
  PendingMint,
  SupplyPoint,
  Treasury,
  WorkerInfo,
  WorkerView,
} from "../types.ts";
import { isHash } from "../canonical.ts";
import { bidPayload } from "../bid.ts";
import { YOCTO_PER_MILLINEAR } from "../mint.ts";
import type { CallOpts, CallResult, HubClient } from "./hub.ts";
import { HubCallError } from "./hub.ts";

const MAX_TITLE = 120;
const MAX_SIG = 200;
const MAX_REASON = 200;
const MAX_BIDS_PER_BOUNTY = 30;
const MAX_DETAIL = 200;

interface MBounty extends Omit<Bounty, "budget_yocto" | "hive_minted"> {
  budget: bigint;
  hive_minted: bigint;
}
interface MBid extends Omit<Bid, "price_yocto"> {
  price: bigint;
}
interface MWorker extends Omit<WorkerInfo, "earned_yocto" | "hive_earned"> {
  earned: bigint;
  hive: bigint;
}
interface MTreasury {
  spend_cap: bigint;
  committed_total: bigint;
  funded_total: bigint;
  available: bigint;
  escrowed: bigint;
  paid_out: bigint;
  refunded_total: bigint;
}
interface MPendingMint {
  bounty_id: number;
  recipient: AccountId;
  amount: bigint;
  bid_units: bigint;
  score: number;
}
interface MSupply extends Omit<SupplyPoint, "bid_units" | "mint_rate" | "amount" | "total_minted_after"> {
  bid_units: bigint;
  mint_rate: bigint;
  amount: bigint;
  total_minted_after: bigint;
}

interface State {
  owner: AccountId;
  coordinator: AccountId | null;
  verifier: AccountId | null;
  hive_token: AccountId;
  mint_rate: bigint;
  total_minted: bigint;
  treasury: MTreasury;
  bounties: MBounty[];
  bids: MBid[];
  workers: Map<AccountId, MWorker>;
  activity: ActivityEntry[];
  supply: MSupply[];
  pending: Map<number, MPendingMint>;
  // hive-token
  token_minter: AccountId;
  balances: Map<AccountId, bigint>;
  token_supply: bigint;
  // simulated native NEAR received by payouts / refunds
  near: Map<AccountId, bigint>;
}

export interface MockChainOpts {
  owner: AccountId;
  hub: AccountId;
  token: AccountId;
  /** treasury_budget_yocto (spend cap). */
  spendCapYocto: string;
  mintRate: string;
  /** Initial clock, ms (default Date.now()). */
  nowMs?: number;
}

class Panic extends Error {}
function panic(code: string, detail?: string): never {
  throw new Panic(detail ? `${code}: ${detail}` : code);
}

export class MockChain {
  readonly hubId: AccountId;
  readonly tokenId: AccountId;
  private s: State;
  private now: number;
  private height = 1000;
  private txCounter = 0;
  /** If > 0, the next N hive.mint cross-contract calls fail (to exercise MintFailed / retry_mint). */
  failNextMints = 0;

  constructor(opts: MockChainOpts) {
    this.hubId = opts.hub;
    this.tokenId = opts.token;
    this.now = opts.nowMs ?? Date.now();
    this.s = {
      owner: opts.owner,
      coordinator: null,
      verifier: null,
      hive_token: opts.token,
      mint_rate: BigInt(opts.mintRate),
      total_minted: 0n,
      treasury: {
        spend_cap: BigInt(opts.spendCapYocto),
        committed_total: 0n,
        funded_total: 0n,
        available: 0n,
        escrowed: 0n,
        paid_out: 0n,
        refunded_total: 0n,
      },
      bounties: [],
      bids: [],
      workers: new Map(),
      activity: [],
      supply: [],
      pending: new Map(),
      token_minter: opts.hub,
      balances: new Map(),
      token_supply: 0n,
      near: new Map(),
    };
  }

  // ---------------- clock / helpers ----------------
  nowMs(): number {
    return this.now;
  }
  setNow(ms: number): void {
    this.now = ms;
  }
  advance(ms: number): void {
    this.now += ms;
  }
  nearBalance(account: AccountId): bigint {
    return this.s.near.get(account) ?? 0n;
  }

  /** HubClient for the bounty-hub contract signed as `accountId`. */
  client(accountId: AccountId): HubClient {
    return new MockHubClient(this, accountId, this.hubId);
  }
  /** HubClient for the hive-token contract signed as `accountId`. */
  tokenClient(accountId: AccountId): HubClient {
    return new MockHubClient(this, accountId, this.tokenId);
  }

  /** All hub + token views in one object (used for data/sample and debugging). */
  snapshot(): Record<string, unknown> {
    const bounties = this.vBounties(0, 1_000_000);
    return {
      config: this.vConfig(),
      treasury: this.vTreasury(),
      bounties,
      bids: Object.fromEntries(bounties.map((b) => [String(b.id), this.vBids(b.id)])),
      reputation: this.vReputation(null),
      activity: this.s.activity.map((a) => ({ ...a })),
      supply_history: this.s.supply.map(supplyOut),
      pending_mints: this.vPending(),
      token: {
        ft_metadata: tokenMetadata(),
        ft_total_supply: this.s.token_supply.toString(),
        balances: Object.fromEntries([...this.s.balances].map(([k, v]) => [k, v.toString()])),
        minter: this.s.token_minter,
      },
    };
  }

  // ---------------- dispatch ----------------
  /** @internal */
  _view(contract: AccountId, method: string, args: Record<string, unknown>): unknown {
    try {
      return contract === this.tokenId ? this.tokenView(method, args) : this.hubView(method, args);
    } catch (e) {
      throw new HubCallError(`view ${contract}.${method} failed: ${(e as Error).message}`);
    }
  }

  /** @internal  Executes atomically: any panic rolls the whole state back, like a failed NEAR tx. */
  _call(contract: AccountId, caller: AccountId, method: string, args: Record<string, unknown>, opts: CallOpts): CallResult {
    const txHash = `mock-${++this.txCounter}`;
    const backup = cloneState(this.s);
    const backupHeight = this.height;
    this.height += 1;
    const deposit = BigInt(opts.depositYocto ?? "0");
    try {
      const result =
        contract === this.tokenId
          ? this.tokenCall(caller, method, args)
          : this.hubCall(caller, method, args, deposit);
      return { txHash, result };
    } catch (e) {
      this.s = backup;
      this.height = backupHeight + 1;
      const msg = e instanceof Panic ? `Smart contract panicked: ${e.message}` : (e as Error).message;
      throw new HubCallError(`call ${contract}.${method} failed: ${msg}`, txHash);
    }
  }

  // ---------------- hub views ----------------
  private hubView(method: string, a: Record<string, unknown>): unknown {
    switch (method) {
      case "get_config":
        return this.vConfig();
      case "get_bounties":
        return this.vBounties(optNum(a.from_index) ?? 0, optNum(a.limit) ?? 50);
      case "get_bounty": {
        const b = this.s.bounties[num(a.bounty_id, "bounty_id")];
        return b ? bountyOut(b) : null;
      }
      case "get_bids":
        return this.vBids(num(a.bounty_id, "bounty_id"));
      case "get_treasury":
        return this.vTreasury();
      case "get_reputation":
        return this.vReputation((a.account_id as string | undefined) ?? null);
      case "get_activity_log": {
        const from = optNum(a.from_index) ?? 0;
        const limit = optNum(a.limit) ?? 100;
        return this.s.activity.slice(from, from + limit).map((x) => ({ ...x }));
      }
      case "get_supply_history": {
        const from = optNum(a.from_index) ?? 0;
        const limit = optNum(a.limit) ?? 100;
        return this.s.supply.slice(from, from + limit).map(supplyOut);
      }
      case "get_pending_mints":
        return this.vPending();
      default:
        throw new Error(`MethodNotFound: ${method}`);
    }
  }

  private vConfig(): HubConfig {
    return {
      owner: this.s.owner,
      coordinator: this.s.coordinator,
      verifier: this.s.verifier,
      hive_token: this.s.hive_token,
      mint_rate: this.s.mint_rate.toString(),
      total_minted: this.s.total_minted.toString(),
      version: "0.1.0",
    };
  }
  private vBounties(from: number, limit: number): Bounty[] {
    return this.s.bounties.slice(from, from + limit).map(bountyOut);
  }
  private vBids(bountyId: number): Bid[] {
    const b = this.s.bounties[bountyId];
    if (!b) return [];
    return b.bid_ids.map((id) => bidOut(this.s.bids[id]));
  }
  private vTreasury(): Treasury {
    const t = this.s.treasury;
    return {
      spend_cap: t.spend_cap.toString(),
      committed_total: t.committed_total.toString(),
      funded_total: t.funded_total.toString(),
      available: t.available.toString(),
      escrowed: t.escrowed.toString(),
      paid_out: t.paid_out.toString(),
      refunded_total: t.refunded_total.toString(),
    };
  }
  private vReputation(account: AccountId | null): WorkerView[] {
    const ws = account ? [this.s.workers.get(account)].filter((w): w is MWorker => !!w) : [...this.s.workers.values()];
    return ws.map(workerOut);
  }
  private vPending(): PendingMint[] {
    return [...this.s.pending.values()].map((p) => ({
      bounty_id: p.bounty_id,
      recipient: p.recipient,
      amount: p.amount.toString(),
      bid_units: p.bid_units.toString(),
      score: p.score,
    }));
  }

  // ---------------- hub calls ----------------
  private hubCall(caller: AccountId, method: string, a: Record<string, unknown>, deposit: bigint): unknown {
    const s = this.s;
    switch (method) {
      case "fund_treasury": {
        if (deposit <= 0n) panic("ERR_ZERO_DEPOSIT", "attach NEAR to fund the treasury");
        s.treasury.funded_total += deposit;
        s.treasury.available += deposit;
        this.log(caller, "TreasuryFunded", null, null, deposit, `treasury funded by ${caller}`);
        return null;
      }
      case "set_coordinator":
      case "set_verifier": {
        this.onlyOwner(caller);
        const acct = str(a.account_id, "account_id");
        const other = method === "set_coordinator" ? s.verifier : s.coordinator;
        if (acct === other || s.workers.has(acct)) panic("ERR_ROLE_CONFLICT", `${acct} already holds another role`);
        if (method === "set_coordinator") s.coordinator = acct;
        else s.verifier = acct;
        this.log(caller, "RoleChanged", null, null, null, `${method === "set_coordinator" ? "coordinator" : "verifier"} = ${acct}`);
        return null;
      }
      case "add_worker": {
        this.onlyOwner(caller);
        const acct = str(a.account_id, "account_id");
        const tier = num(a.tier, "tier");
        const pk = str(a.signing_pk, "signing_pk");
        if (tier < 1 || tier > 3) panic("ERR_BAD_TIER", "tier must be 1..=3");
        if (acct === s.coordinator || acct === s.verifier || acct === s.owner) panic("ERR_ROLE_CONFLICT", `${acct} holds another role`);
        if (!pk.startsWith("ed25519:")) panic("ERR_BAD_HASH", "signing_pk must be ed25519:<base58>");
        const prev = s.workers.get(acct);
        s.workers.set(acct, {
          account_id: acct,
          tier,
          signing_pk: pk,
          active: true,
          completed: prev?.completed ?? 0,
          failed: prev?.failed ?? 0,
          total_score: prev?.total_score ?? 0,
          earned: prev?.earned ?? 0n,
          hive: prev?.hive ?? 0n,
        });
        this.log(caller, "WorkerAdded", null, null, null, `worker ${acct} tier ${tier}`);
        return null;
      }
      case "remove_worker": {
        this.onlyOwner(caller);
        const acct = str(a.account_id, "account_id");
        const w = s.workers.get(acct) ?? panic("ERR_NOT_WORKER", acct);
        w.active = false;
        this.log(caller, "WorkerRemoved", null, null, null, `worker ${acct} removed`);
        return null;
      }
      case "set_mint_rate": {
        this.onlyOwner(caller);
        s.mint_rate = BigInt(str(a.mint_rate, "mint_rate"));
        return null;
      }
      case "post_bounty":
        return this.postBounty(caller, a);
      case "place_bid":
        return this.placeBid(caller, a);
      case "reject_bid": {
        this.onlyCoordinator(caller);
        const b = this.bounty(a.bounty_id);
        const bid = this.bid(a.bid_id, b.id);
        const reason = str(a.reason, "reason");
        if (reason.length > MAX_REASON) panic("ERR_TOO_LONG", "reason");
        if (bid.status !== "Pending") panic("ERR_BID_NOT_SELECTABLE", `bid ${bid.id} is ${bid.status}`);
        bid.status = "Rejected";
        bid.reject_reason = reason;
        b.updated_ms = this.now;
        this.log(caller, "BidRejected", b.id, bid.id, bid.price, `bid ${bid.id} by ${bid.worker} rejected: ${reason}`);
        return null;
      }
      case "select_winner": {
        this.onlyCoordinator(caller);
        const b = this.bounty(a.bounty_id);
        if (b.status !== "Bidding") panic("ERR_BAD_STATUS", `bounty ${b.id} is ${b.status}`);
        const bidId = num(a.bid_id, "bid_id");
        const bid = s.bids[bidId] ?? panic("ERR_BID_NOT_FOUND", String(bidId));
        if (bid.bounty_id !== b.id || bid.status !== "Pending" || bid.round !== b.round) {
          panic("ERR_BID_NOT_SELECTABLE", `bid ${bid.id} (${bid.status}, round ${bid.round})`);
        }
        bid.status = "Won";
        for (const id of b.bid_ids) {
          const o = s.bids[id];
          if (o.id !== bid.id && o.round === b.round && o.status === "Pending") o.status = "Lost";
        }
        b.winner_bid_id = bid.id;
        b.status = "InProgress";
        b.updated_ms = this.now;
        this.log(caller, "WinnerSelected", b.id, bid.id, bid.price, `winner ${bid.worker} at ${bid.price} yocto`);
        return null;
      }
      case "submit_work": {
        const b = this.bounty(a.bounty_id);
        const h = str(a.deliverable_hash, "deliverable_hash");
        if (b.status !== "InProgress") panic("ERR_BAD_STATUS", `bounty ${b.id} is ${b.status}`);
        const win = b.winner_bid_id == null ? null : s.bids[b.winner_bid_id];
        if (!win || win.worker !== caller) panic("ERR_NOT_WINNER", caller);
        if (!isHash(h)) panic("ERR_BAD_HASH", "deliverable_hash");
        b.deliverable_hash = h;
        b.status = "Verifying";
        b.updated_ms = this.now;
        this.log(caller, "WorkSubmitted", b.id, win.id, null, `deliverable ${h.slice(0, 12)}…`);
        return null;
      }
      case "verify_bounty":
        return this.verifyBounty(caller, a);
      case "retry_mint": {
        this.onlyOwner(caller);
        const id = num(a.bounty_id, "bounty_id");
        const p = s.pending.get(id) ?? panic("ERR_NO_PENDING_MINT", String(id));
        this.doMint(p);
        return null;
      }
      case "cancel_bounty": {
        if (caller !== s.owner && caller !== s.coordinator) panic("ERR_NOT_POSTER", "only owner or coordinator may cancel");
        const b = this.bounty(a.bounty_id);
        if (!["Open", "Bidding", "InProgress"].includes(b.status)) panic("ERR_BAD_STATUS", `bounty ${b.id} is ${b.status}`);
        this.refund(caller, b);
        return null;
      }
      case "on_mint_complete":
        panic("ERR_NOT_OWNER", "on_mint_complete is #[private]");
      // eslint-disable-next-line no-fallthrough
      default:
        throw new Error(`MethodNotFound: ${method}`);
    }
  }

  private postBounty(caller: AccountId, a: Record<string, unknown>): number {
    const s = this.s;
    if (caller !== s.owner && caller !== s.coordinator) panic("ERR_NOT_POSTER", "only owner or coordinator may post");
    const title = str(a.title, "title");
    const specHash = str(a.spec_hash, "spec_hash");
    const budget = BigInt(str(a.budget_yocto, "budget_yocto"));
    const deadline = num(a.deadline_ms, "deadline_ms");
    const minTier = num(a.min_tier, "min_tier");
    if (title.length === 0 || title.length > MAX_TITLE) panic("ERR_TOO_LONG", "title must be 1..=120 chars");
    if (!isHash(specHash)) panic("ERR_BAD_HASH", "spec_hash");
    if (minTier < 1 || minTier > 3) panic("ERR_BAD_TIER", "min_tier must be 1..=3");
    if (budget <= 0n) panic("ERR_TREASURY_INSUFFICIENT", "budget must be > 0");
    if (budget > s.treasury.available) panic("ERR_TREASURY_INSUFFICIENT", `budget ${budget} > available ${s.treasury.available}`);
    if (s.treasury.committed_total + budget > s.treasury.spend_cap) panic("ERR_SPEND_CAP", "spend cap reached");
    if (deadline <= this.now) panic("ERR_DEADLINE_PAST", String(deadline));
    s.treasury.available -= budget;
    s.treasury.escrowed += budget;
    s.treasury.committed_total += budget;
    const id = s.bounties.length;
    s.bounties.push({
      id,
      title,
      spec_hash: specHash,
      poster: caller,
      budget,
      deadline_ms: deadline,
      min_tier: minTier,
      status: "Open",
      round: 0,
      attempts: 0,
      bid_ids: [],
      winner_bid_id: null,
      deliverable_hash: null,
      check_results_hash: null,
      score: null,
      excluded: [],
      created_ms: this.now,
      updated_ms: this.now,
      hive_minted: 0n,
    });
    this.log(caller, "BountyPosted", id, null, budget, `bounty ${id} "${title}" posted, budget ${budget}`);
    return id;
  }

  private placeBid(caller: AccountId, a: Record<string, unknown>): number {
    const s = this.s;
    const w = s.workers.get(caller);
    if (!w || !w.active) panic("ERR_NOT_WORKER", caller);
    const b = this.bounty(a.bounty_id);
    const price = BigInt(str(a.price_yocto, "price_yocto"));
    const eta = num(a.eta_ms, "eta_ms");
    const signature = str(a.signature, "signature");
    if (signature.length > MAX_SIG) panic("ERR_TOO_LONG", "signature");
    if (b.bid_ids.length >= MAX_BIDS_PER_BOUNTY) panic("ERR_TOO_MANY_BIDS", String(b.id));

    let reject: BidRejectReason | null = null;
    if (b.status !== "Open" && b.status !== "Bidding") reject = "bounty closed";
    else if (this.now > b.deadline_ms) reject = "deadline passed";
    else if (price > b.budget) reject = "price exceeds budget";
    else if (w.tier < b.min_tier) reject = "tier below min_tier";
    else if (b.excluded.includes(caller)) reject = "worker excluded";
    else if (
      b.bid_ids.some((id) => {
        const o = s.bids[id];
        return o.worker === caller && o.round === b.round && o.status === "Pending";
      })
    )
      reject = "duplicate bid this round";

    const id = s.bids.length;
    const signed_payload = bidPayload({
      bounty_id: b.id,
      contract: this.hubId,
      eta_ms: eta,
      price_yocto: price.toString(),
      round: b.round,
      worker: caller,
    });
    s.bids.push({
      id,
      bounty_id: b.id,
      round: b.round,
      worker: caller,
      tier: w.tier,
      price,
      eta_ms: eta,
      signature,
      signed_payload,
      status: reject ? "Rejected" : "Pending",
      reject_reason: reject,
      created_ms: this.now,
    });
    b.bid_ids.push(id);
    b.updated_ms = this.now;
    if (reject) {
      this.log(caller, "BidRejected", b.id, id, price, `bid ${id} by ${caller} rejected: ${reject}`);
    } else {
      if (b.status === "Open") b.status = "Bidding";
      this.log(caller, "BidPlaced", b.id, id, price, `bid ${id} by ${caller}: ${price} yocto, eta ${eta} ms`);
    }
    return id;
  }

  private verifyBounty(caller: AccountId, a: Record<string, unknown>): null {
    const s = this.s;
    if (caller !== s.verifier) panic("ERR_NOT_VERIFIER", caller);
    const b = this.bounty(a.bounty_id);
    if (b.status !== "Verifying") panic("ERR_BAD_STATUS", `bounty ${b.id} is ${b.status}`);
    const passed = Boolean(a.passed);
    const score = num(a.score, "score");
    const hash = str(a.check_results_hash, "check_results_hash");
    if (score > 100) panic("ERR_BAD_SCORE", String(score));
    if (!isHash(hash)) panic("ERR_BAD_HASH", "check_results_hash");
    const win = s.bids[b.winner_bid_id!];
    const w = s.workers.get(win.worker)!;
    b.check_results_hash = hash;
    b.score = score;
    b.updated_ms = this.now;

    if (passed && score > 0) {
      win.status = "Paid";
      b.status = "Completed";
      s.treasury.escrowed -= b.budget;
      s.treasury.paid_out += win.price;
      s.treasury.available += b.budget - win.price;
      s.near.set(win.worker, (s.near.get(win.worker) ?? 0n) + win.price);
      this.log(caller, "VerificationPassed", b.id, win.id, null, `passed, score ${score}, checks ${hash.slice(0, 12)}…`);
      this.log(caller, "Payout", b.id, win.id, win.price, `paid ${win.worker} ${win.price} yocto`);
      w.completed += 1;
      w.total_score += score;
      w.earned += win.price;
      const units = win.price / YOCTO_PER_MILLINEAR;
      const amount = (units * BigInt(score) * s.mint_rate) / 100n;
      if (amount > 0n) {
        const p: MPendingMint = { bounty_id: b.id, recipient: win.worker, amount, bid_units: units, score };
        s.pending.set(b.id, p);
        this.doMint(p);
      }
      return null;
    }

    // FAIL
    win.status = "Failed";
    if (!b.excluded.includes(win.worker)) b.excluded.push(win.worker);
    w.failed += 1;
    b.attempts += 1;
    this.log(caller, "VerificationFailed", b.id, win.id, null, `failed (score ${score}), checks ${hash.slice(0, 12)}…, ${win.worker} excluded`);
    if (b.attempts >= 2) {
      this.refund(caller, b);
    } else {
      b.round += 1;
      for (const id of b.bid_ids) if (s.bids[id].status === "Pending") s.bids[id].status = "Superseded";
      b.status = "Open";
      b.winner_bid_id = null;
      this.log(caller, "BountyReopened", b.id, null, null, `bounty ${b.id} reopened for round ${b.round}`);
    }
    return null;
  }

  /** Simulates hive.mint(...) + on_mint_complete callback (synchronous in the mock). */
  private doMint(p: MPendingMint): void {
    const s = this.s;
    const ok = this.failNextMints <= 0;
    if (!ok) this.failNextMints -= 1;
    if (!ok) {
      this.log(this.hubId, "MintFailed", p.bounty_id, null, p.amount, `mint of ${p.amount} to ${p.recipient} failed; pending`);
      return;
    }
    // token side
    s.balances.set(p.recipient, (s.balances.get(p.recipient) ?? 0n) + p.amount);
    s.token_supply += p.amount;
    // callback side
    s.total_minted += p.amount;
    s.supply.push({
      id: s.supply.length,
      ts_ms: this.now,
      block_height: this.height,
      bounty_id: p.bounty_id,
      recipient: p.recipient,
      bid_units: p.bid_units,
      score: p.score,
      mint_rate: s.mint_rate,
      amount: p.amount,
      total_minted_after: s.total_minted,
    });
    s.bounties[p.bounty_id].hive_minted = p.amount;
    const w = s.workers.get(p.recipient);
    if (w) w.hive += p.amount;
    s.pending.delete(p.bounty_id);
    this.log(
      this.hubId,
      "Mint",
      p.bounty_id,
      null,
      p.amount,
      `minted ${p.amount} HIVE-raw to ${p.recipient} = ${p.bid_units}×${p.score}/100×${s.mint_rate}`,
    );
  }

  private refund(caller: AccountId, b: MBounty): void {
    const s = this.s;
    s.treasury.escrowed -= b.budget;
    s.treasury.available += b.budget;
    s.treasury.refunded_total += b.budget;
    b.status = "Cancelled";
    b.updated_ms = this.now;
    for (const id of b.bid_ids) if (s.bids[id].status === "Pending") s.bids[id].status = "Superseded";
    this.log(caller, "TreasuryRefund", b.id, null, b.budget, `escrow ${b.budget} returned to treasury`);
    this.log(caller, "BountyCancelled", b.id, null, null, `bounty ${b.id} cancelled`);
  }

  // ---------------- token ----------------
  private tokenView(method: string, a: Record<string, unknown>): unknown {
    switch (method) {
      case "ft_balance_of":
        return (this.s.balances.get(str(a.account_id, "account_id")) ?? 0n).toString();
      case "ft_total_supply":
        return this.s.token_supply.toString();
      case "ft_metadata":
        return tokenMetadata();
      case "get_minter":
        return this.s.token_minter;
      default:
        throw new Error(`MethodNotFound: ${method}`);
    }
  }
  private tokenCall(caller: AccountId, method: string, _a: Record<string, unknown>): unknown {
    switch (method) {
      case "mint":
        // Only the hub may mint; there is no admin mint. Hub-initiated mints happen inside verify_bounty.
        panic("ERR_NOT_MINTER", caller);
      // eslint-disable-next-line no-fallthrough
      default:
        throw new Error(`MethodNotFound: ${method}`);
    }
  }

  // ---------------- guards / lookup ----------------
  private onlyOwner(caller: AccountId): void {
    if (caller !== this.s.owner) panic("ERR_NOT_OWNER", caller);
  }
  private onlyCoordinator(caller: AccountId): void {
    if (caller !== this.s.coordinator) panic("ERR_NOT_COORDINATOR", caller);
  }
  private bounty(id: unknown): MBounty {
    const n = num(id, "bounty_id");
    return this.s.bounties[n] ?? panic("ERR_BOUNTY_NOT_FOUND", String(n));
  }
  private bid(id: unknown, bountyId: number): MBid {
    const n = num(id, "bid_id");
    const b = this.s.bids[n] ?? panic("ERR_BID_NOT_FOUND", String(n));
    if (b.bounty_id !== bountyId) panic("ERR_BID_NOT_FOUND", `bid ${n} is not on bounty ${bountyId}`);
    return b;
  }
  private log(
    actor: AccountId,
    kind: ActivityKind,
    bounty_id: number | null,
    bid_id: number | null,
    amount: bigint | null,
    detail: string,
  ): void {
    this.s.activity.push({
      id: this.s.activity.length,
      ts_ms: this.now,
      block_height: this.height,
      actor,
      kind,
      bounty_id,
      bid_id,
      amount: amount == null ? null : amount.toString(),
      detail: detail.slice(0, MAX_DETAIL),
    });
  }
}

/** HubClient backed by a MockChain (unit tests / offline dev only). */
export class MockHubClient implements HubClient {
  constructor(
    private readonly chain: MockChain,
    readonly accountId: AccountId,
    readonly contractId: AccountId,
  ) {}
  async view<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    return structuredClone(this.chain._view(this.contractId, method, args)) as T;
  }
  async call<T = unknown>(method: string, args: Record<string, unknown>, opts: CallOpts = {}): Promise<CallResult<T>> {
    const r = this.chain._call(this.contractId, this.accountId, method, structuredClone(args), opts);
    return r as CallResult<T>;
  }
}

// ---------------- serialization helpers ----------------
function bountyOut(b: MBounty): Bounty {
  const { budget, hive_minted, ...rest } = b;
  return { ...rest, bid_ids: [...b.bid_ids], excluded: [...b.excluded], budget_yocto: budget.toString(), hive_minted: hive_minted.toString() };
}
function bidOut(b: MBid): Bid {
  const { price, ...rest } = b;
  return { ...rest, price_yocto: price.toString() };
}
function workerOut(w: MWorker): WorkerView {
  const { earned, hive, ...rest } = w;
  const rep = Math.max(0, w.completed * 10 + Math.floor(w.total_score / 10) - w.failed * 15);
  return { ...rest, earned_yocto: earned.toString(), hive_earned: hive.toString(), reputation: rep };
}
function supplyOut(p: MSupply): SupplyPoint {
  return {
    ...p,
    bid_units: p.bid_units.toString(),
    mint_rate: p.mint_rate.toString(),
    amount: p.amount.toString(),
    total_minted_after: p.total_minted_after.toString(),
  };
}
function tokenMetadata() {
  return { spec: "ft-1.0.0", name: "HiveFund Token", symbol: "HIVE", decimals: 18, icon: null, reference: null, reference_hash: null };
}
function cloneState(s: State): State {
  return structuredClone(s);
}
function num(v: unknown, name: string): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) throw new Error(`invalid argument ${name}: ${String(v)}`);
  return v;
}
function optNum(v: unknown): number | undefined {
  return v == null ? undefined : num(v, "index");
}
function str(v: unknown, name: string): string {
  if (typeof v !== "string") throw new Error(`invalid argument ${name}: expected string`);
  return v;
}
