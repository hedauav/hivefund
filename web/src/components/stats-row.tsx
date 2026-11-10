"use client";

import { useHub } from "@/providers/data-provider";
import { hive, near } from "@/lib/format";
import { Stat } from "./ui";

/** One ruled strip of totals, read from the same snapshot as the rest of the page. */
export function StatsRow() {
  const { snapshot } = useHub();
  if (!snapshot) return null;
  const { bounties, bids, treasury, config } = snapshot;
  const completed = bounties.filter((b) => b.status === "Completed").length;
  const open = bounties.filter((b) => ["Open", "Bidding", "InProgress", "Verifying"].includes(b.status)).length;
  const rejected = bids.filter((b) => b.status === "Rejected").length;
  const failed = bounties.reduce((n, b) => n + b.attempts, 0);
  return (
    <div className="sheet grid grid-cols-2 divide-hair sm:grid-cols-3 lg:grid-cols-5 [&>*]:border-hair [&>*:not(:last-child)]:border-b sm:[&>*]:border-b-0 sm:[&>*:not(:last-child)]:border-r">
      <Stat label="Bounties" value={bounties.length} hint={`${open} open · ${completed} paid out`} />
      <Stat label="Bids" value={bids.length} hint={`${rejected} rejected on-chain`} />
      <Stat label="Failed checks" value={failed} hint="each one reopens bidding" />
      <Stat label="Paid to workers" value={near(treasury.paid_out, 2)} hint={`${near(treasury.escrowed, 2)} in escrow`} />
      <Stat label="HIVE minted" value={hive(config.total_minted, 2)} hint="verified passes only" />
    </div>
  );
}
