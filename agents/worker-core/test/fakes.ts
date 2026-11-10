// Minimal in-memory hub + store for Stream C unit tests. NOT the MockHubClient (Stream B owns that); it only
// implements the views/calls workers and the verifier use, with the same JSON shapes as the contract.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize, hashJson } from "@hivefund/shared";
import type { Bid, Bounty, BountySpec, StrategyChange } from "@hivefund/shared";
import type { HubLike, StoreLike, StoreMeta } from "../src/ports.ts";

export const BOUNTIES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../bounties");

export function loadSpec(name: string): BountySpec {
  return JSON.parse(readFileSync(path.join(BOUNTIES_DIR, name), "utf8")) as BountySpec;
}

export class FakeStore implements StoreLike {
  readonly objects = new Map<string, string>();
  readonly metas: StoreMeta[] = [];
  readonly strategy: { worker: string; change: StrategyChange }[] = [];
  put(obj: unknown, meta: StoreMeta): string {
    const h = hashJson(obj);
    this.objects.set(h, canonicalize(obj));
    this.metas.push(meta);
    return h;
  }
  get(hash: string): unknown {
    const s = this.objects.get(hash);
    if (s === undefined) throw new Error(`not found: ${hash}`);
    return JSON.parse(s);
  }
  appendStrategy(worker: string, change: StrategyChange): void {
    this.strategy.push({ worker, change });
  }
}

export interface Call {
  caller: string;
  method: string;
  args: Record<string, any>;
  gasTGas?: number;
}

/** Shared market state; each agent gets its own `client(accountId)` view of it. */
export class FakeMarket {
  bounties: Bounty[] = [];
  bids: Bid[] = [];
  calls: Call[] = [];

  addBounty(spec_hash: string, budget_yocto: string, min_tier: number, extra: Partial<Bounty> = {}): Bounty {
    const b: Bounty = {
      id: this.bounties.length,
      title: "t",
      spec_hash,
      poster: "coordinator.test",
      budget_yocto,
      deadline_ms: Date.now() + 3_600_000,
      min_tier,
      status: "Open",
      round: 0,
      attempts: 0,
      bid_ids: [],
      winner_bid_id: null,
      deliverable_hash: null,
      check_results_hash: null,
      score: null,
      excluded: [],
      created_ms: 0,
      updated_ms: 0,
      hive_minted: "0",
      ...extra,
    };
    this.bounties.push(b);
    return b;
  }

  client(caller: string): HubLike {
    return {
      view: async <T>(method: string, args: Record<string, unknown> = {}): Promise<T> => {
        if (method === "get_bounties") return structuredClone(this.bounties) as T;
        if (method === "get_bids") return structuredClone(this.bids.filter((x) => x.bounty_id === args.bounty_id)) as T;
        throw new Error(`fake: unknown view ${method}`);
      },
      call: async (method, args, opts) => {
        this.calls.push({ caller, method, args, gasTGas: opts?.gasTGas });
        const txHash = `tx${this.calls.length}`;
        if (method === "place_bid") {
          const b = this.bounties[args.bounty_id as number]!;
          const bid: Bid = {
            id: this.bids.length,
            bounty_id: b.id,
            round: b.round,
            worker: caller,
            tier: 1,
            price_yocto: String(args.price_yocto),
            eta_ms: args.eta_ms as number,
            signature: String(args.signature),
            signed_payload: "",
            status: "Pending",
            reject_reason: null,
            created_ms: 0,
          };
          this.bids.push(bid);
          b.bid_ids.push(bid.id);
          if (b.status === "Open") b.status = "Bidding";
          return { txHash, result: bid.id };
        }
        if (method === "submit_work") {
          const b = this.bounties[args.bounty_id as number]!;
          b.deliverable_hash = String(args.deliverable_hash);
          b.status = "Verifying";
          return { txHash, result: null };
        }
        if (method === "verify_bounty") {
          const b = this.bounties[args.bounty_id as number]!;
          b.check_results_hash = String(args.check_results_hash);
          b.score = args.score as number;
          b.status = args.passed ? "Completed" : "Open";
          return { txHash, result: null };
        }
        throw new Error(`fake: unknown call ${method}`);
      },
    };
  }

  /** Test helper standing in for the coordinator: mark one bid Won, other pending bids Lost. */
  select(bountyId: number, bidId: number): void {
    const b = this.bounties[bountyId]!;
    for (const x of this.bids) {
      if (x.bounty_id !== bountyId || x.status !== "Pending") continue;
      x.status = x.id === bidId ? "Won" : "Lost";
    }
    b.winner_bid_id = bidId;
    b.status = "InProgress";
  }
}
