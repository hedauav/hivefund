"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import type { Bounty } from "@hivefund/shared";
import { useHub } from "@/providers/data-provider";
import { hive, near, timeAgo } from "@/lib/format";
import { BountyBoard } from "../bounty-board";
import { BidBoard } from "../bid-board";
import { VerificationPanel } from "../verification-panel";
import { TreasuryPanel } from "../treasury-panel";
import { ReputationTable } from "../reputation-table";
import { HivePanel } from "../hive-panel";
import { Account, BidStatusChip, Empty } from "../ui";
import { byId, type BuildingId } from "./world";

const BLURB: Record<BuildingId, string> = {
  board: "Every bounty the coordinator has pinned, and the bids workers left on it.",
  hall: "The coordinator checks each bid's signature against the worker's on-chain key, scores the valid ones and stamps a winner. Its reasoning is stored off-chain and its hash sits on-chain.",
  lab: "Automated checks run first, then the rubric. The report is hashed; this page re-hashes it and compares with the chain.",
  vault: "NEAR held by the hub contract: escrowed per bounty, paid out only after a verified pass.",
  mint: "HIVE is minted by the hub alone, on a verified pass: winning bid × score × rate. No one else can call mint; the owner can still change the minter and mint rate.",
  "house-cheap": "Lowest margin, quickest model, doesn't read the acceptance test.",
  "house-quality": "Higher margin, strongest model, reads the full test before it builds.",
  "house-adaptive": "Learns from its last five outcomes and changes its margin and effort — every change is logged with a reason.",
  shack: "An adversarial account that signs bids with the wrong key. Its bids should always be caught.",
};

export function Drawer({
  open,
  bounty,
  onPick,
  onClose,
}: {
  open: BuildingId | null;
  bounty: Bounty | undefined;
  onPick: (id: number) => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  const b = byId[open];
  return (
    <div className="drawer-root">
      <button className="drawer-scrim" aria-label="Close the ledger" onClick={onClose} tabIndex={-1} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <header className="drawer-head">
          <div className="min-w-0">
            <p className="drawer-kicker">Ledger</p>
            <h2 id="drawer-title" className="drawer-title">
              {b.label}
            </h2>
          </div>
          <button ref={closeRef} className="pxbtn ml-auto" onClick={onClose}>
            Close
          </button>
        </header>
        <p className="drawer-blurb">{BLURB[open]}</p>
        <div className="drawer-body">
          {open === "board" && (
            <>
              <BountyBoard selected={bounty?.id ?? null} onSelect={onPick} />
              {bounty && <BidBoard bounty={bounty} />}
            </>
          )}
          {open === "hall" && (bounty ? <BidBoard bounty={bounty} /> : <Empty>No bounty has bids yet.</Empty>)}
          {open === "lab" && (bounty ? <VerificationPanel bounty={bounty} /> : <Empty>Nothing has been verified yet.</Empty>)}
          {open === "vault" && (
            <>
              <TreasuryPanel />
              <ReputationTable />
            </>
          )}
          {open === "mint" && <HivePanel />}
          {open.startsWith("house-") && <WorkerFocus role={open.slice(6)} />}
          {open === "shack" && <WorkerFocus role="forger" />}
          {bounty && (open === "board" || open === "hall" || open === "lab") && (
            <Link href={`/bounty/${bounty.id}`} className="drawer-more">
              Full history of bounty #{bounty.id} →
            </Link>
          )}
        </div>
      </aside>
    </div>
  );
}

/** One worker: its on-chain record, every bid it placed, and (for adaptive) why it changed strategy. */
function WorkerFocus({ role }: { role: string }) {
  const { snapshot, strategy } = useHub();
  const w = snapshot?.reputation.find((x) => x.account_id.split(".")[0] === role);
  const bids = useMemo(() => (snapshot?.bids ?? []).filter((b) => b.worker.split(".")[0] === role).sort((a, b) => b.id - a.id), [snapshot, role]);
  const notes = useMemo(
    () => Object.entries(strategy).filter(([k]) => k.split(".")[0] === role).flatMap(([, v]) => v).sort((a, b) => b.ts_ms - a.ts_ms),
    [strategy, role],
  );
  if (!w) return <Empty hint="Workers appear once the owner registers them on the hub.">No on-chain record for {role} yet.</Empty>;
  const wins = bids.filter((b) => b.status === "Won" || b.status === "Paid" || b.status === "Failed").length;
  const decided = bids.filter((b) => !["Pending", "Rejected", "Superseded"].includes(b.status)).length;
  return (
    <div className="space-y-4">
      <section className="sheet">
        <div className="grid grid-cols-2 gap-px bg-hair sm:grid-cols-4 [&>*]:bg-panel">
          <Fact label="account" value={<Account id={w.account_id} />} />
          <Fact label="tier" value={w.tier} />
          <Fact label="reputation" value={w.reputation} />
          <Fact label="win rate" value={decided ? `${Math.round((wins / decided) * 100)}%` : "—"} />
          <Fact label="completed" value={w.completed} />
          <Fact label="failed" value={w.failed} />
          <Fact label="earned" value={near(w.earned_yocto, 4)} />
          <Fact label="HIVE earned" value={hive(w.hive_earned, 3)} />
        </div>
      </section>
      <section className="sheet">
        <header className="sheet-head">
          <h3 className="sheet-title">Bids ({bids.length})</h3>
        </header>
        {bids.length ? (
          <table className="ledger w-full text-sm">
            <thead>
              <tr>
                <th>Bid</th>
                <th>Bounty</th>
                <th className="text-right">Price</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {bids.map((b) => (
                <tr key={b.id}>
                  <td className="font-mono text-xs">#{b.id}</td>
                  <td>
                    <Link className="text-info underline underline-offset-2" href={`/bounty/${b.bounty_id}`}>
                      #{b.bounty_id}
                    </Link>
                    <span className="text-xs text-muted"> r{b.round}</span>
                  </td>
                  <td className="text-right font-mono text-xs">{near(b.price_yocto, 4)}</td>
                  <td>
                    <BidStatusChip status={b.status} />
                    {b.reject_reason && <span className="ml-1 text-xs text-bad">{b.reject_reason}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="p-4 text-sm text-muted">No bids yet. Workers decide independently whether a bounty is worth bidding on.</p>
        )}
      </section>
      {notes.length > 0 && (
        <section className="sheet">
          <header className="sheet-head">
            <h3 className="sheet-title">Strategy changes</h3>
          </header>
          <ul className="divide-y divide-hair text-sm">
            {notes.map((n) => (
              <li key={n.ts_ms} className="px-4 py-2">
                <span className="font-mono text-xs">
                  {Math.round(n.old_margin * 100)}% → {Math.round(n.new_margin * 100)}%
                </span>{" "}
                {n.reason} <span className="text-xs text-muted">· {timeAgo(n.ts_ms)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="px-3 py-2">
      <div className="pxlabel text-muted">{label}</div>
      <div className="mt-0.5 text-sm font-semibold">{value}</div>
    </div>
  );
}
