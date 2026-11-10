//! HiveFund bounty-hub.
//!
//! A community bounty market: registered worker agents bid on bounties, a coordinator
//! selects a winner, a verifier gates payment with a hash of machine-checked results, and
//! the hub mints HIVE (NEP-141, via the `hive-token` contract) from verified outcomes:
//!
//! `amount = (winning_price_yocto / 10^21) * score * mint_rate / 100`
//!
//! See docs/PLAN.md §2 and RULES.md.

use near_sdk::json_types::U128;
use near_sdk::store::{IterableMap, LookupSet, Vector};
use near_sdk::{
    env, ext_contract, near, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
    PromiseError, PromiseOrValue,
};

pub mod errors;
pub mod types;
mod views;

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests;

use errors::*;
pub use types::*;

pub const VERSION: &str = "0.1.0";
/// 1 milliNEAR in yocto: "winning_bid_units" are milliNEAR.
pub const YOCTO_PER_MILLINEAR: u128 = 1_000_000_000_000_000_000_000;
pub const MINT_GAS: Gas = Gas::from_tgas(15);
pub const ON_MINT_GAS: Gas = Gas::from_tgas(15);
pub const MAX_TITLE: usize = 120;
pub const MAX_SIGNATURE: usize = 200;
pub const MAX_REASON: usize = 200;
pub const MAX_DETAIL: usize = 200;
pub const MAX_PK: usize = 100;
pub const MAX_BIDS_PER_BOUNTY: usize = 30;
pub const MAX_ATTEMPTS: u32 = 2;
pub const MAX_TIER: u8 = 3;

#[ext_contract(ext_hive_token)]
#[allow(dead_code)]
trait HiveToken {
    fn mint(&mut self, account_id: AccountId, amount: U128);
}

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Bounties,
    Bids,
    Workers,
    Activity,
    Supply,
    PendingMints,
    MintsInFlight,
}

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct BountyHub {
    owner: AccountId,
    coordinator: Option<AccountId>,
    verifier: Option<AccountId>,
    hive_token: AccountId,
    mint_rate: u128,
    total_minted: u128,
    treasury: Treasury,
    bounties: Vector<Bounty>,
    bids: Vector<Bid>,
    workers: IterableMap<AccountId, WorkerInfo>,
    activity: Vector<ActivityEntry>,
    supply: Vector<SupplyPoint>,
    pending_mints: IterableMap<u64, PendingMint>,
    /// Bounty ids whose mint promise has been issued and whose callback has not run yet.
    /// Guards `retry_mint` against double-minting.
    mints_in_flight: LookupSet<u64>,
}

// ---------------------------------------------------------------- helpers (not exported)

fn add(a: U128, b: u128) -> U128 {
    U128(
        a.0.checked_add(b)
            .unwrap_or_else(|| env::panic_str(ERR_OVERFLOW)),
    )
}

fn sub(a: U128, b: u128) -> U128 {
    U128(
        a.0.checked_sub(b)
            .unwrap_or_else(|| env::panic_str(ERR_OVERFLOW)),
    )
}

