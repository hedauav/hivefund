"use client";

import Link from "next/link";
import { useState } from "react";
import type { ActivityKind } from "@hivefund/shared";
import { useHub } from "@/providers/data-provider";
import { near, timeAgo } from "@/lib/format";
import { Account, BlockLink, Card, Chip, Empty } from "./ui";

const TONE: Partial<Record<ActivityKind, string>> = {
  BidRejected: "bg-bad-soft text-bad",
  VerificationFailed: "bg-bad-soft text-bad",
  MintFailed: "bg-bad-soft text-bad",
  BountyCancelled: "bg-bad-soft text-bad",
  BountyReopened: "bg-warn-soft text-warn",
  VerificationPassed: "bg-ok-soft text-ok",
  Payout: "bg-ok-soft text-ok",
  Mint: "bg-accent-soft text-accent-text",
  TreasuryFunded: "bg-ok-soft text-ok",
  WinnerSelected: "bg-accent-soft text-accent-text",
};

export function ActivityFeed({ bountyId, limit = 40 }: { bountyId?: number; limit?: number }) {
  const { snapshot } = useHub();
  const [onlyProblems, setOnlyProblems] = useState(false);
  let rows = [...(snapshot?.activity ?? [])].reverse();
  if (bountyId != null) rows = rows.filter((r) => r.bounty_id === bountyId);
  if (onlyProblems) rows = rows.filter((r) => TONE[r.kind]?.includes("bad") || r.kind === "BountyReopened");
  const shown = rows.slice(0, limit);
  return (
    <Card
      id="activity"
      n="09"
      title="Ledger"
      subtitle="every contract action, rejections included"
      action={
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} className="accent-[var(--info)]" />
          rejections & failures only
        </label>
      }
    >
      {!shown.length ? (
        <Empty>No activity.</Empty>
      ) : (
        <ol className="space-y-1.5">
          {shown.map((a) => (
            <li key={a.id} className="grid grid-cols-[1fr_auto] items-start gap-x-3 border-b border-dashed border-hair pb-1.5 text-sm last:border-0 sm:grid-cols-[10.5rem_1fr_auto]">
              <div className="col-span-2 mb-0.5 sm:col-span-1 sm:mb-0">
                <Chip tone={TONE[a.kind] ?? "bg-panel-2 text-muted"}>{a.kind}</Chip>
              </div>
              <div className="min-w-0">
                <span className="break-words">{a.detail}</span>
                <div className="text-[11px] text-muted">
                  <Account id={a.actor} />
                  {a.bounty_id != null && (
                    <>
                      {" · "}
                      <Link className="hover:text-accent-text" href={`/bounty/${a.bounty_id}`}>
                        bounty #{a.bounty_id}
                      </Link>
                    </>
                  )}
                  {a.bid_id != null && <> · bid #{a.bid_id}</>}
                  {a.amount && <> · {a.kind === "Mint" ? "" : near(a.amount)}</>}
                </div>
              </div>
              <div className="text-right text-[11px] text-muted">
                <BlockLink height={a.block_height} />
                <div>{timeAgo(a.ts_ms)}</div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
