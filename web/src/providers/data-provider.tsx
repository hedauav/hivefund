"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import type { StrategyChange } from "@hivefund/shared";
import { fetchHiveSupply, fetchLiveSnapshot } from "@/lib/live";
import { makeExplorer, type Explorer } from "@/lib/explorer";
import { TxIndex } from "@/lib/txlookup";
import type { ChainSnapshot, OffchainIndexEntry, TxLogEntry, WebConfig } from "@/lib/snapshot";

const POLL_MS = 5000;

export interface HubData {
  config: WebConfig | null;
  snapshot: ChainSnapshot | null;
  strategy: Record<string, StrategyChange[]>;
  index: OffchainIndexEntry[];
  txs: TxIndex;
  tokenSupply: string | null;
  explorer: Explorer;
  error: string | null;
  loading: boolean;
  lastUpdated: number | null;
  refresh: () => void;
}

const Ctx = createContext<HubData | null>(null);

async function getJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return fallback;
    return (await r.json()) as T;
  } catch {
    return fallback;
  }
}

export function DataProvider({ children }: PropsWithChildren) {
  const [config, setConfig] = useState<WebConfig | null>(null);
  const [snapshot, setSnapshot] = useState<ChainSnapshot | null>(null);
  const [strategy, setStrategy] = useState<Record<string, StrategyChange[]>>({});
  const [index, setIndex] = useState<OffchainIndexEntry[]>([]);
  const [txRows, setTxRows] = useState<TxLogEntry[]>([]);
  const [tokenSupply, setTokenSupply] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    getJson<WebConfig | null>("/api/config", null).then((c) => {
      if (c) setConfig(c);
      else setError("could not load /api/config");
    });
  }, []);

  const load = useCallback(async () => {
    if (!config || inFlight.current) return;
    inFlight.current = true;
    try {
      const sidecar = Promise.all([
        getJson<Record<string, StrategyChange[]>>("/api/strategy", {}),
        getJson<OffchainIndexEntry[]>("/api/offchain", []),
        getJson<TxLogEntry[]>("/api/tx", []),
      ]);
      let snap: ChainSnapshot;
      if (config.mode === "live" && config.hub) {
        const [s, supply] = await Promise.all([
          fetchLiveSnapshot(config.rpcUrl, config.hub),
          config.token ? fetchHiveSupply(config.rpcUrl, config.token) : Promise.resolve(null),
        ]);
        snap = s;
        setTokenSupply(supply);
      } else {
        const r = await fetch("/api/snapshot", { cache: "no-store" });
        if (!r.ok) throw new Error(`sample snapshot unavailable (${r.status})`);
        snap = (await r.json()) as ChainSnapshot;
        setTokenSupply(snap.config.total_minted);
      }
      const [st, ix, tx] = await sidecar;
      setSnapshot(snap);
      setStrategy(st);
      setIndex(ix);
      setTxRows(tx);
      setError(null);
      setLastUpdated(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current = false;
    }
  }, [config]);

  useEffect(() => {
    if (!config) return;
    const first = setTimeout(load, 0);
    const id = setInterval(load, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [config, load]);

  const value = useMemo<HubData>(() => {
    const live = config?.mode === "live";
    return {
      config,
      snapshot,
      strategy,
      index,
      txs: new TxIndex(txRows),
      tokenSupply,
      explorer: makeExplorer(config?.explorer ?? "https://testnet.nearblocks.io", live),
      error,
      loading: !snapshot && !error,
      lastUpdated,
      refresh: load,
    };
  }, [config, snapshot, strategy, index, txRows, tokenSupply, error, lastUpdated, load]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHub(): HubData {
  const v = useContext(Ctx);
  if (!v) throw new Error("useHub outside DataProvider");
  return v;
}
