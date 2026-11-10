"use client";

import Link from "next/link";
import type { Bounty } from "@hivefund/shared";
import { useHub } from "@/providers/data-provider";
import { near, hive, timeAgo, shortHash } from "@/lib/format";
import { Account, BountyStatusChip, Card, Empty, Mono, TxLink } from "./ui";

export function BountyBoard({ selected, onSelect }: { selected?: number | null; onSelect?: (id: number) => void }) {
  const { snapshot, txs } = useHub();
  const bounties = [...(snapshot?.bounties ?? [])].sort((a, b) => b.updated_ms - a.updated_ms);
  return (
    <Card id="bounties" title="Bounty board" subtitle="Bounties held in escrow by the bounty-hub contract">
      {!bounties.length ? (
        <Empty>No bounties posted yet.</Empty>
      ) : (
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wider text-muted">
              <tr className="border-b border-line">
                <th className="px-4 py-2 font-medium">#</th>
                <th className="px-2 py-2 font-medium">Bounty</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 text-right font-medium">Budget</th>
                <th className="px-2 py-2 text-center font-medium">Round / fails</th>
                <th className="px-2 py-2 font-medium">Deadline</th>
                <th className="px-2 py-2 font-medium">Spec</th>
                <th className="px-4 py-2 font-medium">Post tx</th>
              </tr>
            </thead>
            <tbody>
              {bounties.map((b) => (
                <BountyRow key={b.id} b={b} active={selected === b.id} onSelect={onSelect} postTx={txs.bountyPosted(b.id, b.title)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function BountyRow({ b, active, onSelect, postTx }: { b: Bounty; active: boolean; onSelect?: (id: number) => void; postTx: string | null }) {
  const bidsCount = b.bid_ids.length;
  return (
    <tr
      className={`border-b border-line/60 last:border-0 ${onSelect ? "cursor-pointer hover:bg-panel-2" : ""} ${active ? "bg-accent-soft/60" : ""}`}
      onClick={() => onSelect?.(b.id)}
    >
      <td className="px-4 py-2.5 font-mono text-xs text-muted">{b.id}</td>
      <td className="px-2 py-2.5">
        <Link href={`/bounty/${b.id}`} className="font-medium hover:text-accent-text" onClick={(e) => e.stopPropagation()}>
          {b.title}
        </Link>
        <div className="text-xs text-muted">
          {bidsCount} bid{bidsCount === 1 ? "" : "s"} · min tier {b.min_tier}
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
      <td className="px-2 py-2.5 text-right font-medium">{near(b.budget_yocto, 2)}</td>
      <td className="px-2 py-2.5 text-center">
        <span className="font-mono text-xs">
          {b.round} / <span className={b.attempts ? "text-bad" : ""}>{b.attempts}</span>
        </span>
      </td>
      <td className="px-2 py-2.5 text-xs text-muted">{timeAgo(b.deadline_ms)}</td>
      <td className="px-2 py-2.5">
        <Link href={`/bounty/${b.id}#spec`} onClick={(e) => e.stopPropagation()} className="hover:text-accent-text">
          <Mono title={b.spec_hash}>{shortHash(b.spec_hash, 6)}</Mono>
        </Link>
      </td>
      <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
        <TxLink hash={postTx} />
        <div className="text-[11px] text-muted">
          by <Account id={b.poster} />
        </div>
      </td>
    </tr>
  );
}