fn truncate(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

fn assert_hash(h: &str) {
    if h.len() != 64
        || !h
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    {
        env::panic_str(ERR_BAD_HASH);
    }
}

fn assert_max_len(s: &str, max: usize) {
    if s.chars().count() > max {
        env::panic_str(ERR_TOO_LONG);
    }
}

/// Canonical bid commitment signed off-chain by the worker's bid key (keys sorted, no whitespace).
/// Must byte-match `bidPayload` in agents/shared/src/bid.ts (golden vector in tests/vectors).
pub fn bid_payload(
    bounty_id: u64,
    contract: &str,
    eta_ms: u64,
    price_yocto: u128,
    round: u32,
    worker: &str,
) -> String {
    format!(
        r#"{{"bounty_id":{},"contract":"{}","eta_ms":{},"price_yocto":"{}","round":{},"worker":"{}"}}"#,
        bounty_id, contract, eta_ms, price_yocto, round, worker
    )
}

/// `(bid_units, amount)` for a winning price and verified score. `None` on overflow.
pub fn mint_amount(price_yocto: u128, score: u32, mint_rate: u128) -> Option<(u128, u128)> {
    let units = price_yocto / YOCTO_PER_MILLINEAR;
    let amount = units.checked_mul(score as u128)?.checked_mul(mint_rate)? / 100;
    Some((units, amount))
}

impl BountyHub {
    fn now(&self) -> u64 {
        env::block_timestamp_ms()
    }

    fn log_activity(
        &mut self,
        kind: ActivityKind,
        bounty_id: Option<u64>,
        bid_id: Option<u64>,
        amount: Option<u128>,
        detail: String,
    ) {
        let detail = truncate(&detail, MAX_DETAIL);
        env::log_str(&format!("hivefund: {}", detail));
        let entry = ActivityEntry {
            id: self.activity.len() as u64,
            ts_ms: self.now(),
            block_height: env::block_height(),
            actor: env::predecessor_account_id(),
            kind,
            bounty_id,
            bid_id,
            amount: amount.map(U128),
            detail,
        };
        self.activity.push(entry);
    }

    fn assert_owner(&self) {
        if env::predecessor_account_id() != self.owner {
            env::panic_str(ERR_NOT_OWNER);
        }
    }

    fn is_coordinator(&self, a: &AccountId) -> bool {
        self.coordinator.as_ref() == Some(a)
    }

    fn is_verifier(&self, a: &AccountId) -> bool {
        self.verifier.as_ref() == Some(a)
    }

    fn assert_coordinator(&self) {
        if !self.is_coordinator(&env::predecessor_account_id()) {
            env::panic_str(ERR_NOT_COORDINATOR);
        }
    }

    fn assert_verifier(&self) {
        if !self.is_verifier(&env::predecessor_account_id()) {
            env::panic_str(ERR_NOT_VERIFIER);
        }
    }

    fn bounty(&self, id: u64) -> Bounty {
        u32::try_from(id)
            .ok()
            .and_then(|i| self.bounties.get(i))
            .cloned()
            .unwrap_or_else(|| env::panic_str(ERR_BOUNTY_NOT_FOUND))
    }

    fn save_bounty(&mut self, mut b: Bounty) {
        b.updated_ms = self.now();
        self.bounties.set(b.id as u32, b);
    }

    fn bid(&self, id: u64) -> Bid {
        u32::try_from(id)
            .ok()
            .and_then(|i| self.bids.get(i))
            .cloned()
            .unwrap_or_else(|| env::panic_str(ERR_BID_NOT_FOUND))
    }

    fn save_bid(&mut self, b: Bid) {
        self.bids.set(b.id as u32, b);
    }

    /// Releases a bounty's escrow back to `available` (cancel / two failed verifications).
    fn refund_escrow(&mut self, bounty: &Bounty) {
        let budget = bounty.budget_yocto.0;
        self.treasury.escrowed = sub(self.treasury.escrowed, budget);
        self.treasury.committed_total = sub(self.treasury.committed_total, budget);
        self.treasury.available = add(self.treasury.available, budget);
        self.treasury.refunded_total = add(self.treasury.refunded_total, budget);
        self.log_activity(
            ActivityKind::TreasuryRefund,
            Some(bounty.id),
            None,
            Some(budget),
            format!("escrow of bounty #{} returned to treasury", bounty.id),
        );
    }

    /// Marks every Pending (and Won, when `include_won`) bid of the bounty as Superseded.
    fn supersede_open_bids(&mut self, bounty: &Bounty, include_won: bool) {
        for id in bounty.bid_ids.iter() {
            let mut b = self.bid(*id);
            if b.status == BidStatus::Pending || (include_won && b.status == BidStatus::Won) {
                b.status = BidStatus::Superseded;
                self.save_bid(b);
            }
        }
    }

    fn issue_mint(&mut self, pm: &PendingMint) -> Promise {
        self.mints_in_flight.insert(pm.bounty_id);
        ext_hive_token::ext(self.hive_token.clone())
            .with_static_gas(MINT_GAS)
            .mint(pm.recipient.clone(), pm.amount)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(ON_MINT_GAS)
                    .on_mint_complete(
                        pm.bounty_id,
                        pm.recipient.clone(),
                        pm.amount,
                        pm.bid_units,
                        pm.score,
                    ),
            )
    }

    fn new_bid_rejected(&mut self, mut bid: Bid, reason: &str) -> u64 {
        bid.status = BidStatus::Rejected;
        bid.reject_reason = Some(reason.to_string());
        let id = bid.id;
        let bounty_id = bid.bounty_id;
        let worker = bid.worker.clone();
        self.bids.push(bid);
        let mut bounty = self.bounty(bounty_id);
        bounty.bid_ids.push(id);
        self.save_bounty(bounty);
        self.log_activity(
            ActivityKind::BidRejected,
            Some(bounty_id),
            Some(id),
            None,
            format!("bid #{} by {} rejected: {}", id, worker, reason),
        );
        id
    }
}

