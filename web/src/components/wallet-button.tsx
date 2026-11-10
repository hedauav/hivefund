"use client";

import { useState } from "react";
import { useWalletCtx } from "@/providers/near-provider";
import { useHub } from "@/providers/data-provider";
import { shortAccount } from "@/lib/format";
import { ExtLink } from "./ui";

export function WalletButton() {
  const wallet = useWalletCtx();
  const { explorer } = useHub();
  const [err, setErr] = useState<string | null>(null);
  if (!wallet || !wallet.ready) {
    return <span className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted">Wallet…</span>;
  }
  if (wallet.accountId) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="hidden rounded-lg bg-panel-2 px-2.5 py-1.5 sm:inline">
          {explorer.enabled || wallet.network === "testnet" ? (
            <ExtLink href={`https://${wallet.network === "testnet" ? "testnet." : ""}nearblocks.io/address/${wallet.accountId}`}>
              {shortAccount(wallet.accountId)}
            </ExtLink>
          ) : (
            shortAccount(wallet.accountId)
          )}
        </span>
        <button onClick={() => wallet.signOut()} className="rounded-lg border border-line px-3 py-1.5 text-muted hover:text-ink">
          Sign out
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      {err && <span className="max-w-48 truncate text-xs text-bad" title={err}>{err}</span>}
      <button
        onClick={() => {
          setErr(null);
          wallet.signIn().catch((e: unknown) => setErr(e instanceof Error ? e.message : "sign-in cancelled"));
        }}
        className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-black hover:brightness-110"
      >
        Connect {wallet.network} wallet
      </button>
    </div>
  );
}
