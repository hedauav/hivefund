"use client";

import Link from "next/link";
import type { Bounty } from "@hivefund/shared";
import { useHub } from "@/providers/data-provider";
import { near, hive, timeAgo, shortHash } from "@/lib/format";
import { Account, BountyStatusChip, Card, Empty, Mono, TxLink } from "./ui";
import { useProcurement } from "@/hooks/use-procurement";
import { ProcurementTag } from "./procurement-view";

export function BountyBoard({ selected, onSelect }: { selected?: number | null; onSelect?: (id: number) => void }) {
  const { snapshot, txs } = useHub();
  const bounties = [...(snapshot?.bounties ?? [])].sort((a, b) => b.updated_ms - a.updated_ms);
  const procurement = useProcurement(snapshot?.bounties);
  return (
    <Card id="bounties" n="02" title="Bounties" subtitle="budget held in escrow until verified">
      {!bounties.length ? (
        <Empty>No bounties posted yet.</Empty>
      ) : (
        <div className="-mx-4 overflow-x-auto">
          <table className="ledger w-full min-w-[560px] text-sm">
            <thead className="text-left">
              <tr>
                <th className="px-4 py-2 font-medium">#</th>
                <th className="px-2 py-2 font-medium">Bounty</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 text-right font-medium">Budget</th>
                <th className="px-2 py-2 text-center font-medium">Rnd / fail</th>
                <th className="px-4 py-2 font-medium">Record</th>
              </tr>
            </thead>
            <tbody>
              {bounties.map((b) => (
                <BountyRow key={b.id} b={b} active={selected === b.id} onSelect={onSelect} postTx={txs.bountyPosted(b.id, b.title)} procurement={procurement.has(b.id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function BountyRow({
  b,
  active,
  onSelect,
  postTx,
  procurement,
}: {
  b: Bounty;
  active: boolean;
  onSelect?: (id: number) => void;
  postTx: string | null;
  procurement: boolean;
}) {
  const bidsCount = b.bid_ids.length;
  return (
    <tr
      className={`${onSelect ? "cursor-pointer hover:bg-panel-2" : ""} ${active ? "bg-accent-soft shadow-[inset_3px_0_0_var(--accent)]" : ""}`}
      onClick={() => onSelect?.(b.id)}
    >
      <td className="px-4 py-2.5 font-mono text-xs text-muted">{b.id}</td>
      <td className="px-2 py-2.5">
        <Link href={`/bounty/${b.id}`} className="font-medium hover:text-accent-text" onClick={(e) => e.stopPropagation()}>
          {b.title}
        </Link>
        {procurement && <ProcurementTag />}
        <div className="text-xs text-muted">
          {bidsCount} bid{bidsCount === 1 ? "" : "s"} · tier ≥{b.min_tier} · due {timeAgo(b.deadline_ms)}
          {b.status === "Completed" && BigInt(b.hive_minted) > 0n && <> · minted {hive(b.hive_minted, 2)}</>}
          {b.winner_bid_id != null && (
            <>
              {" "}
              · winner bid #{b.winner_bid_id}
            </>
          )}
        </div>
      </td>
      <td className="px-2 py-2.5">
        <BountyStatusChip status={b.status} />
      </td>
      <td className="whitespace-nowrap px-2 py-2.5 text-right font-medium">{near(b.budget_yocto, 2)}</td>
      <td className="px-2 py-2.5 text-center">
        <span className="font-mono text-xs">
          {b.round} / <span className={b.attempts ? "text-bad" : ""}>{b.attempts}</span>
        </span>
      </td>
      <td className="px-4 py-2.5 text-xs" onClick={(e) => e.stopPropagation()}>
        <div>
          spec{" "}
          <Link href={`/bounty/${b.id}#spec`} className="text-info underline underline-offset-2">
            <Mono title={b.spec_hash}>{shortHash(b.spec_hash, 6)}</Mono>
          </Link>
        </div>
        <div className="whitespace-nowrap">
          post <TxLink hash={postTx} /> · <Account id={b.poster} />
        </div>
      </td>
    </tr>
  );
}
