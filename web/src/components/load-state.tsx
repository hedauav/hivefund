"use client";

import { useHub } from "@/providers/data-provider";

export function LoadState() {
  const { error, config } = useHub();
  if (error) {
    return (
      <div className="rounded-xl border border-bad/40 bg-bad-soft p-5 text-sm text-bad">
        <div className="font-semibold">Could not load market data</div>
        <p className="mt-1">{error}</p>
        {config?.mode === "live" && (
          <p className="mt-2 text-xs">
            Reading <span className="font-mono">{config.hub}</span> via {config.rpcUrl}. Check that the contract is deployed and initialised.
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-32 animate-pulse rounded-xl border border-line bg-panel" />
      ))}
    </div>
  );
}
