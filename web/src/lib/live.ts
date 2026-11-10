// Builds a ChainSnapshot from the deployed bounty-hub views (docs/PLAN.md §2 "Views").
import type { ActivityEntry, Bid, Bounty, HubConfig, SupplyPoint, Treasury, WorkerView } from "@hivefund/shared";
import { viewCall } from "./rpc";
import type { ChainSnapshot } from "./snapshot";

const PAGE = 50;

async function paged<T>(rpc: string, hub: string, method: string, max = 2000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const page = await viewCall<T[]>(rpc, hub, method, { from_index: from, limit: PAGE });
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

export async function fetchLiveSnapshot(rpc: string, hub: string): Promise<ChainSnapshot> {
  const [config, bounties, treasury, reputation, activity, supply] = await Promise.all([
    viewCall<HubConfig>(rpc, hub, "get_config"),
    paged<Bounty>(rpc, hub, "get_bounties"),
    viewCall<Treasury>(rpc, hub, "get_treasury"),
    viewCall<WorkerView[]>(rpc, hub, "get_reputation", {}),
    paged<ActivityEntry>(rpc, hub, "get_activity_log"),
    paged<SupplyPoint>(rpc, hub, "get_supply_history"),
  ]);
  const bidLists = await Promise.all(bounties.map((b) => viewCall<Bid[]>(rpc, hub, "get_bids", { bounty_id: b.id })));
  return {
    source: "testnet",
    generated_ms: Date.now(),
    config,
    bounties,
    bids: bidLists.flat().sort((a, b) => a.id - b.id),
    treasury,
    reputation,
    activity,
    supply,
  };
}

/** NEP-141 total supply of HIVE (cross-check against the hub's total_minted). */
export async function fetchHiveSupply(rpc: string, token: string): Promise<string | null> {
  try {
    return await viewCall<string>(rpc, token, "ft_total_supply");
  } catch {
    return null;
  }
}
