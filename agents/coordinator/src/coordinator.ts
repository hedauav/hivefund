// Coordinator agent: posts bounties, checks bid signatures against the on-chain signing_pk, rejects
// forgeries on-chain (logged), scores the remaining bids with the published formula and selects the
// winner. The winner is computed, never hardcoded.
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_SELECTION_WEIGHTS,
  INVALID_SIGNATURE_REASON,
  bidPayload,
  hashJson,
  scoreBids,
  validateSpec,
  verifyBid,
  type Bid,
  type Bounty,
  type BountySpec,
  type SelectionRationale,
  type SelectionWeights,
  type WorkerView,
} from "@hivefund/shared";
import type { AgentContext } from "@hivefund/shared/node";

export interface CoordinatorOptions {
  /** directory with BountySpec *.json fixtures (default <repo>/bounties) */
  bountiesDir?: string;
  /** explicit fixture files to post instead of every *.json in bountiesDir (demo --bounties) */
  specFiles?: string[];
  /** select once a bounty has this many valid pending bids in the round (default 3) */
  minBids?: number;
  /** ...or once this long has passed since the round's first bid (default 90 s) */
  bidWindowMs?: number;
  weights?: SelectionWeights;
}

export interface CoordinatorReport {
  posted: { bounty_id: number; title: string; spec_hash: string; txHash: string }[];
  rejected: { bounty_id: number; bid_id: number; worker: string; reason: string; txHash: string }[];
  selected: { bounty_id: number; round: number; bid_id: number; worker: string; rationale_hash: string; txHash: string }[];
  waiting: { bounty_id: number; reason: string }[];
  errors: { bounty_id: number | null; action: string; message: string }[];
}

const emptyReport = (): CoordinatorReport => ({ posted: [], rejected: [], selected: [], waiting: [], errors: [] });

export class Coordinator {
  readonly name = "coordinator";
  readonly accountId: string;
  private readonly ctx: AgentContext;
  private readonly opts: Required<Omit<CoordinatorOptions, "weights">> & { weights: SelectionWeights };
  /** bounty_id:round -> first time the coordinator saw a pending bid in that round */
  private readonly firstSeen = new Map<string, number>();

  constructor(ctx: AgentContext, opts: CoordinatorOptions = {}) {
    this.ctx = ctx;
    this.accountId = ctx.accountId;
    this.opts = {
      bountiesDir: opts.bountiesDir ?? path.join(ctx.repoRoot, "bounties"),
      specFiles: opts.specFiles ?? [],
      minBids: opts.minBids ?? 3,
      bidWindowMs: opts.bidWindowMs ?? 90_000,
      weights: opts.weights ?? DEFAULT_SELECTION_WEIGHTS,
    };
  }

