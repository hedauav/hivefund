"use client";

import { useHub } from "@/providers/data-provider";
import { Account, Card, Empty } from "./ui";

/** get_reputation: completed*10 + total_score/10 − failed*15 (floored at 0), computed on-chain. */
export function ReputationTable() {
  const { snapshot } = useHub();
  const rows = [...(snapshot?.reputation ?? [])].sort((a, b) => b.reputation - a.reputation);
  const max = Math.max(1, ...rows.map((r) => r.reputation));
  return (
    <Card title="Reputation" subtitle="On-chain: completed×10 + Σscore/10 − failed×15">
      {!rows.length ? (
        <Empty>No workers yet.</Empty>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r, i) => (
            <li key={r.account_id}>
              <div className="flex items-center gap-2 text-sm">
                <span className="w-4 font-mono text-xs text-muted">{i + 1}</span>
                <Account id={r.account_id} />
                <span className="ml-auto font-semibold">{r.reputation}</span>
              </div>
              <div className="ml-6 mt-1 h-1.5 rounded-full bg-panel-2">
                <div className="h-1.5 rounded-full bg-accent" style={{ width: `${(r.reputation / max) * 100}%` }} />
              </div>
              <div className="ml-6 mt-0.5 text-[11px] text-muted">
                {r.completed} done · {r.failed} failed · Σscore {r.total_score}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
