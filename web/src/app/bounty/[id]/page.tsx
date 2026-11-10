"use client";

import Link from "next/link";
import { use } from "react";
import { useHub } from "@/providers/data-provider";
import { near, hive, clock, shortHash } from "@/lib/format";
import { BidBoard } from "@/components/bid-board";
import { VerificationPanel } from "@/components/verification-panel";
import { SpecPanel } from "@/components/spec-panel";
import { ActivityFeed } from "@/components/activity-feed";
import { LoadState } from "@/components/load-state";
import { Account, BountyStatusChip, Card, Mono, TxLink } from "@/components/ui";

export default function BountyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { snapshot, txs, explorer, config } = useHub();
  if (!snapshot) return <LoadState />;
  const bounty = snapshot.bounties.find((b) => b.id === Number(id));
  if (!bounty) {
    return (
      <div className="space-y-3">
        <Link href="/" className="text-sm text-accent-text hover:underline">
          ← Dashboard
        </Link>
        <p className="text-sm text-muted">Bounty #{id} does not exist on this hub.</p>
      </div>
    );
  }
  const winner = bounty.winner_bid_id != null ? snapshot.bids.find((b) => b.id === bounty.winner_bid_id) : undefined;

  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm text-accent-text hover:underline">
        ← Dashboard
      </Link>
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <div className="text-xs font-mono text-muted">bounty #{bounty.id}</div>
          <h1 className="text-2xl font-semibold tracking-tight">{bounty.title}</h1>
        </div>
        <BountyStatusChip status={bounty.status} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <Card title="On-chain record" subtitle={config?.hub ? <>get_bounty on {explorer.enabled ? <Account id={config.hub} full /> : config.hub}</> : "sample data"}>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted">Budget (escrow)</dt>
            <dd className="font-medium">{near(bounty.budget_yocto)}</dd>
            <dt className="text-muted">Poster</dt>
            <dd>
              <Account id={bounty.poster} />
            </dd>
            <dt className="text-muted">Post tx</dt>
            <dd>
              <TxLink hash={txs.bountyPosted(bounty.id, bounty.title)} />
            </dd>
            <dt className="text-muted">Deadline</dt>
            <dd>{clock(bounty.deadline_ms)}</dd>
            <dt className="text-muted">Min tier</dt>
            <dd>{bounty.min_tier}</dd>
            <dt className="text-muted">Round / failed</dt>
            <dd>
              {bounty.round} / {bounty.attempts} <span className="text-xs text-muted">(2 failures cancel + refund)</span>
            </dd>
            <dt className="text-muted">Excluded</dt>
            <dd>{bounty.excluded.length ? bounty.excluded.map((e) => <Account key={e} id={e} />) : "—"}</dd>
            <dt className="text-muted">Winner</dt>
            <dd>
              {winner ? (
                <>
                  bid #{winner.id} · <Account id={winner.worker} /> · {near(winner.price_yocto)}
                </>
              ) : (
                "—"
              )}
            </dd>
            <dt className="text-muted">Deliverable</dt>
            <dd>
              <Mono title={bounty.deliverable_hash ?? ""}>{shortHash(bounty.deliverable_hash)}</Mono>
              {bounty.deliverable_hash && (
                <>
                  {" "}
                  <TxLink hash={txs.submission(bounty.id, bounty.deliverable_hash)} />
                </>
              )}
            </dd>
            <dt className="text-muted">Score</dt>
            <dd>{bounty.score ?? "—"}</dd>
            <dt className="text-muted">HIVE minted</dt>
            <dd className="font-medium">{hive(bounty.hive_minted, 4)}</dd>
          </dl>
        </Card>
        <div className="lg:col-span-2">
          <SpecPanel bounty={bounty} />
        </div>
      </div>

      <BidBoard bounty={bounty} />
      <VerificationPanel bounty={bounty} />
      <ActivityFeed bountyId={bounty.id} limit={100} />
    </div>
  );
}
