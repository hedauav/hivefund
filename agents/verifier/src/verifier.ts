// Verifier agent: for each bounty in Verifying, load spec + deliverable by hash, run the checks, store the
// full report off-chain (content-addressed) and record its hash on-chain with verify_bounty.
import type { Bid, Bounty, BountySpec, CatalogSource, Deliverable } from "@hivefund/shared";
import { nearAiDeliveryProbeFromEnv, type DeliveryProbe } from "./procurement.ts";
import { DEFAULT_BOUNTIES_DIR, nearAiFromEnv, type HubLike, type LlmClient, type StoreLike } from "@hivefund/worker-core";
import type { Clock } from "./checks.ts";
import { verify } from "./verify.ts";

export interface VerifierOptions {
  accountId: string;
  /** undefined => NEAR AI from env (NEARAI_API_KEY); null => fallback rubric only */
  llm?: LlmClient | null;
  bountiesDir?: string;
  now?: Clock;
  log?: (msg: string) => void;
  /** procurement: catalog fetcher (default live; mock passes the recorded fixture) */
  catalog?: CatalogSource;
  /** procurement: delivery probe. undefined => from env when an LLM is configured; null => skip */
  delivery?: DeliveryProbe | null;
}

export interface VerificationOutcome {
  bounty_id: number;
  round: number;
  worker: string;
  passed: boolean;
  score: number;
  check_results_hash: string;
  rubric_mode: "llm" | "fallback" | null;
  failed_checks: string[];
  txHash: string;
}

/** gas the verifier attaches: covers payout + cross-contract HIVE mint + callback (FC key allowance is small) */
export const VERIFY_GAS_TGAS = 60;

export class Verifier {
  readonly accountId: string;
  private readonly o: VerifierOptions;
  private readonly llm: LlmClient | null;
  private readonly done = new Set<string>();

  constructor(o: VerifierOptions) {
    this.o = o;
    this.accountId = o.accountId;
    this.llm = o.llm === undefined ? nearAiFromEnv({ enableThinking: false }) : o.llm;
    // The delivery call spends the verifier's own NEAR AI credits, so it only runs when an LLM is configured.
    this.delivery = o.delivery !== undefined ? o.delivery : this.llm ? nearAiDeliveryProbeFromEnv() : null;
  }
  private readonly delivery: DeliveryProbe | null;

  get rubricMode(): "llm" | "fallback" {
    return this.llm ? "llm" : "fallback";
  }

  async tick(hub: HubLike, store: StoreLike): Promise<VerificationOutcome[]> {
    const out: VerificationOutcome[] = [];
    const bounties = await hub.view<Bounty[]>("get_bounties", { from_index: 0, limit: 100 });
    for (const b of bounties) {
      if (b.status !== "Verifying" || !b.deliverable_hash) continue;
      const key = `${b.id}:${b.round}:${b.deliverable_hash}`;
      if (this.done.has(key)) continue;
      out.push(await this.verifyBounty(hub, store, b));
      this.done.add(key);
    }
    return out;
  }

  private async verifyBounty(hub: HubLike, store: StoreLike, b: Bounty): Promise<VerificationOutcome> {
    const bids = await hub.view<Bid[]>("get_bids", { bounty_id: b.id });
    const winner = bids.find((x) => x.id === b.winner_bid_id);
    const workerId = winner?.worker ?? "unknown";
    const spec = (await store.get(b.spec_hash)) as BountySpec;

    let deliverable: Deliverable;
    let loadError: string | null = null;
    try {
      deliverable = (await store.get(b.deliverable_hash!)) as Deliverable;
    } catch (e) {
      loadError = (e as Error).message;
      deliverable = { bounty_id: b.id, round: b.round, worker: workerId, sections: {}, data: null };
    }

    const report = await verify(spec, deliverable, {
      verifier: this.accountId,
      llm: this.llm,
      bountiesDir: this.o.bountiesDir ?? DEFAULT_BOUNTIES_DIR,
      now: this.o.now,
      specHash: b.spec_hash,
      deliverableHash: b.deliverable_hash!,
      worker: workerId,
      catalog: this.o.catalog,
      delivery: this.delivery,
    });
    // The on-chain record is authoritative: bind the report to the bounty/round being verified.
    report.bounty_id = b.id;
    report.round = b.round;
    if (loadError) {
      report.passed = false;
      report.checks.unshift({ id: "schema", passed: false, details: `deliverable not retrievable: ${loadError}`.slice(0, 600), duration_ms: 0 });
    }

    const hash = await store.put(report, { kind: "report", bounty_id: b.id, round: b.round, actor: this.accountId });
    const res = await hub.call(
      "verify_bounty",
      { bounty_id: b.id, passed: report.passed, score: report.score, check_results_hash: hash },
      { gasTGas: VERIFY_GAS_TGAS },
    );
    const failed = report.checks.filter((c) => !c.passed && !c.skipped).map((c) => c.id);
    this.o.log?.(
      `[verifier] #${b.id} r${b.round} ${workerId}: ${report.passed ? "PASS" : "FAIL"} score ${report.score}` +
        `${failed.length ? ` (failed: ${failed.join(", ")})` : ""} -> ${hash.slice(0, 12)}…`,
    );
    return {
      bounty_id: b.id,
      round: b.round,
      worker: workerId,
      passed: report.passed,
      score: report.score,
      check_results_hash: hash,
      rubric_mode: report.rubric?.mode ?? null,
      failed_checks: failed,
      txHash: res.txHash,
    };
  }
}