  /** BountySpec fixtures from the bounties directory, sorted by file name. */
  loadSpecs(): { file: string; spec: BountySpec }[] {
    if (this.opts.specFiles.length) {
      return this.opts.specFiles.map((file) => {
        const spec = JSON.parse(fs.readFileSync(file, "utf8")) as BountySpec;
        const problems = validateSpec(spec);
        if (problems.length) throw new Error(`${file}: ${problems.join("; ")}`);
        return { file: path.basename(file), spec };
      });
    }
    const dir = this.opts.bountiesDir;
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => {
        const spec = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as BountySpec;
        const problems = validateSpec(spec);
        if (problems.length) throw new Error(`bounties/${f}: ${problems.join("; ")}`);
        return { file: f, spec };
      });
  }

  /**
   * Post specs that are not already live on-chain (same spec_hash in a non-terminal bounty).
   * Specs default to every fixture in /bounties.
   */
  async postBounties(specs: BountySpec[] = this.loadSpecs().map((s) => s.spec), report = emptyReport()): Promise<CoordinatorReport> {
    const { hub, store } = this.ctx;
    const live = await hub.view<Bounty[]>("get_bounties", { from_index: 0, limit: 100 });
    for (const spec of specs) {
      const spec_hash = store.put(spec, { kind: "spec", actor: this.accountId });
      if (live.some((b) => b.spec_hash === spec_hash && b.status !== "Completed" && b.status !== "Cancelled")) continue;
      try {
        const deadline_ms = this.ctx.now() + spec.deadline_minutes * 60_000;
        const r = await hub.call<number>("post_bounty", {
          title: spec.title,
          spec_hash,
          budget_yocto: spec.budget_yocto,
          deadline_ms,
          min_tier: spec.min_tier,
        });
        const id = typeof r.result === "number" ? r.result : Number(r.result);
        report.posted.push({ bounty_id: id, title: spec.title, spec_hash, txHash: r.txHash });
        this.ctx.log(`posted bounty ${id} "${spec.title}" budget ${spec.budget_yocto} (tx ${r.txHash})`);
      } catch (e) {
        report.errors.push({ bounty_id: null, action: "post_bounty", message: (e as Error).message });
        this.ctx.log(`post_bounty failed for "${spec.title}": ${(e as Error).message}`);
      }
    }
    return report;
  }

  /** One coordinator step over every Bidding bounty. `force` selects as soon as one valid bid exists. */
  async tick(opts: { force?: boolean } = {}): Promise<CoordinatorReport> {
    const report = emptyReport();
    const bounties = await this.ctx.hub.view<Bounty[]>("get_bounties", { from_index: 0, limit: 100 });
    const bidding = bounties.filter((b) => b.status === "Bidding");
    if (!bidding.length) return report;
    const workers = await this.ctx.hub.view<WorkerView[]>("get_reputation", {});
    const byAcct = new Map(workers.map((w) => [w.account_id, w]));
    for (const b of bidding) {
      try {
        await this.handleBounty(b, byAcct, report, Boolean(opts.force));
      } catch (e) {
        report.errors.push({ bounty_id: b.id, action: "select", message: (e as Error).message });
        this.ctx.log(`bounty ${b.id}: ${(e as Error).message}`);
      }
    }
    return report;
  }

  /** Selection weights for a bounty: the spec's selection_weights if valid, else the coordinator default. */
  weightsFor(b: Bounty): SelectionWeights {
    try {
      const spec = this.ctx.store.get(b.spec_hash) as BountySpec | undefined;
      const w = spec?.selection_weights;
      if (w && validateSpec({ ...spec, selection_weights: w }).every((p) => !p.startsWith("selection_weights"))) return w;
    } catch {
      /* spec not in this store: use the default */
    }
    return this.opts.weights;
  }

  /** Off-chain signature check: the bid payload must be the canonical commitment and be signed by signing_pk. */
  checkSignature(b: Bounty, bid: Bid, worker: WorkerView | undefined): { ok: boolean; why: string } {
    if (!worker) return { ok: false, why: "worker not registered" };
    const expected = bidPayload({
      bounty_id: b.id,
      contract: this.ctx.contractId,
      eta_ms: bid.eta_ms,
      price_yocto: bid.price_yocto,
      round: bid.round,
      worker: bid.worker,
    });
    if (bid.signed_payload !== expected) return { ok: false, why: "signed payload does not match canonical commitment" };
    if (!verifyBid(bid.signed_payload, bid.signature, worker.signing_pk)) return { ok: false, why: INVALID_SIGNATURE_REASON };
    return { ok: true, why: "" };
  }

  private async handleBounty(
    b: Bounty,
    workers: Map<string, WorkerView>,
    report: CoordinatorReport,
    force: boolean,
  ): Promise<void> {
    const { hub, store } = this.ctx;
    const bids = await hub.view<Bid[]>("get_bids", { bounty_id: b.id });
    const pending = bids.filter((x) => x.round === b.round && x.status === "Pending");
    const rejected: { bid_id: number; reason: string }[] = bids
      .filter((x) => x.round === b.round && x.status === "Rejected")
      .map((x) => ({ bid_id: x.id, reason: x.reject_reason ?? "rejected" }));

    // 1) Signature check; forged bids are rejected ON-CHAIN so the rejection is in the activity log.
    const valid: Bid[] = [];
    for (const bid of pending) {
      const chk = this.checkSignature(b, bid, workers.get(bid.worker));
      if (chk.ok) {
        valid.push(bid);
        continue;
      }
      const reason = chk.why === INVALID_SIGNATURE_REASON ? INVALID_SIGNATURE_REASON : `${INVALID_SIGNATURE_REASON}: ${chk.why}`;
      const r = await hub.call("reject_bid", { bounty_id: b.id, bid_id: bid.id, reason: reason.slice(0, 200) });
      rejected.push({ bid_id: bid.id, reason });
      report.rejected.push({ bounty_id: b.id, bid_id: bid.id, worker: bid.worker, reason, txHash: r.txHash });
      this.ctx.log(`rejected bid ${bid.id} by ${bid.worker} on bounty ${b.id}: ${reason} (tx ${r.txHash})`);
    }

    // 2) Bid window: wait for enough valid bids or for the window to elapse.
    const key = `${b.id}:${b.round}`;
    if (!valid.length) {
      report.waiting.push({ bounty_id: b.id, reason: "no valid bids yet" });
      return;
    }
    if (!this.firstSeen.has(key)) this.firstSeen.set(key, this.ctx.now());
    const elapsed = this.ctx.now() - this.firstSeen.get(key)!;
    if (!force && valid.length < this.opts.minBids && elapsed < this.opts.bidWindowMs) {
      report.waiting.push({
        bounty_id: b.id,
        reason: `${valid.length}/${this.opts.minBids} valid bids, window ${Math.round(elapsed / 1000)}s/${Math.round(this.opts.bidWindowMs / 1000)}s`,
      });
      return;
    }

    // 3) Score with the published formula; best candidate wins. The poster's per-bounty priorities
    //    (spec.selection_weights) apply when present, else the market default.
    const weights = this.weightsFor(b);
    const candidates = scoreBids(
      [...valid, ...pending.filter((p) => !valid.includes(p))].map((bid) => ({
        bid_id: bid.id,
        worker: bid.worker,
        price_yocto: bid.price_yocto,
        eta_ms: bid.eta_ms,
        reputation: workers.get(bid.worker)?.reputation ?? 0,
        history: workers.has(bid.worker) ? workers.get(bid.worker)!.completed + workers.get(bid.worker)!.failed : 0,
        sig_valid: valid.includes(bid),
      })),
      b.budget_yocto,
      weights,
    );
    const winner = candidates.find((c) => c.sig_valid)!;
    const rationale: SelectionRationale = {
      bounty_id: b.id,
      round: b.round,
      weights,
      candidates,
      winner_bid_id: winner.bid_id,
      rejected,
    };
    const rationale_hash = store.put(rationale, { kind: "selection", bounty_id: b.id, round: b.round, actor: this.accountId });
    const r = await hub.call("select_winner", { bounty_id: b.id, bid_id: winner.bid_id });
    report.selected.push({ bounty_id: b.id, round: b.round, bid_id: winner.bid_id, worker: winner.worker, rationale_hash, txHash: r.txHash });
    this.ctx.log(
      `bounty ${b.id} round ${b.round}: selected bid ${winner.bid_id} by ${winner.worker} (score ${winner.score}, rationale ${rationale_hash.slice(0, 12)}…, tx ${r.txHash})`,
    );
  }
}

/** Canonical hash of a rationale (exported for tests / the web). */
export const rationaleHash = (r: SelectionRationale): string => hashJson(r);
