// Maps on-chain items to the transaction that created them, using the agents'
// tx log (${DATA}/tx.jsonl: {ts, actor, method, args, txHash}).
import type { Bid } from "@hivefund/shared";
import type { TxLogEntry } from "./snapshot";

type Args = Record<string, unknown> | undefined;
const arg = (e: TxLogEntry, k: string) => (e.args as Args)?.[k];

export class TxIndex {
  private rows: TxLogEntry[];
  constructor(rows: TxLogEntry[]) {
    // Failed transactions are real but did not change state; link the successful one.
    this.rows = rows.filter((r) => r.ok !== false);
  }

  get size() {
    return this.rows.length;
  }

  private find(pred: (e: TxLogEntry) => boolean, last = false): string | null {
    const list = this.rows.filter(pred);
    const hit = last ? list[list.length - 1] : list[0];
    return hit?.txHash ?? null;
  }

  bountyPosted(bountyId: number, title?: string): string | null {
    return (
      this.find((e) => e.method === "post_bounty" && (arg(e, "bounty_id") === bountyId || (title != null && arg(e, "title") === title))) ??
      null
    );
  }

  bid(b: Bid): string | null {
    return this.find(
      (e) =>
        e.method === "place_bid" &&
        e.actor === b.worker &&
        arg(e, "bounty_id") === b.bounty_id &&
        String(arg(e, "price_yocto")) === b.price_yocto,
    );
  }

  selection(bountyId: number, bidId: number): string | null {
    return this.find((e) => e.method === "select_winner" && arg(e, "bounty_id") === bountyId && arg(e, "bid_id") === bidId, true);
  }

  rejection(bountyId: number, bidId: number): string | null {
    return this.find((e) => e.method === "reject_bid" && arg(e, "bounty_id") === bountyId && arg(e, "bid_id") === bidId);
  }

  submission(bountyId: number, deliverableHash: string | null): string | null {
    return this.find(
      (e) => e.method === "submit_work" && arg(e, "bounty_id") === bountyId && (!deliverableHash || arg(e, "deliverable_hash") === deliverableHash),
      true,
    );
  }

  /** verify_bounty tx: also carries the payout transfer and the HIVE mint receipts. */
  verification(bountyId: number, checkResultsHash: string | null): string | null {
    return this.find(
      (e) =>
        e.method === "verify_bounty" &&
        arg(e, "bounty_id") === bountyId &&
        (!checkResultsHash || arg(e, "check_results_hash") === checkResultsHash),
      true,
    );
  }

  latest(method: string): string | null {
    return this.find((e) => e.method === method, true);
  }
}
