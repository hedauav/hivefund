// The agent contract shared by coordinator, workers and verifier, plus market wiring for
// testnet (primary) and mock (unit tests / offline dev only).
import type { AccountId, DeploymentConfig } from "../types.ts";
import { bidPublicKey, newBidKey } from "../bid.ts";
import { parseNear, DEFAULT_MINT_RATE } from "../mint.ts";
import type { HubClient } from "./hub.ts";
import { NearHubClient, DEFAULT_TESTNET_FALLBACK_RPCS, DEFAULT_TESTNET_EXPLORER } from "./hub.ts";
import { MockChain } from "./mock-chain.ts";
import { OffchainStore, openStore } from "./store.ts";
import { loadDeployment, loadEnv, repoRoot, requireEnv, type Mode } from "./config.ts";

export interface AgentContext {
  hub: HubClient;
  store: OffchainStore;
  /** hub contract account id (goes into bidPayload.contract) */
  contractId: AccountId;
  accountId: AccountId;
  now: () => number;
  log: (msg: string) => void;
  mode: Mode;
  repoRoot: string;
}

export interface WorkerContext extends AgentContext {
  /** ed25519 bid-signing secret ("ed25519:..."); its public half is registered on-chain as signing_pk. */
  bidKey: string;
}

export interface Agent {
  name: string;
  accountId: AccountId;
  tick(): Promise<void>;
}

export type WorkerName = "cheap" | "quality" | "adaptive";
export const WORKER_NAMES: readonly WorkerName[] = ["cheap", "quality", "adaptive"];

export interface Market {
  mode: Mode;
  hubId: AccountId;
  tokenId: AccountId;
  store: OffchainStore;
  explorer: string | null;
  coordinator: AgentContext;
  verifier: AgentContext;
  workers: Record<WorkerName, WorkerContext>;
  /** adversarial demo worker: registered on-chain, but signs bids with a key that is NOT its signing_pk */
  forger: WorkerContext;
  /** owner (root) client on the hub: funding, retry_mint. null on testnet if ROOT_PRIVATE_KEY is absent. */
  owner: HubClient | null;
  /** read-only token client (ft_balance_of, ft_total_supply). */
  token: HubClient;
  /** only in mock mode */
  chain: MockChain | null;
  now: () => number;
}

function makeLogger(name: string, sink?: (line: string) => void): (msg: string) => void {
  return (msg: string) => {
    const line = `[${name}] ${msg}`;
    if (sink) sink(line);
    else console.log(line);
  };
}

// ------------------------------------------------------------------------------------------
// Testnet (primary)
// ------------------------------------------------------------------------------------------

export interface TestnetMarketOpts {
  deployment?: DeploymentConfig;
  store?: OffchainStore;
  logSink?: (line: string) => void;
}

/**
 * Build agent contexts from config/deployment.testnet.json + .env.local keys (written by
 * scripts/setup-testnet.ts). Every agent signs with its own function-call key on its own sub-account.
 */
export function createTestnetMarket(opts: TestnetMarketOpts = {}): Market {
  loadEnv();
  const dep = opts.deployment ?? loadDeployment();
  if (!dep) {
    throw new Error(
      "config/deployment.testnet.json not found: deploy first with `npm run setup:testnet` (or pass --mode mock for offline dev)",
    );
  }
  const store = opts.store ?? openStore();
  const explorer = dep.explorer || DEFAULT_TESTNET_EXPLORER;
  const onTx = (e: Parameters<OffchainStore["appendTx"]>[0]) => store.appendTx(e);
  const mk = (accountId: AccountId, privateKey?: string, contractId = dep.hub) =>
    new NearHubClient({
      accountId,
      privateKey,
      contractId,
      rpcUrl: dep.rpcUrl,
      fallbackRpcUrls: DEFAULT_TESTNET_FALLBACK_RPCS,
      explorer,
      onTx,
    });
  const now = () => Date.now();
  const root = repoRoot();
  const base = (name: string, accountId: AccountId, key: string): AgentContext => ({
    hub: mk(accountId, key),
    store,
    contractId: dep.hub,
    accountId,
    now,
    log: makeLogger(name, opts.logSink),
    mode: "testnet",
    repoRoot: root,
  });
  const worker = (name: WorkerName, envName: string): WorkerContext => ({
    ...base(name, dep.workers[name], requireEnv(`WORKER_${envName}_KEY`)),
    bidKey: requireEnv(`WORKER_${envName}_BID_KEY`),
  });
  const rootKey = process.env.ROOT_PRIVATE_KEY;
  return {
    mode: "testnet",
    hubId: dep.hub,
    tokenId: dep.token,
    store,
    explorer,
    coordinator: base("coordinator", dep.coordinator, requireEnv("COORDINATOR_KEY")),
    verifier: base("verifier", dep.verifier, requireEnv("VERIFIER_KEY")),
    workers: {
      cheap: worker("cheap", "CHEAP"),
      quality: worker("quality", "QUALITY"),
      adaptive: worker("adaptive", "ADAPTIVE"),
    },
    // The forger is a registered worker whose on-chain signing_pk is WORKER_FORGER_BID_KEY's public half,
    // but it signs bids with a fresh random key, so the coordinator's off-chain check must reject them.
    forger: { ...base("forger", dep.workers.forger, requireEnv("WORKER_FORGER_KEY")), bidKey: newBidKey() },
    owner: rootKey ? mk(dep.owner, rootKey) : null,
    token: mk(dep.owner, undefined, dep.token),
    chain: null,
    now,
  };
}

