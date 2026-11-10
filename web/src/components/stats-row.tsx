"use client";

import { useHub } from "@/providers/data-provider";
import { hive, near } from "@/lib/format";
import { Stat } from "./ui";

export function StatsRow() {
  const { snapshot } = useHub();
  if (!snapshot) return null;
  const { bounties, bids, treasury, config } = snapshot;
  const completed = bounties.filter((b) => b.status === "Completed").length;
  const open = bounties.filter((b) => ["Open", "Bidding", "InProgress", "Verifying"].includes(b.status)).length;
  const rejected = bids.filter((b) => b.status === "Rejected").length;
  const failedVerifications = bounties.reduce((n, b) => n + b.attempts, 0);
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      <Stat label="Bounties" value={bounties.length} hint={`${open} active · ${completed} completed`} />
      <Stat label="Bids" value={bids.length} hint={`${rejected} rejected`} />
      <Stat label="Failed verifications" value={failedVerifications} hint="each reopens bidding" />
      <Stat label="Paid to workers" value={near(treasury.paid_out, 2)} hint={`${near(treasury.escrowed, 2)} in escrow`} />
      <Stat label="HIVE minted" value={hive(config.total_minted, 2)} hint="only on verified passes" />
    </div>
  );
}
