"use client";

import { useState } from "react";
import { parseNear } from "@hivefund/shared";
import { useWalletCtx } from "@/providers/near-provider";
import { useHub } from "@/providers/data-provider";
import { ExtLink } from "./ui";

/** Community action: a real signed fund_treasury transaction with an attached deposit. */
export function FundTreasury() {
  const wallet = useWalletCtx();
  const { config, explorer, refresh } = useHub();
  const [amount, setAmount] = useState("0.1");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string; tx?: string } | null>(null);

  if (!config) return null;
  const live = config.mode === "live" && !!config.hub;

  async function submit() {
    if (!wallet || !config?.hub) return;
    setBusy(true);
    setResult(null);
    try {
      const deposit = parseNear(amount);
      if (deposit <= 0n) throw new Error("enter an amount above 0");
      const { txHash } = await wallet.call({
        contractId: config.hub,
        method: "fund_treasury",
        args: {},
        gas: "30000000000000",
        deposit: deposit.toString(),
      });
      setResult({ ok: true, msg: `Funded ${amount} NEAR`, tx: txHash });
      refresh();
    } catch (e) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-dashed border-line bg-panel-2 p-3">
      <div className="text-xs font-semibold">Fund the treasury</div>
      <p className="mt-0.5 text-xs text-muted">Signs a real <code className="font-mono">fund_treasury</code> transaction on {config.network} with your wallet.</p>
      <div className="mt-2 flex items-center gap-2">
        <div className="flex items-center rounded-lg border border-line bg-panel">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            className="w-20 bg-transparent px-2 py-1.5 text-sm outline-none"
            aria-label="Amount in NEAR"
            disabled={!live}
          />
          <span className="pr-2 text-xs text-muted">NEAR</span>
        </div>
        {!live ? (
          <span className="text-xs text-muted">Available once contracts are deployed</span>
        ) : !wallet?.accountId ? (
          <button onClick={() => wallet?.signIn()} disabled={!wallet} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50">
            Connect wallet
          </button>
        ) : (
          <button onClick={submit} disabled={busy} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50">
            {busy ? "Waiting for wallet…" : "Sign & fund"}
          </button>
        )}
      </div>
      {result && (
        <p className={`mt-2 text-xs ${result.ok ? "text-ok" : "text-bad"}`}>
          {result.msg}
          {result.tx && (
            <>
              {" · "}
              <ExtLink href={explorer.tx(result.tx)}>view tx</ExtLink>
            </>
          )}
        </p>
      )}
    </div>
  );
}
