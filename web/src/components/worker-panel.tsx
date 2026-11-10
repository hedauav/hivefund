"use client";

import { useMemo } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { StrategyChange } from "@hivefund/shared";
import { useHub } from "@/providers/data-provider";
import { clock, hive, near, timeAgo, workerRole } from "@/lib/format";
import { Account, Card, Chip, Empty } from "./ui";

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"];

export function WorkerPanel() {
  const { snapshot, strategy } = useHub();
  const workers = useMemo(() => snapshot?.reputation ?? [], [snapshot]);
  const bids = useMemo(() => snapshot?.bids ?? [], [snapshot]);

  const stats = useMemo(
    () =>
      workers.map((w) => {
        const mine = bids.filter((b) => b.worker === w.account_id);
        const considered = mine.filter((b) => b.status !== "Rejected" && b.status !== "Pending" && b.status !== "Superseded");
        const wins = mine.filter((b) => b.status === "Won" || b.status === "Paid" || b.status === "Failed").length;
        return {
          w,
          bids: mine.length,
          rejected: mine.filter((b) => b.status === "Rejected").length,
          wins,
          winRate: considered.length ? wins / considered.length : null,
        };
      }),
    [workers, bids],
  );

  const adaptiveWorkers = Object.entries(strategy).filter(([, list]) => list.length);
  const chart = useMemo(() => buildSeries(strategy), [strategy]);
  const reasons = useMemo(
    () =>
      Object.values(strategy)
        .flat()
        .sort((a, b) => b.ts_ms - a.ts_ms)
        .slice(0, 12),
    [strategy],
  );

  return (
    <Card id="workers" n="06" title="Workers" subtitle="one sub-account each; keys can only call place_bid and submit_work">
      {!workers.length ? (
        <Empty>No workers registered.</Empty>
      ) : (
        <div className="-mx-4 overflow-x-auto">
          <table className="ledger w-full min-w-[720px] text-sm">
            <thead className="text-left">
              <tr>
                <th className="px-4 py-1.5 font-medium">Worker</th>
                <th className="px-2 py-1.5 font-medium">Tier</th>
                <th className="px-2 py-1.5 text-right font-medium">Bids</th>
                <th className="px-2 py-1.5 text-right font-medium">Win rate</th>
                <th className="px-2 py-1.5 text-right font-medium">Done / failed</th>
                <th className="px-2 py-1.5 text-right font-medium">Earned</th>
                <th className="px-2 py-1.5 text-right font-medium">HIVE</th>
                <th className="px-4 py-1.5 text-right font-medium">Reputation</th>
              </tr>
            </thead>
            <tbody>
              {stats.map(({ w, bids: n, rejected, winRate }) => (
                <tr key={w.account_id} className="">
                  <td className="px-4 py-2">
                    <Account id={w.account_id} />
                    {!w.active && <Chip tone="ml-1 bg-bad-soft text-bad">inactive</Chip>}
                    <span className="ml-1 text-[11px] text-muted">{strategyLabel(workerRole(w.account_id))}</span>
                  </td>
                  <td className="px-2 py-2 font-mono text-xs">{w.tier}</td>
                  <td className="px-2 py-2 text-right text-xs">
                    {n}
                    {rejected ? <span className="text-bad"> ({rejected} rejected)</span> : null}
                  </td>
                  <td className="px-2 py-2 text-right">{winRate == null ? "—" : `${Math.round(winRate * 100)}%`}</td>
                  <td className="px-2 py-2 text-right text-xs">
                    {w.completed} / <span className={w.failed ? "text-bad" : ""}>{w.failed}</span>
                  </td>
                  <td className="px-2 py-2 text-right">{near(w.earned_yocto)}</td>
                  <td className="px-2 py-2 text-right">{hive(w.hive_earned, 2)}</td>
                  <td className="px-4 py-2 text-right font-semibold">{w.reputation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-5 [&>*]:min-w-0">
        <div className=" border border-hair p-3 lg:col-span-3">
          <div className="mb-1 text-xs font-medium text-muted">Margin over time (from the workers&apos; strategy logs)</div>
          {chart.data.length ? (
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart.data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
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
                  <YAxis
                    stroke="var(--muted)"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    width={40}
                    tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                    domain={[0, "auto"]}
                  />
                  <Tooltip
                    contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                    labelFormatter={(t) => clock(Number(t))}
                    formatter={(v, name) => [`${Math.round(Number(v) * 100)}%`, String(name)]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {chart.keys.map((k, i) => (
                    <Line key={k} type="stepAfter" dataKey={k} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Empty>No strategy changes logged yet. The adaptive worker logs one after each win, loss or failed verification.</Empty>
          )}
          {adaptiveWorkers.length === 0 && workers.length > 0 && (
            <p className="mt-1 text-xs text-muted">cheap and quality use fixed margins (5% and 35%); adaptive moves within 5–50%.</p>
          )}
        </div>
        <div className=" border border-hair p-3 lg:col-span-2">
          <div className="mb-2 text-xs font-medium text-muted">Strategy-change reasons</div>
          {!reasons.length ? (
            <Empty>Nothing yet.</Empty>
          ) : (
            <ul className="space-y-2">
              {reasons.map((r, i) => (
                <li key={`${r.worker}-${r.ts_ms}-${i}`} className="text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{workerRole(r.worker)}</span>
                    <span className="font-mono">
                      {pct(r.old_margin)} → <span className={r.new_margin > r.old_margin ? "text-ok" : r.new_margin < r.old_margin ? "text-bad" : ""}>{pct(r.new_margin)}</span>
                    </span>
                    <span className="ml-auto text-muted">{timeAgo(r.ts_ms)}</span>
                  </div>
                  <div className="text-muted">{r.reason}</div>
                  <div className="mt-0.5 flex gap-1">
                    {r.window.map((o, j) => (
                      <span
                        key={j}
                        className={` px-1 font-mono text-[10px] ${o === "win" ? "bg-ok-soft text-ok" : o === "fail" ? "bg-bad-soft text-bad" : "bg-panel-2 text-muted"}`}
                      >
                        {o}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}

const pct = (m: number) => `${Math.round(m * 100)}%`;

function strategyLabel(role: string) {
  switch (role) {
    case "cheap":
      return "low margin, slower";
    case "quality":
      return "high margin, fast, thorough";
    case "adaptive":
      return "adapts margin to outcomes";
    case "forger":
      return "adversarial test account";
    default:
      return "";
  }
}

function buildSeries(strategy: Record<string, StrategyChange[]>) {
  const keys: string[] = [];
  const points = new Map<number, Record<string, number>>();
  for (const [worker, list] of Object.entries(strategy)) {
    if (!list.length) continue;
    const key = workerRole(worker);
    keys.push(key);
    const first = list[0];
    const start = first.ts_ms - 60_000;
    points.set(start, { ...(points.get(start) ?? {}), [key]: first.old_margin });
    for (const c of list) points.set(c.ts_ms, { ...(points.get(c.ts_ms) ?? {}), [key]: c.new_margin });
  }
  const data = [...points.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, ...v }));
  return { keys, data };
}
