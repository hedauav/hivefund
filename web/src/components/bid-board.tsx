"use client";

import { useMemo } from "react";
import { verifyBid, type Bid, type Bounty, type SelectionRationale, type WorkerView } from "@hivefund/shared";
import { useHub } from "@/providers/data-provider";
import { useOffchain } from "@/hooks/use-offchain";
import { minutes, near, shortHash } from "@/lib/format";
import { Account, BidStatusChip, Card, Check, Chip, cx, Empty, TxLink } from "./ui";

const RED: Bid["status"][] = ["Rejected", "Superseded", "Failed"];

export function BidBoard({ bounty, compact = false }: { bounty: Bounty; compact?: boolean }) {
  const { snapshot, index } = useHub();
  const bids = useMemo(() => (snapshot?.bids ?? []).filter((b) => b.bounty_id === bounty.id), [snapshot, bounty.id]);
  const rounds = [...new Set(bids.map((b) => b.round))].sort((a, z) => z - a);
  const workers = useMemo(() => new Map((snapshot?.reputation ?? []).map((w) => [w.account_id, w])), [snapshot]);
  return (
    <Card
      n="03"
      title={`Bids on #${bounty.id}`}
      subtitle={compact ? bounty.title : "all rounds, rejected bids included"}
    >
      {!bids.length ? (
        <Empty hint="Workers decide on their own whether a bounty is worth bidding on.">No bids on this bounty yet.</Empty>
      ) : (
        <div className="space-y-5">
          {rounds.map((r) => {
            const sel = index.find((e) => e.kind === "selection" && e.bounty_id === bounty.id && e.round === r);
            return <RoundBids key={r} bounty={bounty} round={r} bids={bids.filter((b) => b.round === r)} selectionHash={sel?.hash ?? null} workers={workers} compact={compact} />;
          })}
        </div>
      )}
    </Card>
  );
}

