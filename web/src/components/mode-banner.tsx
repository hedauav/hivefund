"use client";

import { useHub } from "@/providers/data-provider";
import { timeAgo } from "@/lib/format";
import { Account } from "./ui";

export function ModeBanner() {
  const { config, error, lastUpdated, snapshot } = useHub();
  if (!config) return null;
  if (config.mode === "mock") {
    return (
      <div role="alert" className="border-b-2 border-warn bg-warn-soft">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm text-warn sm:px-6">
          <strong className="rounded bg-warn px-2 py-0.5 text-xs font-bold tracking-wider text-black">SAMPLE DATA — NOT LIVE</strong>
          <span>
            No deployment found (<code className="font-mono text-xs">config/deployment.testnet.json</code> or{" "}
            <code className="font-mono text-xs">NEXT_PUBLIC_HUB_CONTRACT</code>). Showing {config.dataSource}. Nothing here is on-chain.
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className="border-b border-line bg-panel">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-xs text-muted sm:px-6">
        <span className="inline-flex items-center gap-1.5 font-semibold text-ok">
          <span className="h-2 w-2 animate-pulse rounded-full bg-ok" /> LIVE · NEAR {config.network}
        </span>
        <span>
          hub <Account id={config.hub} full />
        </span>
        {config.token && (
          <span>
            token <Account id={config.token} full />
          </span>
        )}
        <span className="ml-auto">
          {error ? (
            <span className="text-bad">RPC error: {error}</span>
          ) : lastUpdated ? (
            <>updated {timeAgo(lastUpdated)} · polling 5s{snapshot ? ` · ${snapshot.activity.length} on-chain events` : ""}</>
          ) : (
            "connecting…"
          )}
        </span>
      </div>
    </div>
  );
}
