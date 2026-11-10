use near_sdk::json_types::U128;
use near_sdk::{near, AccountId};

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BountyStatus {
    Open,
    Bidding,
    InProgress,
    Verifying,
    Completed,
    /// Reserved for the dispute stretch goal (cut #1). Never entered in v0.1.
    Disputed,
    Cancelled,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BidStatus {
    Pending,
    Rejected,
    Won,
    Lost,
    Superseded,
    Failed,
    Paid,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ActivityKind {
    TreasuryFunded,
    RoleChanged,
    WorkerAdded,
    WorkerRemoved,
    BountyPosted,
    BidPlaced,
    BidRejected,
    WinnerSelected,
    WorkSubmitted,
    VerificationPassed,
    VerificationFailed,
    Payout,
    Mint,
    MintFailed,
    BountyReopened,
    BountyCancelled,
    TreasuryRefund,
    DisputeOpened,
    DisputeResolved,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Bounty {
    pub id: u64,
    pub title: String,
    pub spec_hash: String,
    pub poster: AccountId,
    pub budget_yocto: U128,
    pub deadline_ms: u64,
    pub min_tier: u8,
    pub status: BountyStatus,
    /// == number of failed verifications so far; bids carry the round they were placed in.
    pub round: u32,
    /// Failed verifications; 2 => Cancelled.
    pub attempts: u32,
    pub bid_ids: Vec<u64>,
    pub winner_bid_id: Option<u64>,
    pub deliverable_hash: Option<String>,
    pub check_results_hash: Option<String>,
    pub score: Option<u32>,
    pub excluded: Vec<AccountId>,
    pub created_ms: u64,
    pub updated_ms: u64,
    pub hive_minted: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Bid {
    pub id: u64,
    pub bounty_id: u64,
    pub round: u32,
    pub worker: AccountId,
    pub tier: u8,
    pub price_yocto: U128,
    pub eta_ms: u64,
    pub signature: String,
    pub signed_payload: String,
    pub status: BidStatus,
    pub reject_reason: Option<String>,
    pub created_ms: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct WorkerInfo {
    pub account_id: AccountId,
    pub tier: u8,
    pub signing_pk: String,
    pub active: bool,
    pub completed: u32,
    pub failed: u32,
    pub total_score: u64,
    pub earned_yocto: U128,
    pub hive_earned: U128,
}

impl WorkerInfo {
    /// reputation = max(0, completed*10 + total_score/10 - failed*15)
    pub fn reputation(&self) -> u32 {
        let r =
            self.completed as i64 * 10 + (self.total_score / 10) as i64 - self.failed as i64 * 15;
        r.clamp(0, u32::MAX as i64) as u32
    }
}

/// `get_reputation` row: WorkerInfo + computed reputation.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct WorkerView {
    pub account_id: AccountId,
    pub tier: u8,
    pub signing_pk: String,
    pub active: bool,
    pub completed: u32,
    pub failed: u32,
    pub total_score: u64,
    pub earned_yocto: U128,
    pub hive_earned: U128,
    pub reputation: u32,
}

impl From<&WorkerInfo> for WorkerView {
    fn from(w: &WorkerInfo) -> Self {
        WorkerView {
            account_id: w.account_id.clone(),
            tier: w.tier,
            signing_pk: w.signing_pk.clone(),
            active: w.active,
            completed: w.completed,
            failed: w.failed,
            total_score: w.total_score,
            earned_yocto: w.earned_yocto,
            hive_earned: w.hive_earned,
            reputation: w.reputation(),
        }
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct ActivityEntry {
    pub id: u64,
    pub ts_ms: u64,
    pub block_height: u64,
    pub actor: AccountId,
    pub kind: ActivityKind,
    pub bounty_id: Option<u64>,
    pub bid_id: Option<u64>,
    pub amount: Option<U128>,
    /// <= 200 chars, human readable.
    pub detail: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct SupplyPoint {
    pub id: u64,
    pub ts_ms: u64,
    pub block_height: u64,
    pub bounty_id: u64,
    pub recipient: AccountId,
    pub bid_units: U128,
    pub score: u32,
    pub mint_rate: U128,
    pub amount: U128,
    pub total_minted_after: U128,
}

/// Treasury accounting (all yoctoNEAR).
/// Invariants: `committed_total == escrowed + paid_out` and `committed_total <= spend_cap`.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Treasury {
    pub spend_cap: U128,
    pub committed_total: U128,
    pub funded_total: U128,
    pub available: U128,
    pub escrowed: U128,
    pub paid_out: U128,
    pub refunded_total: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct PendingMint {
    pub bounty_id: u64,
    pub recipient: AccountId,
    pub amount: U128,
    pub bid_units: U128,
    pub score: u32,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct HubConfig {
    pub owner: AccountId,
    pub coordinator: Option<AccountId>,
    pub verifier: Option<AccountId>,
    pub hive_token: AccountId,
    pub mint_rate: U128,
    pub total_minted: U128,
    pub version: String,
}
