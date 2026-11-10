use crate::*;

fn page<T: Clone + near_sdk::borsh::BorshSerialize + near_sdk::borsh::BorshDeserialize>(
    v: &Vector<T>,
    from_index: Option<u64>,
    limit: Option<u64>,
    default_limit: u64,
) -> Vec<T> {
    let from = from_index.unwrap_or(0);
    let limit = limit.unwrap_or(default_limit);
    v.iter()
        .skip(from.min(u32::MAX as u64) as usize)
        .take(limit.min(1000) as usize)
        .cloned()
        .collect()
}

#[near]
impl BountyHub {
    pub fn get_config(&self) -> HubConfig {
        HubConfig {
            owner: self.owner.clone(),
            coordinator: self.coordinator.clone(),
            verifier: self.verifier.clone(),
            hive_token: self.hive_token.clone(),
            mint_rate: U128(self.mint_rate),
            total_minted: U128(self.total_minted),
            version: VERSION.to_string(),
        }
    }

    pub fn get_bounties(&self, from_index: Option<u64>, limit: Option<u64>) -> Vec<Bounty> {
        page(&self.bounties, from_index, limit, 50)
    }

    pub fn get_bounty(&self, bounty_id: u64) -> Option<Bounty> {
        u32::try_from(bounty_id)
            .ok()
            .and_then(|i| self.bounties.get(i))
            .cloned()
    }

    pub fn get_bids(&self, bounty_id: u64) -> Vec<Bid> {
        self.get_bounty(bounty_id)
            .map(|b| {
                b.bid_ids
                    .iter()
                    .filter_map(|id| self.bids.get(*id as u32).cloned())
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn get_treasury(&self) -> Treasury {
        self.treasury.clone()
    }

    pub fn get_reputation(&self, account_id: Option<AccountId>) -> Vec<WorkerView> {
        match account_id {
            Some(a) => self
                .workers
                .get(&a)
                .map(WorkerView::from)
                .into_iter()
                .collect(),
            None => self.workers.values().map(WorkerView::from).collect(),
        }
    }

    pub fn get_activity_log(
        &self,
        from_index: Option<u64>,
        limit: Option<u64>,
    ) -> Vec<ActivityEntry> {
        page(&self.activity, from_index, limit, 100)
    }

    pub fn get_supply_history(
        &self,
        from_index: Option<u64>,
        limit: Option<u64>,
    ) -> Vec<SupplyPoint> {
        page(&self.supply, from_index, limit, 100)
    }

    pub fn get_pending_mints(&self) -> Vec<PendingMint> {
        self.pending_mints.values().cloned().collect()
    }
}