// ---------------------------------------------------------------- public interface

#[near]
impl BountyHub {
    #[init]
    pub fn init(
        owner: AccountId,
        hive_token_account: AccountId,
        treasury_budget_yocto: U128,
        mint_rate: U128,
    ) -> Self {
        Self {
            owner,
            coordinator: None,
            verifier: None,
            hive_token: hive_token_account,
            mint_rate: mint_rate.0,
            total_minted: 0,
            treasury: Treasury {
                spend_cap: treasury_budget_yocto,
                committed_total: U128(0),
                funded_total: U128(0),
                available: U128(0),
                escrowed: U128(0),
                paid_out: U128(0),
                refunded_total: U128(0),
            },
            bounties: Vector::new(StorageKey::Bounties),
            bids: Vector::new(StorageKey::Bids),
            workers: IterableMap::new(StorageKey::Workers),
            activity: Vector::new(StorageKey::Activity),
            supply: Vector::new(StorageKey::Supply),
            pending_mints: IterableMap::new(StorageKey::PendingMints),
            mints_in_flight: LookupSet::new(StorageKey::MintsInFlight),
        }
    }

    // ------------------------------------------------------------ treasury & roles

    /// Anyone (community member, DAO) can fund the treasury.
    #[payable]
    pub fn fund_treasury(&mut self) {
        let d = env::attached_deposit().as_yoctonear();
        if d == 0 {
            env::panic_str(ERR_ZERO_DEPOSIT);
        }
        self.treasury.funded_total = add(self.treasury.funded_total, d);
        self.treasury.available = add(self.treasury.available, d);
        let who = env::predecessor_account_id();
        self.log_activity(
            ActivityKind::TreasuryFunded,
            None,
            None,
            Some(d),
            format!("{} funded the treasury", who),
        );
    }

    pub fn set_coordinator(&mut self, account_id: AccountId) {
        self.assert_owner();
        if self.is_verifier(&account_id) || self.workers.contains_key(&account_id) {
            env::panic_str(ERR_ROLE_CONFLICT);
        }
        self.coordinator = Some(account_id.clone());
        self.log_activity(
            ActivityKind::RoleChanged,
            None,
            None,
            None,
            format!("coordinator = {}", account_id),
        );
    }

    pub fn set_verifier(&mut self, account_id: AccountId) {
        self.assert_owner();
        if self.is_coordinator(&account_id) || self.workers.contains_key(&account_id) {
            env::panic_str(ERR_ROLE_CONFLICT);
        }
        self.verifier = Some(account_id.clone());
        self.log_activity(
            ActivityKind::RoleChanged,
            None,
            None,
            None,
            format!("verifier = {}", account_id),
        );
    }

    /// Registers (or re-activates / updates) a worker with its tier and bid-signing public key.
    pub fn add_worker(&mut self, account_id: AccountId, tier: u8, signing_pk: String) {
        self.assert_owner();
        if tier == 0 || tier > MAX_TIER {
            env::panic_str(ERR_BAD_TIER);
        }
        assert_max_len(&signing_pk, MAX_PK);
        if !signing_pk.starts_with("ed25519:") || signing_pk.len() <= "ed25519:".len() {
            env::panic_str(ERR_BAD_PK);
        }
        if self.is_coordinator(&account_id) || self.is_verifier(&account_id) {
            env::panic_str(ERR_ROLE_CONFLICT);
        }
        let info = match self.workers.get(&account_id) {
            Some(w) => WorkerInfo {
                tier,
                signing_pk,
                active: true,
                ..w.clone()
            },
            None => WorkerInfo {
                account_id: account_id.clone(),
                tier,
                signing_pk,
                active: true,
                completed: 0,
                failed: 0,
                total_score: 0,
                earned_yocto: U128(0),
                hive_earned: U128(0),
            },
        };
        self.workers.insert(account_id.clone(), info);
        self.log_activity(
            ActivityKind::WorkerAdded,
            None,
            None,
            None,
            format!("worker {} registered at tier {}", account_id, tier),
        );
    }