// ------------------------------------------------------------------------------------------
// Mock (unit tests / offline dev only — never the demo of record)
// ------------------------------------------------------------------------------------------

export interface MockMarketOpts {
  store: OffchainStore;
  /** spend cap (default 1 NEAR) */
  spendCapNear?: string;
  /** initial treasury funding (default 0.5 NEAR) */
  fundNear?: string;
  mintRate?: string;
  nowMs?: number;
  logSink?: (line: string) => void;
}

export const MOCK_ACCOUNTS = {
  owner: "hivefund-demo.testnet",
  hub: "hub.hivefund-demo.testnet",
  token: "hive.hivefund-demo.testnet",
  coordinator: "coordinator.hivefund-demo.testnet",
  verifier: "verifier.hivefund-demo.testnet",
  cheap: "cheap.hivefund-demo.testnet",
  quality: "quality.hivefund-demo.testnet",
  adaptive: "adaptive.hivefund-demo.testnet",
  forger: "forger.hivefund-demo.testnet",
} as const;

/** Tiers registered by setup-testnet.ts (and the mock): cheap 1, adaptive 2, quality 3, forger 1. */
export const WORKER_TIERS = { cheap: 1, adaptive: 2, quality: 3, forger: 1 } as const;

/** A MockChain set up exactly like scripts/setup-testnet.ts does on testnet. */
export async function createMockMarket(opts: MockMarketOpts): Promise<Market> {
  const A = MOCK_ACCOUNTS;
  const chain = new MockChain({
    owner: A.owner,
    hub: A.hub,
    token: A.token,
    spendCapYocto: parseNear(opts.spendCapNear ?? "1").toString(),
    mintRate: opts.mintRate ?? DEFAULT_MINT_RATE.toString(),
    nowMs: opts.nowMs,
  });
  const owner = chain.client(A.owner);
  await owner.call("set_coordinator", { account_id: A.coordinator });
  await owner.call("set_verifier", { account_id: A.verifier });
  const bidKeys = { cheap: newBidKey(), quality: newBidKey(), adaptive: newBidKey(), forger: newBidKey() };
  for (const name of ["cheap", "adaptive", "quality", "forger"] as const) {
    await owner.call("add_worker", { account_id: A[name], tier: WORKER_TIERS[name], signing_pk: bidPublicKey(bidKeys[name]) });
  }
  await owner.call("fund_treasury", {}, { depositYocto: parseNear(opts.fundNear ?? "0.5").toString() });

  const now = () => chain.nowMs();
  const root = repoRoot();
  const base = (name: string, accountId: AccountId): AgentContext => ({
    hub: chain.client(accountId),
    store: opts.store,
    contractId: A.hub,
    accountId,
    now,
    log: makeLogger(name, opts.logSink),
    mode: "mock",
    repoRoot: root,
  });
  return {
    mode: "mock",
    hubId: A.hub,
    tokenId: A.token,
    store: opts.store,
    explorer: null,
    coordinator: base("coordinator", A.coordinator),
    verifier: base("verifier", A.verifier),
    workers: {
      cheap: { ...base("cheap", A.cheap), bidKey: bidKeys.cheap },
      quality: { ...base("quality", A.quality), bidKey: bidKeys.quality },
      adaptive: { ...base("adaptive", A.adaptive), bidKey: bidKeys.adaptive },
    },
    // The forger signs with a fresh key, not the one registered as its signing_pk.
    forger: { ...base("forger", A.forger), bidKey: newBidKey() },
    owner,
    token: chain.tokenClient(A.owner),
    chain,
    now,
  };
}
