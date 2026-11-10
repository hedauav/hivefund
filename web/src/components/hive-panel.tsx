"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatHive, mintAmount, HIVE_DECIMALS } from "@hivefund/shared";
import { useHub } from "@/providers/data-provider";
import { clock, hive, near } from "@/lib/format";
import { Account, BlockLink, Card, Check, Empty, Stat, TxLink } from "./ui";

const toNum = (raw: string) => Number(BigInt(raw) / 10n ** BigInt(HIVE_DECIMALS - 4)) / 1e4;

export function HivePanel() {
  const { snapshot, tokenSupply, txs, config } = useHub();
  const supply = useMemo(() => snapshot?.supply ?? [], [snapshot]);
  const bounties = useMemo(() => new Map((snapshot?.bounties ?? []).map((b) => [b.id, b])), [snapshot]);
  const bids = useMemo(() => new Map((snapshot?.bids ?? []).map((b) => [b.id, b])), [snapshot]);
  const data = useMemo(() => {
    if (!supply.length) return [];
    const first = supply[0];
    return [
      { t: first.ts_ms - 60_000, total: 0 },
      ...supply.map((p) => ({ t: p.ts_ms, total: toNum(p.total_minted_after) })),
    ];
  }, [supply]);
  const totalMinted = snapshot?.config.total_minted ?? "0";
  const live = config?.mode === "live";

  return (
    <Card id="hive" n="05" title="HIVE supply" subtitle="minted by the hub on a verified pass; there is no admin mint">
      <div className="grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
        <Stat label="Total minted (hub)" value={hive(totalMinted, 2)} hint={`${supply.length} mint event${supply.length === 1 ? "" : "s"}`} />
        <Stat
          label="ft_total_supply (token)"
          value={tokenSupply ? hive(tokenSupply, 2) : "—"}
          hint={
            live && tokenSupply ? (
              <Check ok={tokenSupply === totalMinted}>{tokenSupply === totalMinted ? "matches hub ledger" : "differs (decay/burns?)"}</Check>
            ) : (
              "read from the token contract when live"
            )
          }
        />
        <Stat label="Mint rate" value={<span className="font-mono text-base">{snapshot?.config.mint_rate ?? "—"}</span>} hint="HIVE base units per milliNEAR·score/100" />
      </div>

      <div className="mt-4 border border-hair p-3">
        <div className="mb-1 text-xs font-medium text-muted">Supply over time</div>
        {data.length ? (
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="hiveFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={(t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                  stroke="var(--muted)"
                  fontSize={11}
                  tickLine={false}
                />
                <YAxis stroke="var(--muted)" fontSize={11} tickLine={false} axisLine={false} width={44} />
                <Tooltip
                  contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                  labelFormatter={(t) => clock(Number(t))}
                  formatter={(v) => [`${v} HIVE`, "total supply"]}
                />
                <Area type="stepAfter" dataKey="total" stroke="var(--chart-1)" strokeWidth={2} fill="url(#hiveFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <Empty>No HIVE minted yet. HIVE appears when a bounty passes verification.</Empty>
        )}
      </div>

      {!!supply.length && (
        <div className="mt-4">
          <div className="mb-1 text-xs font-medium text-muted">
            Every mint traced: <span className="font-mono">amount = bid_units × score / 100 × mint_rate</span> (bid_units = winning price in milliNEAR)
          </div>
          <div className="-mx-4 overflow-x-auto">
            <table className="ledger w-full min-w-[760px] text-sm">
              <thead className="text-left">
                <tr>
                  <th className="px-4 py-1.5 font-medium">Bounty</th>
                  <th className="px-2 py-1.5 font-medium">Winning bid</th>
                  <th className="px-2 py-1.5 font-medium">Recipient</th>
                  <th className="px-2 py-1.5 font-medium">Formula</th>
                  <th className="px-2 py-1.5 text-right font-medium">Minted</th>
                  <th className="px-2 py-1.5 font-medium">Check</th>
                  <th className="px-4 py-1.5 font-medium">Tx / block</th>
                </tr>
              </thead>
              <tbody>
                {[...supply].reverse().map((p) => {
                  const b = bounties.get(p.bounty_id);
                  const bid = b?.winner_bid_id != null ? bids.get(b.winner_bid_id) : undefined;
                  const recomputed = bid ? mintAmount(bid.price_yocto, p.score, p.mint_rate).toString() : null;
                  return (
                    <tr key={p.id} className="">
                      <td className="px-4 py-2">
                        <Link href={`/bounty/${p.bounty_id}`} className="hover:text-accent-text">
                          #{p.bounty_id} {b?.title ? <span className="text-muted">{b.title.slice(0, 28)}{b.title.length > 28 ? "…" : ""}</span> : null}
                        </Link>
                      </td>
                      <td className="px-2 py-2 text-xs">{bid ? <>#{bid.id} · {near(bid.price_yocto)}</> : "—"}</td>
                      <td className="px-2 py-2">
                        <Account id={p.recipient} />
                      </td>
                      <td className="px-2 py-2 font-mono text-[11px]">
                        {p.bid_units} × {p.score}/100 × {p.mint_rate}
                      </td>
                      <td className="px-2 py-2 text-right font-semibold">{formatHive(p.amount, 4)}</td>
                      <td className="px-2 py-2">
                        {recomputed ? <Check ok={recomputed === p.amount}>{recomputed === p.amount ? "recomputed" : "mismatch"}</Check> : <Check ok={null}>n/a</Check>}
                      </td>
                      <td className="px-4 py-2 text-xs">
                        <TxLink hash={txs.verification(p.bounty_id, b?.check_results_hash ?? null)} /> <BlockLink height={p.block_height} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}
