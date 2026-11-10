"use client";

import { useHub } from "@/providers/data-provider";
import { timeAgo } from "@/lib/format";
import { Account } from "./ui";

export function ModeBanner() {
  const { config, error, lastUpdated, snapshot } = useHub();
  if (!config) return null;
  if (config.mode === "mock") {
    return (
      <div role="alert" className="border-b-[1.5px] border-line bg-warn-soft">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2 text-sm sm:px-6">
          <strong className="border-[1.5px] border-line bg-bad px-2 py-0.5 font-mono text-xs font-semibold tracking-wider text-[#f7f2e7]">
            SAMPLE DATA — NOT LIVE
          </strong>
          <span>
            No deployment found, so this page shows {config.dataSource}. None of it is on-chain. Deploy the contracts or set{" "}
            <code className="font-mono text-xs">NEXT_PUBLIC_HUB_CONTRACT</code> to go live.
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className="border-b border-hair bg-panel">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1.5 font-mono text-[11px] text-muted sm:px-6">
        <span className="inline-flex items-center gap-1.5 font-semibold text-ok">
          <span className="h-2 w-2 bg-ok" aria-hidden /> LIVE · {config.network}
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
            <>
              read {timeAgo(lastUpdated)} · every 5s{snapshot ? ` · ${snapshot.activity.length} events` : ""}
            </>
          ) : (
            "connecting…"
          )}
        </span>
      </div>
    </div>
  );
}