    pub fn remove_worker(&mut self, account_id: AccountId) {
        self.assert_owner();
        let mut w = self
            .workers
            .get(&account_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str(ERR_NOT_WORKER));
        w.active = false;
        self.workers.insert(account_id.clone(), w);
        self.log_activity(
            ActivityKind::WorkerRemoved,
            None,
            None,
            None,
            format!("worker {} deactivated", account_id),
        );
    }

    pub fn set_mint_rate(&mut self, mint_rate: U128) {
        self.assert_owner();
        self.mint_rate = mint_rate.0;
        self.log_activity(
            ActivityKind::RoleChanged,
            None,
            None,
            None,
            format!("mint_rate = {}", mint_rate.0),
        );
    }

    // ------------------------------------------------------------ bounty lifecycle

    pub fn post_bounty(
        &mut self,
        title: String,
        spec_hash: String,
        budget_yocto: U128,
        deadline_ms: u64,
        min_tier: u8,
    ) -> u64 {
        let caller = env::predecessor_account_id();
        if caller != self.owner && !self.is_coordinator(&caller) {
            env::panic_str(ERR_NOT_POSTER);
        }
        assert_max_len(&title, MAX_TITLE);
        assert_hash(&spec_hash);
        if min_tier == 0 || min_tier > MAX_TIER {
            env::panic_str(ERR_BAD_TIER);
        }
        let budget = budget_yocto.0;
        if budget == 0 {
            env::panic_str(ERR_ZERO_BUDGET);
        }
        if budget > self.treasury.available.0 {
            env::panic_str(ERR_TREASURY_INSUFFICIENT);
        }
        let committed = self
            .treasury
            .committed_total
            .0
            .checked_add(budget)
            .unwrap_or_else(|| env::panic_str(ERR_OVERFLOW));
        if committed > self.treasury.spend_cap.0 {
            env::panic_str(ERR_SPEND_CAP);
        }
        let now = self.now();
        if deadline_ms <= now {
            env::panic_str(ERR_DEADLINE_PAST);
        }
        self.treasury.available = sub(self.treasury.available, budget);
        self.treasury.escrowed = add(self.treasury.escrowed, budget);
        self.treasury.committed_total = U128(committed);

        let id = self.bounties.len() as u64;
        self.bounties.push(Bounty {
            id,
            title: title.clone(),
            spec_hash,
            poster: caller,
            budget_yocto,
            deadline_ms,
            min_tier,
            status: BountyStatus::Open,
            round: 0,
            attempts: 0,
            bid_ids: vec![],
            winner_bid_id: None,
            deliverable_hash: None,
            check_results_hash: None,
            score: None,
            excluded: vec![],
            created_ms: now,
            updated_ms: now,
            hive_minted: U128(0),
        });
        self.log_activity(
            ActivityKind::BountyPosted,
            Some(id),
            None,
            Some(budget),
            format!("bounty #{} posted: {}", id, title),
        );
        id
    }

    /// Worker-only. Business-rule violations do NOT panic: the bid is stored as `Rejected`
    /// with a reason and logged, so the rejection is visible on-chain. The bid signature is
    /// stored but verified off-chain by the coordinator (see PLAN §2 decision).
    pub fn place_bid(
        &mut self,
        bounty_id: u64,
        price_yocto: U128,
        eta_ms: u64,
        signature: String,
    ) -> u64 {
        let worker_id = env::predecessor_account_id();
        let worker = match self.workers.get(&worker_id) {
            Some(w) if w.active => w.clone(),
            _ => env::panic_str(ERR_NOT_WORKER),
        };
        let mut bounty = self.bounty(bounty_id);
        assert_max_len(&signature, MAX_SIGNATURE);
        if bounty.bid_ids.len() >= MAX_BIDS_PER_BOUNTY {
            env::panic_str(ERR_TOO_MANY_BIDS);
        }

        let now = self.now();
        let id = self.bids.len() as u64;
        let bid = Bid {
            id,
            bounty_id,
            round: bounty.round,
            worker: worker_id.clone(),
            tier: worker.tier,
            price_yocto,
            eta_ms,
            signed_payload: bid_payload(
                bounty_id,
                env::current_account_id().as_str(),
                eta_ms,
                price_yocto.0,
                bounty.round,
                worker_id.as_str(),
            ),
            signature,
            status: BidStatus::Pending,
            reject_reason: None,
            created_ms: now,
        };

        let reason = if !matches!(bounty.status, BountyStatus::Open | BountyStatus::Bidding) {
            Some(REJECT_CLOSED)
        } else if now > bounty.deadline_ms {
            Some(REJECT_DEADLINE)
        } else if price_yocto.0 > bounty.budget_yocto.0 {
            Some(REJECT_OVER_BUDGET)
        } else if worker.tier < bounty.min_tier {
            Some(REJECT_TIER)
        } else if bounty.excluded.contains(&worker_id) {
            Some(REJECT_EXCLUDED)
        } else if bounty.bid_ids.iter().any(|b| {
            let b = self.bid(*b);
            b.worker == worker_id && b.round == bounty.round && b.status == BidStatus::Pending
        }) {
            Some(REJECT_DUPLICATE)
        } else {
            None
        };
        if let Some(r) = reason {
            return self.new_bid_rejected(bid, r);
        }

        self.bids.push(bid);
        bounty.bid_ids.push(id);
        bounty.status = BountyStatus::Bidding;
        self.save_bounty(bounty);
        self.log_activity(
            ActivityKind::BidPlaced,
            Some(bounty_id),
            Some(id),
            Some(price_yocto.0),
            format!(
                "{} bid {} yocto, eta {} ms",
                worker_id, price_yocto.0, eta_ms
            ),
        );
        id
    }