function RoundBids({
  bounty,
  round,
  bids,
  selectionHash,
  workers,
  compact,
}: {
  compact: boolean;
  bounty: Bounty;
  round: number;
  bids: Bid[];
  selectionHash: string | null;
  workers: Map<string, WorkerView>;
}) {
  const { config } = useHub();
  const sel = useOffchain<SelectionRationale>(selectionHash);
  const rationale = sel.status === "ok" ? sel.object : null;
  const live = config?.mode === "live";
  const hub = config?.hub ?? null;
  const sorted = [...bids].sort((a, z) => scoreOf(rationale, z) - scoreOf(rationale, a) || a.id - z.id);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="font-semibold text-ink">Round {round}</span>
        {round === bounty.round && bounty.status !== "Completed" && bounty.status !== "Cancelled" && <Chip tone="bg-info-soft text-info">current</Chip>}
        {rationale ? (
          <span>
            {!compact && (
              <>
                score = {rationale.weights.price}·(1−price/budget) + {rationale.weights.eta}·(1−eta/max) + {rationale.weights.reputation}·rep/max ·{" "}
              </>
            )}
            <a href={`/api/offchain/${selectionHash}`} target="_blank" rel="noreferrer" className="text-info underline underline-offset-2">
              rationale {shortHash(selectionHash, 6)}
            </a>{" "}
            <Check ok>hash verified</Check>
          </span>
        ) : selectionHash ? (
          <span>{sel.status === "loading" ? "loading rationale…" : `rationale unavailable (${sel.status})`}</span>
        ) : (
          <span>no selection published for this round yet</span>
        )}
      </div>
      <div className="-mx-4 overflow-x-auto">
        <table className={cx("ledger w-full text-sm", compact ? "min-w-[380px]" : "min-w-[760px]")}>
          <thead className="text-left">
            <tr>
              <th className="px-4 py-1.5 font-medium">Bid</th>
              <th className="px-2 py-1.5 font-medium">Worker</th>
              <th className="px-2 py-1.5 text-right font-medium">Price</th>
              {!compact && <th className="px-2 py-1.5 text-right font-medium">ETA</th>}
              <th className="px-2 py-1.5 text-right font-medium">Score</th>
              {!compact && <th className="px-2 py-1.5 font-medium">Signature</th>}
              <th className="px-2 py-1.5 font-medium">Status</th>
              {!compact && <th className="px-4 py-1.5 font-medium">Tx</th>}
            </tr>
          </thead>
          <tbody>
            {sorted.map((b) => {
              const cand = rationale?.candidates.find((c) => c.bid_id === b.id);
              const w = workers.get(b.worker);
              const sig = signatureState(b, w, hub, live, cand?.sig_valid);
              const red = RED.includes(b.status);
              const winner = b.status === "Won" || b.status === "Paid" || bounty.winner_bid_id === b.id;
              return (
                <tr
                  key={b.id}
                  className={cx(
                    red && "bg-bad-soft text-bad",
                    winner && !red && "bg-accent-soft font-semibold",
                  )}
                >
                  <td className="px-4 py-2 font-mono text-xs">
                    {winner && !red && <span className="mr-1">★</span>}#{b.id}
                  </td>
                  <td className="px-2 py-2">
                    <Account id={b.worker} />
                    <span className="ml-1 text-[11px] text-muted">t{b.tier}</span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-right">{near(b.price_yocto)}</td>
                  {!compact && <td className="px-2 py-2 text-right text-xs">{minutes(b.eta_ms)}</td>}
                  <td className="px-2 py-2 text-right font-mono text-xs">{cand ? cand.score.toFixed(3) : "—"}</td>
                  {!compact && (
                    <td className="px-2 py-2">
                      <Check ok={sig.ok}>{sig.label}</Check>
                    </td>
                  )}
                  <td className={cx("px-2 py-2", compact && "pr-4")}>
                    <BidStatusChip status={b.status} />
                    {b.reject_reason && <div className="mt-0.5 text-[11px] font-medium text-bad">{b.reject_reason}</div>}
                    {compact && (
                      <div className="mt-0.5 space-y-0.5 text-[11px] font-normal">
                        <Check ok={sig.ok}>sig {sig.ok === null ? "unchecked" : sig.ok ? "ok" : "bad"}</Check>
                        <BidTxs bid={b} bounty={bounty} winner={winner} />
                      </div>
                    )}
                  </td>
                  {!compact && (
                    <td className="px-4 py-2 text-xs">
                      <BidTxs bid={b} bounty={bounty} winner={winner} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** bid, reject and select transactions for one bid row. */
function BidTxs({ bid, bounty, winner }: { bid: Bid; bounty: Bounty; winner: boolean }) {
  const { txs } = useHub();
  return (
    <>
      <div className="whitespace-nowrap">
        bid <TxLink hash={txs.bid(bid)} />
      </div>
      {bid.status === "Rejected" && bid.reject_reason === "invalid bid signature" && (
        <div className="whitespace-nowrap">
          reject <TxLink hash={txs.rejection(bounty.id, bid.id)} />
        </div>
      )}
      {winner && bounty.winner_bid_id === bid.id && (
        <div className="whitespace-nowrap">
          select <TxLink hash={txs.selection(bounty.id, bid.id)} />
        </div>
      )}
    </>
  );
}

function scoreOf(r: SelectionRationale | null, b: Bid) {
  return r?.candidates.find((c) => c.bid_id === b.id)?.score ?? -1;
}

/**
 * Live: verify the ed25519 bid signature in the browser against the worker's
 * on-chain signing_pk (and that the stored payload commits to this hub).
 * Sample: fall back to the coordinator's recorded verdict.
 */
function signatureState(
  b: Bid,
  w: WorkerView | undefined,
  hub: string | null,
  live: boolean,
  recorded: boolean | undefined,
): { ok: boolean | null; label: string } {
  if (live && w) {
    const ok = verifyBid(b.signed_payload, b.signature, w.signing_pk) && (!hub || b.signed_payload.includes(`"contract":"${hub}"`));
    return { ok, label: ok ? "valid (browser)" : "INVALID" };
  }
  if (recorded !== undefined) return { ok: recorded, label: recorded ? "valid" : "invalid" };
  if (b.reject_reason === "invalid bid signature") return { ok: false, label: "invalid" };
  return { ok: null, label: "unchecked" };
}
