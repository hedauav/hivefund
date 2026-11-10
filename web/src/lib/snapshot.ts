// Shapes the dashboard renders. A ChainSnapshot is either read live from the
// bounty-hub views (testnet) or loaded from a mock/sample file.
import type {
  ActivityEntry,
  Bid,
  Bounty,
  HubConfig,
  StrategyChange,
  SupplyPoint,
  Treasury,
  WorkerView,
} from "@hivefund/shared";

export type DataMode = "live" | "mock";

export interface ChainSnapshot {
  source: "testnet" | "mock" | "sample" | "fixture";
  generated_ms: number;
  config: HubConfig;
  bounties: Bounty[];
  bids: Bid[];
  treasury: Treasury;
  reputation: WorkerView[];
  activity: ActivityEntry[];
  supply: SupplyPoint[];
}

/** One line of ${DATA}/index.jsonl (off-chain store index). */
export interface OffchainIndexEntry {
  hash: string;
  kind: "spec" | "deliverable" | "report" | "selection";
  bounty_id?: number;
  round?: number;
  actor: string;
  ts_ms?: number;
}

/** One line of ${DATA}/tx.jsonl. */
export interface TxLogEntry {
  ts: number;
  actor: string;
  method: string;
  args?: unknown;
  txHash: string;
  contract?: string;
  /** false when the transaction failed on-chain (still a real tx, but not the one that changed state) */
  ok?: boolean;
  explorer?: string;
}

/** Client-visible runtime config, served by /api/config. */
export interface WebConfig {
  mode: DataMode;
  network: "testnet" | "mainnet";
  rpcUrl: string;
  hub: string | null;
  token: string | null;
  explorer: string;
  dataSource: string;
  /** Present when off-chain records include the committed recorded testnet run for this hub. */
  recorded: { label: string; captured_at: string; objects: number; txs: number } | null;
}

export type StrategyLog = Record<string, StrategyChange[]>;