    /// Coordinator rejects a Pending bid (e.g. "invalid bid signature"); logged on-chain.
    pub fn reject_bid(&mut self, bounty_id: u64, bid_id: u64, reason: String) {
        self.assert_coordinator();
        assert_max_len(&reason, MAX_REASON);
        let _ = self.bounty(bounty_id);
        let mut bid = self.bid(bid_id);
        if bid.bounty_id != bounty_id || bid.status != BidStatus::Pending {
            env::panic_str(ERR_BID_NOT_SELECTABLE);
        }
        bid.status = BidStatus::Rejected;
        bid.reject_reason = Some(reason.clone());
        let worker = bid.worker.clone();
        self.save_bid(bid);
        self.log_activity(
            ActivityKind::BidRejected,
            Some(bounty_id),
            Some(bid_id),
            None,
            format!(
                "bid #{} by {} rejected by coordinator: {}",
                bid_id, worker, reason
            ),
        );
    }

    pub fn select_winner(&mut self, bounty_id: u64, bid_id: u64) {
        self.assert_coordinator();
        let mut bounty = self.bounty(bounty_id);
        if bounty.status != BountyStatus::Bidding {
            env::panic_str(ERR_BAD_STATUS);
        }
        let winner = self.bid(bid_id);
        if winner.bounty_id != bounty_id
            || winner.status != BidStatus::Pending
            || winner.round != bounty.round
        {
            env::panic_str(ERR_BID_NOT_SELECTABLE);
        }
        for id in bounty.bid_ids.iter() {
            let mut b = self.bid(*id);
            if b.round == bounty.round && b.status == BidStatus::Pending {
                b.status = if b.id == bid_id {
                    BidStatus::Won
                } else {
                    BidStatus::Lost
                };
                self.save_bid(b);
            }
        }
        bounty.winner_bid_id = Some(bid_id);
        bounty.status = BountyStatus::InProgress;
        self.save_bounty(bounty);
        self.log_activity(
            ActivityKind::WinnerSelected,
            Some(bounty_id),
            Some(bid_id),
            Some(winner.price_yocto.0),
            format!("bid #{} by {} selected", bid_id, winner.worker),
        );
    }

    pub fn submit_work(&mut self, bounty_id: u64, deliverable_hash: String) {
        let mut bounty = self.bounty(bounty_id);
        if bounty.status != BountyStatus::InProgress {
            env::panic_str(ERR_BAD_STATUS);
        }
        let winner = bounty
            .winner_bid_id
            .map(|id| self.bid(id))
            .unwrap_or_else(|| env::panic_str(ERR_NOT_WINNER));
        if env::predecessor_account_id() != winner.worker {
            env::panic_str(ERR_NOT_WINNER);
        }
        assert_hash(&deliverable_hash);
        bounty.deliverable_hash = Some(deliverable_hash.clone());
        bounty.status = BountyStatus::Verifying;
        self.save_bounty(bounty);
        self.log_activity(
            ActivityKind::WorkSubmitted,
            Some(bounty_id),
            Some(winner.id),
            None,
            format!(
                "{} submitted deliverable {}",
                winner.worker, deliverable_hash
            ),
        );
    }

