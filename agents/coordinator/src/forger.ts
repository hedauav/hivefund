// Adversarial demo agent. It is a registered worker (so the contract accepts its transaction), but it
// signs bid commitments with a key that is NOT its registered signing_pk and undercuts everyone on price.
// The coordinator must catch it off-chain and reject it on-chain with "invalid bid signature".
import { bidPayload, signBid, type Bid, type Bounty } from "@hivefund/shared";
import type { WorkerContext } from "@hivefund/shared/node";

export interface ForgedBid {
  bounty_id: number;
  round: number;
  bid_id: number;
  price_yocto: string;
  txHash: string;
}

export class Forger {
  readonly name = "forger";
  readonly accountId: string;
  private readonly done = new Set<string>();

  constructor(private readonly ctx: WorkerContext) {
    this.accountId = ctx.accountId;
  }

  /** Bid once per round on every open bounty, at 40% of budget, with a forged signature. */
  async tick(): Promise<ForgedBid[]> {
    const out: ForgedBid[] = [];
    const bounties = await this.ctx.hub.view<Bounty[]>("get_bounties", { from_index: 0, limit: 100 });
    for (const b of bounties) {
      if (b.status !== "Open" && b.status !== "Bidding") continue;
      const key = `${b.id}:${b.round}`;
      if (this.done.has(key)) continue;
      const bids = await this.ctx.hub.view<Bid[]>("get_bids", { bounty_id: b.id });
      if (bids.some((x) => x.worker === this.accountId && x.round === b.round)) {
        this.done.add(key);
        continue;
      }
      const price_yocto = ((BigInt(b.budget_yocto) * 40n) / 100n).toString();
      const eta_ms = 600_000;
      const payload = bidPayload({ bounty_id: b.id, contract: this.ctx.contractId, eta_ms, price_yocto, round: b.round, worker: this.accountId });
      const signature = signBid(payload, this.ctx.bidKey); // wrong key on purpose
      try {
        const r = await this.ctx.hub.call<number>("place_bid", { bounty_id: b.id, price_yocto, eta_ms, signature });
        this.done.add(key);
        out.push({ bounty_id: b.id, round: b.round, bid_id: Number(r.result), price_yocto, txHash: r.txHash });
        this.ctx.log(`placed FORGED bid ${r.result} on bounty ${b.id} at ${price_yocto} yocto (tx ${r.txHash})`);
      } catch (e) {
        this.ctx.log(`forged bid on bounty ${b.id} failed: ${(e as Error).message}`);
        this.done.add(key);
      }
    }
    return out;
  }
}
