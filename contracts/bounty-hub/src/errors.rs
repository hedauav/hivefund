//! Panic codes. Every panic message STARTS with the constant's name so tests
//! (`#[should_panic(expected = "ERR_...")]`, TS `includes("ERR_...")`) can match.

pub const ERR_NOT_OWNER: &str = "ERR_NOT_OWNER";
pub const ERR_NOT_COORDINATOR: &str = "ERR_NOT_COORDINATOR";
pub const ERR_NOT_VERIFIER: &str = "ERR_NOT_VERIFIER";
pub const ERR_NOT_WORKER: &str = "ERR_NOT_WORKER";
pub const ERR_NOT_WINNER: &str = "ERR_NOT_WINNER";
pub const ERR_NOT_POSTER: &str = "ERR_NOT_POSTER: only owner or coordinator may post";
pub const ERR_NOT_CANCELLER: &str = "ERR_NOT_COORDINATOR: only owner or coordinator may cancel";
pub const ERR_ROLE_CONFLICT: &str = "ERR_ROLE_CONFLICT";
pub const ERR_BAD_TIER: &str = "ERR_BAD_TIER";
pub const ERR_BAD_SCORE: &str = "ERR_BAD_SCORE";
pub const ERR_BAD_HASH: &str = "ERR_BAD_HASH";
pub const ERR_BAD_PK: &str = "ERR_BAD_HASH: signing_pk must be ed25519:<base58>";
pub const ERR_TOO_LONG: &str = "ERR_TOO_LONG";
pub const ERR_TOO_MANY_BIDS: &str = "ERR_TOO_MANY_BIDS";
pub const ERR_BOUNTY_NOT_FOUND: &str = "ERR_BOUNTY_NOT_FOUND";
pub const ERR_BID_NOT_FOUND: &str = "ERR_BID_NOT_FOUND";
pub const ERR_BAD_STATUS: &str = "ERR_BAD_STATUS";
pub const ERR_BID_NOT_SELECTABLE: &str = "ERR_BID_NOT_SELECTABLE";
pub const ERR_TREASURY_INSUFFICIENT: &str = "ERR_TREASURY_INSUFFICIENT";
pub const ERR_SPEND_CAP: &str = "ERR_SPEND_CAP";
pub const ERR_DEADLINE_PAST: &str = "ERR_DEADLINE_PAST";
pub const ERR_ZERO_DEPOSIT: &str = "ERR_ZERO_DEPOSIT";
pub const ERR_ZERO_BUDGET: &str = "ERR_TREASURY_INSUFFICIENT: budget must be > 0";
pub const ERR_OVERFLOW: &str = "ERR_OVERFLOW";
pub const ERR_NO_PENDING_MINT: &str = "ERR_NO_PENDING_MINT";
pub const ERR_MINT_IN_FLIGHT: &str = "ERR_BAD_STATUS: mint already in flight";
pub const ERR_CONFIG_LOCKED: &str = "ERR_CONFIG_LOCKED";

/// `place_bid` business-rule rejections: stored as `Rejected` bids, never panics.
pub const REJECT_CLOSED: &str = "bounty closed";
pub const REJECT_DEADLINE: &str = "deadline passed";
pub const REJECT_OVER_BUDGET: &str = "price exceeds budget";
pub const REJECT_TIER: &str = "tier below min_tier";
pub const REJECT_EXCLUDED: &str = "worker excluded";
pub const REJECT_DUPLICATE: &str = "duplicate bid this round";