    /// Verifier-only. Attach ~100 TGas. PASS pays the winner its bid price from escrow and
    /// mints HIVE through `hive-token.mint` (returned promise + `on_mint_complete` callback).
    /// FAIL excludes the worker and reopens bidding; the 2nd failure cancels and refunds.
    pub fn verify_bounty(
        &mut self,
        bounty_id: u64,
        passed: bool,
        score: u32,
        check_results_hash: String,
    ) -> PromiseOrValue<()> {
        self.assert_verifier();
        let mut bounty = self.bounty(bounty_id);
        if bounty.status != BountyStatus::Verifying {
            env::panic_str(ERR_BAD_STATUS);
        }
        if score > 100 {
            env::panic_str(ERR_BAD_SCORE);
        }
        assert_hash(&check_results_hash);
        let mut winner_bid = bounty
            .winner_bid_id
            .map(|id| self.bid(id))
            .unwrap_or_else(|| env::panic_str(ERR_BID_NOT_FOUND));
        let worker_id = winner_bid.worker.clone();
        let mut worker = self
            .workers
            .get(&worker_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str(ERR_NOT_WORKER));

        bounty.check_results_hash = Some(check_results_hash.clone());
        bounty.score = Some(score);

        if passed && score > 0 {
            let price = winner_bid.price_yocto.0;
            let budget = bounty.budget_yocto.0;
            // Compute mint first so an overflow reverts before any state change.
            let (units, amount) = mint_amount(price, score, self.mint_rate)
                .unwrap_or_else(|| env::panic_str(ERR_OVERFLOW));

            // 1. statuses
            winner_bid.status = BidStatus::Paid;
            self.save_bid(winner_bid.clone());
            bounty.status = BountyStatus::Completed;
            self.save_bounty(bounty.clone());

            // 2. treasury: debit before transfer
            let unspent = budget - price; // price <= budget enforced in place_bid
            self.treasury.escrowed = sub(self.treasury.escrowed, budget);
            self.treasury.paid_out = add(self.treasury.paid_out, price);
            self.treasury.available = add(self.treasury.available, unspent);
            self.treasury.committed_total = sub(self.treasury.committed_total, unspent);

            // 3. payout
            if price > 0 {
                Promise::new(worker_id.clone())
                    .transfer(NearToken::from_yoctonear(price))
                    .detach();
            }
            self.log_activity(
                ActivityKind::Payout,
                Some(bounty_id),
                Some(winner_bid.id),
                Some(price),
                format!("paid {} yocto to {}", price, worker_id),
            );
            self.log_activity(
                ActivityKind::VerificationPassed,
                Some(bounty_id),
                Some(winner_bid.id),
                None,
                format!("score {} checks {}", score, check_results_hash),
            );

            // 4. reputation
            worker.completed += 1;
            worker.total_score += score as u64;
            worker.earned_yocto = add(worker.earned_yocto, price);
            self.workers.insert(worker_id.clone(), worker);

            // 5-6. mint
            if amount > 0 {
                let pm = PendingMint {
                    bounty_id,
                    recipient: worker_id,
                    amount: U128(amount),
                    bid_units: U128(units),
                    score,
                };
                self.pending_mints.insert(bounty_id, pm.clone());
                return PromiseOrValue::Promise(self.issue_mint(&pm));
            }
            return PromiseOrValue::Value(());
        }

        // FAIL
        winner_bid.status = BidStatus::Failed;
        self.save_bid(winner_bid.clone());
        bounty.excluded.push(worker_id.clone());
        bounty.attempts += 1;
        worker.failed += 1;
        self.workers.insert(worker_id.clone(), worker);
        self.log_activity(
            ActivityKind::VerificationFailed,
            Some(bounty_id),
            Some(winner_bid.id),
            None,
            format!(
                "{} failed (score {}), attempt {}, checks {}",
                worker_id, score, bounty.attempts, check_results_hash
            ),
        );

        if bounty.attempts >= MAX_ATTEMPTS {
            bounty.status = BountyStatus::Cancelled;
            bounty.winner_bid_id = None;
            self.supersede_open_bids(&bounty, false);
            self.save_bounty(bounty.clone());
            self.refund_escrow(&bounty);
            self.log_activity(
                ActivityKind::BountyCancelled,
                Some(bounty_id),
                None,
                None,
                format!(
                    "bounty #{} cancelled after {} failed verifications",
                    bounty_id, bounty.attempts
                ),
            );
        } else {
            self.supersede_open_bids(&bounty, false);
            bounty.round += 1;
            bounty.status = BountyStatus::Open;
            bounty.winner_bid_id = None;
            bounty.deliverable_hash = None;
            self.save_bounty(bounty.clone());
            self.log_activity(
                ActivityKind::BountyReopened,
                Some(bounty_id),
                None,
                None,
                format!("bounty #{} reopened for round {}", bounty_id, bounty.round),
            );
        }
        PromiseOrValue::Value(())
    }

