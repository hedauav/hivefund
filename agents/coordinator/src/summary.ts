// Human-readable end-of-run summary (tables + tx hashes with explorer links).
import { formatHive, formatNear } from "@hivefund/shared";
import type { ChainState, Market, TxLogEntry } from "@hivefund/shared/node";
import type { RunResult } from "./run.ts";

function table(rows: Record<string, string | number>[]): string {
  if (!rows.length) return "  (none)";
  const cols = Object.keys(rows[0]);
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c]).length)));
  const line = (vals: string[]) => "  " + vals.map((v, i) => v.padEnd(w[i])).join("  ");
  return [line(cols), line(w.map((n) => "-".repeat(n))), ...rows.map((r) => line(cols.map((c) => String(r[c]))))].join("\n");
}

export function renderSummary(market: Market, run: RunResult, state: ChainState, txs: TxLogEntry[]): string {
  const out: string[] = [];
  const short = (a: string) => a.split(".")[0];
  out.push(`\n================ HiveFund run summary (${market.mode}) ================`);
  out.push(`hub ${state.hub} · token ${state.token}${market.mode === "mock" ? "  [MOCK — not on-chain]" : ""}`);
  const ids = new Set(run.finalBounties.map((b) => b.id));
  const bounties = state.bounties.filter((b) => ids.has(b.id));

  out.push("\nBounties");
  out.push(
    table(
      bounties.map((b) => {
        const win = b.winner_bid_id == null ? null : state.bids[String(b.id)]?.find((x) => x.id === b.winner_bid_id);
        return {
          id: b.id,
          title: b.title.length > 38 ? b.title.slice(0, 37) + "…" : b.title,
          status: b.status,
          round: b.round,
          attempts: b.attempts,
          budget: formatNear(b.budget_yocto) + " N",
          winner: win ? short(win.worker) : "-",
          score: b.score ?? "-",
          hive: formatHive(b.hive_minted),
        };
      }),
    ),
  );

  out.push("\nBids");
  out.push(
    table(
      bounties.flatMap((b) =>
        (state.bids[String(b.id)] ?? []).map((x) => ({
          bounty: b.id,
          bid: x.id,
          round: x.round,
          worker: short(x.worker),
          price: formatNear(x.price_yocto, 5) + " N",
          eta_min: Math.round(x.eta_ms / 60000),
          status: x.status,
          reason: x.reject_reason ?? "",
        })),
      ),
    ),
  );

  const t = state.treasury;
  out.push("\nTreasury (NEAR)");
  out.push(
    table([
      {
        cap: formatNear(t.spend_cap),
        funded: formatNear(t.funded_total),
        available: formatNear(t.available),
        escrowed: formatNear(t.escrowed),
        paid_out: formatNear(t.paid_out, 5),
        refunded: formatNear(t.refunded_total),
      },
    ]),
  );

  out.push("\nHIVE supply history (amount = bid_units × score / 100 × mint_rate)");
  out.push(
    table(
      state.supply_history.map((s) => ({
        bounty: s.bounty_id,
        recipient: short(s.recipient),
        formula: `${s.bid_units}×${s.score}/100×${s.mint_rate}`,
        amount: formatHive(s.amount) + " HIVE",
        total_after: formatHive(s.total_minted_after),
      })),
    ),
  );

  out.push("\nReputation");
  out.push(
    table(
      state.reputation.map((w) => ({
        worker: short(w.account_id),
        tier: w.tier,
        completed: w.completed,
        failed: w.failed,
        reputation: w.reputation,
        earned: formatNear(w.earned_yocto, 5) + " N",
        hive: formatHive(w.hive_earned),
      })),
    ),
  );

  const strat = market.store.strategyWorkers().flatMap((w) => market.store.readStrategy(w));
  out.push("\nStrategy changes (off-chain log)");
  out.push(
    table(
      strat
        .filter((c) => c.ts_ms >= run.startedAt - 1 || market.mode === "mock")
        .map((c) => ({ worker: short(c.worker), bounty: c.bounty_id, margin: `${c.old_margin} → ${c.new_margin}`, reason: c.reason })),
    ),
  );

  const runTx = txs.filter((x) => x.ts >= run.startedAt - 1000 || market.mode === "mock");
  out.push(`\nTransactions this run: ${runTx.length} (${runTx.filter((x) => !x.ok).length} failed)`);
  for (const x of runTx) {
    const link = x.explorer ?? (x.txHash ? x.txHash : "");
    out.push(`  ${x.ok ? "✓" : "✗"} ${short(x.actor).padEnd(11)} ${x.method.padEnd(14)} ${link}${x.ok ? "" : "  " + (x.error ?? "").slice(0, 90)}`);
  }
  out.push(run.allTerminal ? "\nAll posted bounties reached a terminal state." : "\nNot all bounties finished within the step limit.");
  return out.join("\n");
}
