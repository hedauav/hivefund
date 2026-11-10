// Read every hub + token view into one JSON object (chain-state.json). Works with any HubClient,
// so the same shape comes from testnet (NearHubClient) and the mock (MockChain).
import type {
  ActivityEntry,
  Bid,
  Bounty,
  HubConfig,
  PendingMint,
  SupplyPoint,
  Treasury,
  WorkerView,
} from "../types.ts";
import type { HubClient } from "./hub.ts";

export interface ChainState {
  /** "testnet" for real reads; "mock" for offline fixtures (data/sample is labelled SAMPLE). */
  source: "testnet" | "mock";
  captured_at: string;
  hub: string;
  token: string;
  config: HubConfig;
  treasury: Treasury;
  bounties: Bounty[];
  bids: Record<string, Bid[]>;
  reputation: WorkerView[];
  activity: ActivityEntry[];
  supply_history: SupplyPoint[];
  pending_mints: PendingMint[];
  token_state: { ft_total_supply: string; balances: Record<string, string> };
}

async function pageAll<T>(hub: HubClient, method: string, page = 100): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += page) {
    const rows = await hub.view<T[]>(method, { from_index: from, limit: page });
    out.push(...rows);
    if (rows.length < page) return out;
  }
}

export async function readChainState(hub: HubClient, token: HubClient, source: ChainState["source"]): Promise<ChainState> {
  const [config, treasury, bounties, reputation, activity, supply, pending] = await Promise.all([
    hub.view<HubConfig>("get_config"),
    hub.view<Treasury>("get_treasury"),
    pageAll<Bounty>(hub, "get_bounties", 50),
    hub.view<WorkerView[]>("get_reputation", {}),
    pageAll<ActivityEntry>(hub, "get_activity_log"),
    pageAll<SupplyPoint>(hub, "get_supply_history"),
    hub.view<PendingMint[]>("get_pending_mints"),
  ]);
  const bids: Record<string, Bid[]> = {};
  for (const b of bounties) bids[String(b.id)] = await hub.view<Bid[]>("get_bids", { bounty_id: b.id });
  const holders = [...new Set(reputation.map((w) => w.account_id))];
  const balances: Record<string, string> = {};
  for (const h of holders) balances[h] = await token.view<string>("ft_balance_of", { account_id: h });
  const ft_total_supply = await token.view<string>("ft_total_supply");
  return {
    source,
    captured_at: new Date().toISOString(),
    hub: hub.contractId,
    token: token.contractId,
    config,
    treasury,
    bounties,
    bids,
    reputation,
    activity,
    supply_history: supply,
    pending_mints: pending,
    token_state: { ft_total_supply, balances },
  };
}
