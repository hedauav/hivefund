"use client";

import { useCallback, useState } from "react";
import { useHub } from "@/providers/data-provider";
import { Town } from "@/components/town/town";
import { Drawer } from "@/components/town/drawer";
import type { BuildingId } from "@/components/town/world";
import { StatsRow } from "@/components/stats-row";
import { BountyBoard } from "@/components/bounty-board";
import { BidBoard } from "@/components/bid-board";
import { VerificationPanel } from "@/components/verification-panel";
import { HivePanel } from "@/components/hive-panel";
import { WorkerPanel } from "@/components/worker-panel";
import { TreasuryPanel } from "@/components/treasury-panel";
import { ReputationTable } from "@/components/reputation-table";
import { ActivityFeed } from "@/components/activity-feed";
import { LoadState } from "@/components/load-state";

export default function Dashboard() {
  const { snapshot } = useHub();
  const [picked, setPicked] = useState<number | null>(null);
  const [drawer, setDrawer] = useState<BuildingId | null>(null);
  const open = useCallback((id: BuildingId, bounty?: number) => {
    if (bounty != null) setPicked(bounty);
    setDrawer(id);
  }, []);
  const close = useCallback(() => setDrawer(null), []);

  if (!snapshot) return <LoadState />;

  // Inspected bounty: the reader's pick, else the most recently verified one, else the latest with bids.
  const byRecent = [...snapshot.bounties].sort((a, b) => b.updated_ms - a.updated_ms);
  const featured =
    byRecent.find((b) => b.id === picked) ??
    byRecent.find((b) => b.check_results_hash) ??
    byRecent.find((b) => b.bid_ids.length) ??
    byRecent[0];

  return (
    <>
      <div className="bleed">
        <Town onOpen={open} />
      </div>
      <Drawer open={drawer} bounty={featured} onPick={setPicked} onClose={close} />

      <div className="mt-10 space-y-8">
        <div className="ledger-intro">
          <h2 className="ledger-heading">The town ledger</h2>
          <p>Everything the town acts out, as plain tables. Contract state is read live from NEAR testnet; reports and rationales are re-hashed in your browser.</p>
        </div>
        <StatsRow />
        <div className="grid gap-8 lg:grid-cols-12 [&>*]:min-w-0">
          <div className={featured ? "lg:col-span-7" : "lg:col-span-12"}>
            <BountyBoard selected={featured?.id ?? null} onSelect={setPicked} />
          </div>
          {featured && (
            <div className="lg:col-span-5">
              <BidBoard bounty={featured} compact />
            </div>
          )}
        </div>
        {featured && <VerificationPanel bounty={featured} />}
        <HivePanel />
        <WorkerPanel />
        <div className="grid gap-8 lg:grid-cols-12 [&>*]:min-w-0">
          <div className="lg:col-span-5">
            <TreasuryPanel />
          </div>
          <div className="lg:col-span-7">
            <ReputationTable />
          </div>
        </div>
        <ActivityFeed />
      </div>
    </>
  );
}
