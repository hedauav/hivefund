"use client";

import { useHub } from "@/providers/data-provider";
import { near } from "@/lib/format";
import { Account, Card, Empty } from "./ui";
import { FundTreasury } from "./fund-treasury";

export function TreasuryPanel() {
  const { snapshot } = useHub();
  const t = snapshot?.treasury;
  const cfg = snapshot?.config;
  if (!t || !cfg) {
    return (
      <Card id="treasury" title="Treasury">
        <Empty>Loading…</Empty>
      </Card>
    );
  }
  const funded = BigInt(t.funded_total) || 1n;
  const share = (v: string) => Number((BigInt(v) * 1000n) / funded) / 10;
  const capUsed = Number((BigInt(t.committed_total) * 1000n) / (BigInt(t.spend_cap) || 1n)) / 10;
  const rows: [string, string, string][] = [
    ["Available", t.available, "bg-ok"],
    ["Escrowed in open bounties", t.escrowed, "bg-accent"],
    ["Paid out to workers", t.paid_out, "bg-info"],
  ];
  return (
    <Card id="treasury" n="07" title="Treasury">
      <div className="text-2xl font-semibold tracking-tight">{near(t.available, 3)}</div>
      <div className="text-xs text-muted">available of {near(t.funded_total, 3)} funded</div>

      <div className="mt-3 flex h-2.5 w-full overflow-hidden bg-panel-2">
        {rows.map(([label, v, color]) => (
          <div key={label} className={color} style={{ width: `${share(v)}%` }} title={`${label}: ${near(v)}`} />
        ))}
      </div>
      <dl className="mt-3 space-y-1.5 text-sm">
        {rows.map(([label, v, color]) => (
          <div key={label} className="flex items-center gap-2">
            <span className={`h-2 w-2 ${color}`} />
            <dt className="text-muted">{label}</dt>
            <dd className="ml-auto font-medium">{near(v)}</dd>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 bg-muted" />
          <dt className="text-muted">Refunded from cancelled bounties</dt>
          <dd className="ml-auto font-medium">{near(t.refunded_total)}</dd>
        </div>
        <div className="flex items-center gap-2 border-t border-line pt-1.5">
          <dt className="text-muted">Spend cap used</dt>
          <dd className="ml-auto font-medium">
            {near(t.committed_total, 2)} / {near(t.spend_cap, 0)} <span className="text-xs text-muted">({capUsed}%)</span>
          </dd>
        </div>
      </dl>

      <div className="mt-3 grid grid-cols-1 gap-1 text-xs text-muted">
        <div>
          owner <Account id={cfg.owner} full />
        </div>
        <div>
          coordinator <Account id={cfg.coordinator} full />
        </div>
        <div>
          verifier <Account id={cfg.verifier} full />
        </div>
      </div>

      <div className="mt-4">
        <FundTreasury />
      </div>
    </Card>
  );
}