    /// Callback of `hive-token.mint`. Never panics on the failure path.
    #[private]
    pub fn on_mint_complete(
        &mut self,
        bounty_id: u64,
        recipient: AccountId,
        amount: U128,
        bid_units: U128,
        score: u32,
        #[callback_result] result: Result<(), PromiseError>,
    ) {
        self.mints_in_flight.remove(&bounty_id);
        if result.is_err() {
            self.log_activity(
                ActivityKind::MintFailed,
                Some(bounty_id),
                None,
                Some(amount.0),
                format!(
                    "mint of {} HIVE-yocto to {} failed; retry_mint available",
                    amount.0, recipient
                ),
            );
            return;
        }
        if self.pending_mints.remove(&bounty_id).is_none() {
            // Defensive: nothing pending (should not happen thanks to the in-flight guard).
            env::log_str("hivefund: on_mint_complete without pending mint");
            return;
        }
        let total = self.total_minted.saturating_add(amount.0);
        self.total_minted = total;
        let point = SupplyPoint {
            id: self.supply.len() as u64,
            ts_ms: self.now(),
            block_height: env::block_height(),
            bounty_id,
            recipient: recipient.clone(),
            bid_units,
            score,
            mint_rate: U128(self.mint_rate),
            amount,
            total_minted_after: U128(total),
        };
        self.supply.push(point);
        if let Some(i) = u32::try_from(bounty_id)
            .ok()
            .filter(|i| *i < self.bounties.len())
        {
            let mut b = self.bounties[i].clone();
            b.hive_minted = amount;
            self.save_bounty(b);
        }
        if let Some(w) = self.workers.get(&recipient).cloned() {
            let hive = w.hive_earned.0.saturating_add(amount.0);
            self.workers.insert(
                recipient.clone(),
                WorkerInfo {
                    hive_earned: U128(hive),
                    ..w
                },
            );
        }
        self.log_activity(
            ActivityKind::Mint,
            Some(bounty_id),
            None,
            Some(amount.0),
            format!(
                "minted {} HIVE-yocto to {} = {} units x {} / 100 x rate",
                amount.0, recipient, bid_units.0, score
            ),
        );
    }

    /// Owner re-issues a failed mint. Refused while the previous mint is still in flight.
    pub fn retry_mint(&mut self, bounty_id: u64) -> Promise {
        self.assert_owner();
        let pm = self
            .pending_mints
            .get(&bounty_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str(ERR_NO_PENDING_MINT));
        if self.mints_in_flight.contains(&bounty_id) {
            env::panic_str(ERR_MINT_IN_FLIGHT);
        }
        self.issue_mint(&pm)
    }

    pub fn cancel_bounty(&mut self, bounty_id: u64) {
        let caller = env::predecessor_account_id();
        if caller != self.owner && !self.is_coordinator(&caller) {
            env::panic_str(ERR_NOT_CANCELLER);
        }
        let mut bounty = self.bounty(bounty_id);
        if !matches!(
            bounty.status,
            BountyStatus::Open | BountyStatus::Bidding | BountyStatus::InProgress
        ) {
            env::panic_str(ERR_BAD_STATUS);
        }
        self.supersede_open_bids(&bounty, true);
        bounty.status = BountyStatus::Cancelled;
        bounty.winner_bid_id = None;
        self.save_bounty(bounty.clone());
        self.log_activity(
            ActivityKind::BountyCancelled,
            Some(bounty_id),
            None,
            None,
            format!("bounty #{} cancelled by {}", bounty_id, caller),
        );
        self.refund_escrow(&bounty);
    }
}
