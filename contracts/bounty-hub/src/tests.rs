use super::*;
use near_sdk::serde_json;
use near_sdk::test_utils::{get_created_receipts, VMContextBuilder};
use near_sdk::{test_vm_config, testing_env, PromiseResult, RuntimeFeesConfig};

const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const T0_MS: u64 = 1_700_000_000_000;
const HOUR_MS: u64 = 3_600_000;
const RATE: u128 = 10_000_000_000_000_000; // 1e16

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn hub_id() -> AccountId {
    acc("hub.testnet")
}
fn owner() -> AccountId {
    acc("owner.testnet")
}
fn token() -> AccountId {
    acc("hive.testnet")
}
fn coord() -> AccountId {
    acc("coordinator.testnet")
}
fn verifier() -> AccountId {
    acc("verifier.testnet")
}
fn cheap() -> AccountId {
    acc("cheap.testnet")
}
fn quality() -> AccountId {
    acc("quality.testnet")
}
fn adaptive() -> AccountId {
    acc("adaptive.testnet")
}
fn stranger() -> AccountId {
    acc("stranger.testnet")
}
fn h(c: char) -> String {
    std::iter::repeat_n(c, 64).collect()
}
const PK: &str = "ed25519:DcA2MzgpJbrUATQLLceocVckhhAqrkingax4oJ9kZ847";

fn ctx(pred: &AccountId, deposit: u128, now_ms: u64) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(hub_id())
        .predecessor_account_id(pred.clone())
        .signer_account_id(pred.clone())
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .account_balance(NearToken::from_near(50))
        .block_timestamp(now_ms * 1_000_000);
    b
}

fn as_caller(pred: &AccountId) {
    testing_env!(ctx(pred, 0, T0_MS).build());
}

fn as_caller_at(pred: &AccountId, now_ms: u64) {
    testing_env!(ctx(pred, 0, now_ms).build());
}

/// Runs the callback context: predecessor == current account (#[private]) + promise result.
fn as_callback(result: PromiseResult) {
    testing_env!(
        ctx(&hub_id(), 0, T0_MS).build(),
        test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![result],
    );
}

/// Hub with roles, 3 workers (cheap tier1, adaptive tier2, quality tier3), cap 20 NEAR,
/// treasury funded with 10 NEAR.
fn setup() -> BountyHub {
    as_caller(&owner());
    let mut hub = BountyHub::init(owner(), token(), U128(20 * NEAR), U128(RATE));
    hub.set_coordinator(coord());
    hub.set_verifier(verifier());
    hub.add_worker(cheap(), 1, PK.to_string());
    hub.add_worker(adaptive(), 2, PK.to_string());
    hub.add_worker(quality(), 3, PK.to_string());
    testing_env!(ctx(&stranger(), 10 * NEAR, T0_MS).build());
    hub.fund_treasury();
    hub
}

fn post(hub: &mut BountyHub, budget: u128, min_tier: u8) -> u64 {
    as_caller(&coord());
    hub.post_bounty(
        "Write slugify()".to_string(),
        h('a'),
        U128(budget),
        T0_MS + HOUR_MS,
        min_tier,
    )
}

fn bid(hub: &mut BountyHub, worker: &AccountId, bounty: u64, price: u128) -> u64 {
    as_caller(worker);
    hub.place_bid(bounty, U128(price), 600_000, "ed25519:sig".to_string())
}

fn bid_status(hub: &BountyHub, id: u64) -> (BidStatus, Option<String>) {
    let b = hub.bids.get(id as u32).unwrap();
    (b.status, b.reject_reason.clone())
}

fn status(hub: &BountyHub, id: u64) -> BountyStatus {
    hub.get_bounty(id).unwrap().status
}

/// post (1 NEAR) -> cheap bids 0.5 -> selected -> submitted -> Verifying.
fn to_verifying(hub: &mut BountyHub) -> (u64, u64) {
    let b = post(hub, NEAR, 1);
    let bid_id = bid(hub, &cheap(), b, NEAR / 2);
    as_caller(&coord());
    hub.select_winner(b, bid_id);
    as_caller(&cheap());
    hub.submit_work(b, h('d'));
    (b, bid_id)
}

fn kinds(hub: &BountyHub) -> Vec<ActivityKind> {
    hub.get_activity_log(None, Some(1000))
        .into_iter()
        .map(|e| e.kind)
        .collect()
}

// ------------------------------------------------------------------ init / treasury / roles

#[test]
fn init_sets_config_and_cap() {
    as_caller(&owner());
    let hub = BountyHub::init(owner(), token(), U128(20 * NEAR), U128(RATE));
    let c = hub.get_config();
    assert_eq!(c.owner, owner());
    assert_eq!(c.hive_token, token());
    assert_eq!(c.coordinator, None);
    assert_eq!(c.verifier, None);
    assert_eq!(c.mint_rate.0, RATE);
    assert_eq!(c.total_minted.0, 0);
    assert_eq!(c.version, "0.1.0");
    let t = hub.get_treasury();
    assert_eq!(t.spend_cap.0, 20 * NEAR);
    assert_eq!(t.available.0, 0);
}

#[test]
#[should_panic(expected = "The contract is not initialized")]
fn default_panics() {
    let _ = BountyHub::default();
}

#[test]
fn fund_treasury_adds_and_logs() {
    let hub = setup();
    let t = hub.get_treasury();
    assert_eq!(t.funded_total.0, 10 * NEAR);
    assert_eq!(t.available.0, 10 * NEAR);
    let log = hub.get_activity_log(None, None);
    let last = log.last().unwrap();
    assert_eq!(last.kind, ActivityKind::TreasuryFunded);
    assert_eq!(last.amount, Some(U128(10 * NEAR)));
    assert_eq!(last.actor, stranger());
}

#[test]
#[should_panic(expected = "ERR_ZERO_DEPOSIT")]
fn fund_treasury_zero_deposit() {
    let mut hub = setup();
    as_caller(&stranger());
    hub.fund_treasury();
}

#[test]
#[should_panic(expected = "ERR_NOT_OWNER")]
fn non_owner_cannot_set_coordinator() {
    let mut hub = setup();
    as_caller(&stranger());
    hub.set_coordinator(stranger());
}

#[test]
#[should_panic(expected = "ERR_NOT_OWNER")]
fn non_owner_cannot_add_worker() {
    let mut hub = setup();
    as_caller(&coord());
    hub.add_worker(stranger(), 1, PK.to_string());
}

#[test]
#[should_panic(expected = "ERR_ROLE_CONFLICT")]
fn verifier_cannot_also_be_coordinator() {
    let mut hub = setup();
    as_caller(&owner());
    hub.set_verifier(coord());
}

#[test]
#[should_panic(expected = "ERR_ROLE_CONFLICT")]
fn worker_cannot_be_coordinator() {
    let mut hub = setup();
    as_caller(&owner());
    hub.set_coordinator(cheap());
}

#[test]
#[should_panic(expected = "ERR_ROLE_CONFLICT")]
fn verifier_cannot_be_worker() {
    let mut hub = setup();
    as_caller(&owner());
    hub.add_worker(verifier(), 1, PK.to_string());
}

#[test]
#[should_panic(expected = "ERR_BAD_TIER")]
fn add_worker_bad_tier() {
    let mut hub = setup();
    as_caller(&owner());
    hub.add_worker(stranger(), 4, PK.to_string());
}

#[test]
#[should_panic(expected = "ERR_BAD_HASH")]
fn add_worker_bad_pk() {
    let mut hub = setup();
    as_caller(&owner());
    hub.add_worker(stranger(), 1, "secp256k1:abc".to_string());
}

#[test]
fn workers_listed_with_reputation_and_remove() {
    let mut hub = setup();
    assert_eq!(hub.get_reputation(None).len(), 3);
    let w = hub.get_reputation(Some(quality()));
    assert_eq!(w.len(), 1);
    assert_eq!(w[0].tier, 3);
    assert_eq!(w[0].reputation, 0);
    assert!(hub.get_reputation(Some(stranger())).is_empty());
    as_caller(&owner());
    hub.remove_worker(cheap());
    assert!(!hub.get_reputation(Some(cheap()))[0].active);
    assert_eq!(*kinds(&hub).last().unwrap(), ActivityKind::WorkerRemoved);
}

#[test]
fn set_mint_rate_owner_only() {
    let mut hub = setup();
    as_caller(&owner());
    hub.set_mint_rate(U128(5));
    assert_eq!(hub.get_config().mint_rate.0, 5);
}

// ------------------------------------------------------------------ lock_config

#[test]
fn lock_config_freezes_mint_rate() {
    let mut hub = setup();
    assert!(!hub.is_config_locked());
    as_caller(&owner());
    // before lock: owner can change config
    hub.set_mint_rate(U128(5));
    hub.set_mint_rate(U128(RATE));
    hub.lock_config();
    assert!(hub.is_config_locked());
    assert_eq!(hub.get_config().mint_rate.0, RATE);
    let last = hub.get_activity_log(None, Some(1000)).pop().unwrap();
    assert_eq!(last.kind, ActivityKind::RoleChanged);
    assert!(last.detail.contains("config locked"));
}

#[test]
#[should_panic(expected = "ERR_CONFIG_LOCKED")]
fn set_mint_rate_panics_after_lock() {
    let mut hub = setup();
    as_caller(&owner());
    hub.lock_config();
    hub.set_mint_rate(U128(5));
}

#[test]
#[should_panic(expected = "ERR_CONFIG_LOCKED")]
fn lock_config_twice_panics() {
    let mut hub = setup();
    as_caller(&owner());
    hub.lock_config();
    hub.lock_config();
}

#[test]
#[should_panic(expected = "ERR_NOT_OWNER")]
fn non_owner_cannot_lock_config() {
    let mut hub = setup();
    as_caller(&coord());
    hub.lock_config();
}

#[test]
fn hub_still_mints_after_lock() {
    let mut hub = setup();
    as_caller(&owner());
    hub.lock_config();
    let (b, _) = to_verifying(&mut hub);
    as_caller(&verifier());
    let r = hub.verify_bounty(b, true, 80, h('c'));
    assert!(matches!(r, PromiseOrValue::Promise(_)));
    drop(r);
    let pm = hub.get_pending_mints();
    assert_eq!(pm.len(), 1);
    assert_eq!(pm[0].amount.0, 4 * 10u128.pow(18));
    let receivers: Vec<String> = get_created_receipts()
        .iter()
        .map(|r| r.receiver_id.to_string())
        .collect();
    assert!(receivers.contains(&"hive.testnet".to_string()));
    // callback records the mint as usual
    as_callback(PromiseResult::Successful(vec![]));
    hub.on_mint_complete(b, cheap(), pm[0].amount, pm[0].bid_units, 80, Ok(()));
    assert_eq!(hub.get_config().total_minted.0, 4 * 10u128.pow(18));
}

// ------------------------------------------------------------------ post_bounty

#[test]
fn post_moves_budget_to_escrow() {
    let mut hub = setup();
    let id = post(&mut hub, 2 * NEAR, 1);
    assert_eq!(id, 0);
    let b = hub.get_bounty(0).unwrap();
    assert_eq!(b.status, BountyStatus::Open);
    assert_eq!(b.poster, coord());
    assert_eq!(b.round, 0);
    let t = hub.get_treasury();
    assert_eq!(t.available.0, 8 * NEAR);
    assert_eq!(t.escrowed.0, 2 * NEAR);
    assert_eq!(t.committed_total.0, 2 * NEAR);
    assert_eq!(*kinds(&hub).last().unwrap(), ActivityKind::BountyPosted);
    // owner may post too
    as_caller(&owner());
    hub.post_bounty("t".into(), h('b'), U128(1), T0_MS + 1, 1);
    assert_eq!(hub.get_bounties(None, None).len(), 2);
}

#[test]
#[should_panic(expected = "ERR_NOT_POSTER")]
fn worker_cannot_post() {
    let mut hub = setup();
    as_caller(&cheap());
    hub.post_bounty("t".into(), h('a'), U128(NEAR), T0_MS + HOUR_MS, 1);
}

#[test]
#[should_panic(expected = "ERR_TREASURY_INSUFFICIENT")]
fn post_zero_budget() {
    let mut hub = setup();
    post(&mut hub, 0, 1);
}

#[test]
#[should_panic(expected = "ERR_TREASURY_INSUFFICIENT")]
fn post_over_available() {
    let mut hub = setup();
    post(&mut hub, 11 * NEAR, 1);
}

#[test]
#[should_panic(expected = "ERR_SPEND_CAP")]
fn post_over_spend_cap() {
    let mut hub = setup();
    // fund to 30 NEAR available; cap is 20
    testing_env!(ctx(&stranger(), 20 * NEAR, T0_MS).build());
    hub.fund_treasury();
    post(&mut hub, 15 * NEAR, 1);
    post(&mut hub, 6 * NEAR, 1);
}

#[test]
#[should_panic(expected = "ERR_DEADLINE_PAST")]
fn post_deadline_past() {
    let mut hub = setup();
    as_caller(&coord());
    hub.post_bounty("t".into(), h('a'), U128(NEAR), T0_MS, 1);
}

#[test]
#[should_panic(expected = "ERR_BAD_HASH")]
fn post_bad_spec_hash() {
    let mut hub = setup();
    as_caller(&coord());
    hub.post_bounty("t".into(), "ABC".into(), U128(NEAR), T0_MS + 1, 1);
}

#[test]
#[should_panic(expected = "ERR_BAD_HASH")]
fn post_uppercase_hash_rejected() {
    let mut hub = setup();
    as_caller(&coord());
    hub.post_bounty("t".into(), h('A'), U128(NEAR), T0_MS + 1, 1);
}

#[test]
#[should_panic(expected = "ERR_TOO_LONG")]
fn post_title_too_long() {
    let mut hub = setup();
    as_caller(&coord());
    hub.post_bounty("x".repeat(121), h('a'), U128(NEAR), T0_MS + 1, 1);
}

#[test]
#[should_panic(expected = "ERR_BAD_TIER")]
fn post_bad_min_tier() {
    let mut hub = setup();
    post(&mut hub, NEAR, 0);
}

// ------------------------------------------------------------------ place_bid

#[test]
fn valid_bid_is_pending_and_opens_bidding() {
    let mut hub = setup();
    let b = post(&mut hub, NEAR, 1);
    let id = bid(&mut hub, &cheap(), b, NEAR / 2);
    let bids = hub.get_bids(b);
    assert_eq!(bids.len(), 1);
    assert_eq!(bids[0].id, id);
    assert_eq!(bids[0].status, BidStatus::Pending);
    assert_eq!(bids[0].tier, 1);
    assert_eq!(bids[0].round, 0);
    assert_eq!(bids[0].signature, "ed25519:sig");
    assert_eq!(
        bids[0].signed_payload,
        bid_payload(b, "hub.testnet", 600_000, NEAR / 2, 0, "cheap.testnet")
    );
    assert_eq!(status(&hub, b), BountyStatus::Bidding);
    assert_eq!(*kinds(&hub).last().unwrap(), ActivityKind::BidPlaced);
}

#[test]
fn bid_over_budget_rejected_not_panicking() {
    let mut hub = setup();
    let b = post(&mut hub, NEAR, 1);
    let id = bid(&mut hub, &cheap(), b, NEAR + 1);
    assert_eq!(
        bid_status(&hub, id),
        (BidStatus::Rejected, Some("price exceeds budget".into()))
    );
    assert_eq!(status(&hub, b), BountyStatus::Open);
    assert_eq!(hub.get_bids(b).len(), 1);
    let last = hub.get_activity_log(None, None).pop().unwrap();
    assert_eq!(last.kind, ActivityKind::BidRejected);
    assert_eq!(last.bid_id, Some(id));
}

#[test]
fn bid_tier_below_min_rejected() {
    let mut hub = setup();
    let b = post(&mut hub, NEAR, 3);
    let id = bid(&mut hub, &adaptive(), b, NEAR / 2);
    assert_eq!(
        bid_status(&hub, id).1.as_deref(),
        Some("tier below min_tier")
    );
    let ok = bid(&mut hub, &quality(), b, NEAR / 2);
    assert_eq!(bid_status(&hub, ok).0, BidStatus::Pending);
}

#[test]
fn bid_after_deadline_rejected() {
    let mut hub = setup();
    let b = post(&mut hub, NEAR, 1);
    as_caller_at(&cheap(), T0_MS + HOUR_MS + 1);
    let id = hub.place_bid(b, U128(1), 1, "s".into());
    assert_eq!(bid_status(&hub, id).1.as_deref(), Some("deadline passed"));
}

#[test]
fn duplicate_bid_same_round_rejected() {
    let mut hub = setup();
    let b = post(&mut hub, NEAR, 1);
    bid(&mut hub, &cheap(), b, NEAR / 2);
    let dup = bid(&mut hub, &cheap(), b, NEAR / 3);
    assert_eq!(
        bid_status(&hub, dup).1.as_deref(),
        Some("duplicate bid this round")
    );
}

#[test]
fn bid_on_closed_bounty_rejected() {
    let mut hub = setup();
    let (b, _) = to_verifying(&mut hub);
    let id = bid(&mut hub, &quality(), b, NEAR / 2);
    assert_eq!(bid_status(&hub, id).1.as_deref(), Some("bounty closed"));
}

#[test]
fn excluded_worker_rejected_after_failure() {
    let mut hub = setup();
    let (b, _) = to_verifying(&mut hub);
    as_caller(&verifier());
    let _ = hub.verify_bounty(b, false, 30, h('c'));
    let id = bid(&mut hub, &cheap(), b, NEAR / 4);
    assert_eq!(bid_status(&hub, id).1.as_deref(), Some("worker excluded"));
}

#[test]
#[should_panic(expected = "ERR_NOT_WORKER")]
fn non_worker_cannot_bid() {
    let mut hub = setup();
    let b = post(&mut hub, NEAR, 1);
    bid(&mut hub, &stranger(), b, 1);
}

#[test]
#[should_panic(expected = "ERR_NOT_WORKER")]
fn coordinator_cannot_bid() {
    let mut hub = setup();
    let b = post(&mut hub, NEAR, 1);
    bid(&mut hub, &coord(), b, 1);
}

#[test]
#[should_panic(expected = "ERR_NOT_WORKER")]
fn removed_worker_cannot_bid() {
    let mut hub = setup();
    let b = post(&mut hub, NEAR, 1);
    as_caller(&owner());
    hub.remove_worker(cheap());
    bid(&mut hub, &cheap(), b, 1);
}

#[test]
#[should_panic(expected = "ERR_BOUNTY_NOT_FOUND")]
fn bid_unknown_bounty() {
    let mut hub = setup();
    bid(&mut hub, &cheap(), 42, 1);
}

#[test]
#[should_panic(expected = "ERR_TOO_LONG")]
fn bid_signature_too_long() {
    let mut hub = setup();
    let b = post(&mut hub, NEAR, 1);
    as_caller(&cheap());
    hub.place_bid(b, U128(1), 1, "x".repeat(201));
}

#[test]
#[should_panic(expected = "ERR_TOO_MANY_BIDS")]
fn bid_cap_per_bounty() {
    let mut hub = setup();
    let b = post(&mut hub, NEAR, 1);
    for _ in 0..31 {
        bid(&mut hub, &quality(), b, NEAR / 2); // 1 pending + 29 duplicates, then panic
    }
}

// ------------------------------------------------------------------ reject / select / submit

#[test]
fn coordinator_rejects_forged_bid() {
    let mut hub = setup();
    let b = post(&mut hub, NEAR, 1);
    let id = bid(&mut hub, &cheap(), b, NEAR / 2);
    as_caller(&coord());
    hub.reject_bid(b, id, "invalid bid signature".into());
    assert_eq!(
        bid_status(&hub, id),
        (BidStatus::Rejected, Some("invalid bid signature".into()))
    );
    let last = hub.get_activity_log(None, None).pop().unwrap();
    assert_eq!(last.kind, ActivityKind::BidRejected);
    assert!(last.detail.contains("invalid bid signature"));
}

#[test]
#[should_panic(expected = "ERR_NOT_COORDINATOR")]
fn verifier_cannot_reject_bid() {
    let mut hub = setup();
    let b = post(&mut hub, NEAR, 1);
    let id = bid(&mut hub, &cheap(), b, NEAR / 2);
    as_caller(&verifier());
    hub.reject_bid(b, id, "x".into());
}

#[test]
#[should_panic(expected = "ERR_BID_NOT_SELECTABLE")]
fn cannot_reject_already_rejected() {
    let mut hub = setup();
    let b = post(&mut hub, NEAR, 1);
    let id = bid(&mut hub, &cheap(), b, NEAR * 2);
    as_caller(&coord());
    hub.reject_bid(b, id, "x".into());
}

#[test]
fn select_winner_marks_won_and_lost() {
    let mut hub = setup();
    let b = post(&mut hub, NEAR, 1);
    let c = bid(&mut hub, &cheap(), b, NEAR / 2);
    let q = bid(&mut hub, &quality(), b, NEAR * 9 / 10);
    as_caller(&coord());
    hub.select_winner(b, q);
    assert_eq!(bid_status(&hub, q).0, BidStatus::Won);
    assert_eq!(bid_status(&hub, c).0, BidStatus::Lost);
    let bounty = hub.get_bounty(b).unwrap();
    assert_eq!(bounty.status, BountyStatus::InProgress);
    assert_eq!(bounty.winner_bid_id, Some(q));
    assert_eq!(*kinds(&hub).last().unwrap(), ActivityKind::WinnerSelected);
}

#[test]
#[should_panic(expected = "ERR_NOT_COORDINATOR")]
fn verifier_cannot_select_winner() {
    let mut hub = setup();
    let b = post(&mut hub, NEAR, 1);
    let id = bid(&mut hub, &cheap(), b, NEAR / 2);
    as_caller(&verifier());
    hub.select_winner(b, id);
}

#[test]
#[should_panic(expected = "ERR_NOT_COORDINATOR")]
fn worker_cannot_select_winner() {
    let mut hub = setup();
    let b = post(&mut hub, NEAR, 1);
    let id = bid(&mut hub, &cheap(), b, NEAR / 2);
    as_caller(&cheap());
    hub.select_winner(b, id);
}

#[test]
#[should_panic(expected = "ERR_BAD_STATUS")]
fn select_on_open_bounty_without_bids() {
    let mut hub = setup();
    let b = post(&mut hub, NEAR, 1);
    as_caller(&coord());
    hub.select_winner(b, 0);
}

#[test]
#[should_panic(expected = "ERR_BID_NOT_SELECTABLE")]
fn cannot_select_rejected_bid() {
    let mut hub = setup();
    let b = post(&mut hub, NEAR, 1);
    bid(&mut hub, &cheap(), b, NEAR / 2);
    let over = bid(&mut hub, &quality(), b, NEAR * 2);
    as_caller(&coord());
    hub.select_winner(b, over);
}

#[test]
#[should_panic(expected = "ERR_BID_NOT_SELECTABLE")]
fn cannot_select_superseded_bid_from_old_round() {
    let mut hub = setup();
    let b = post(&mut hub, NEAR, 1);
    let c = bid(&mut hub, &cheap(), b, NEAR / 2);
    let q = bid(&mut hub, &quality(), b, NEAR * 9 / 10);
    as_caller(&coord());
    hub.select_winner(b, c);
    as_caller(&cheap());
    hub.submit_work(b, h('d'));
    as_caller(&verifier());
    let _ = hub.verify_bounty(b, false, 0, h('c'));
    // round 1: adaptive bids, quality's round-0 bid is Lost and stale
    bid(&mut hub, &adaptive(), b, NEAR / 2);
    as_caller(&coord());
    hub.select_winner(b, q);
}

#[test]
#[should_panic(expected = "ERR_BID_NOT_FOUND")]
fn select_unknown_bid() {
    let mut hub = setup();
    let b = post(&mut hub, NEAR, 1);
    bid(&mut hub, &cheap(), b, NEAR / 2);
    as_caller(&coord());
    hub.select_winner(b, 99);
}

#[test]
#[should_panic(expected = "ERR_NOT_WINNER")]
fn non_winner_cannot_submit() {
    let mut hub = setup();
    let b = post(&mut hub, NEAR, 1);
    let c = bid(&mut hub, &cheap(), b, NEAR / 2);
    bid(&mut hub, &quality(), b, NEAR / 2);
    as_caller(&coord());
    hub.select_winner(b, c);
    as_caller(&quality());
    hub.submit_work(b, h('d'));
}

#[test]
#[should_panic(expected = "ERR_BAD_STATUS")]
fn submit_before_selection() {
    let mut hub = setup();
    let b = post(&mut hub, NEAR, 1);
    bid(&mut hub, &cheap(), b, NEAR / 2);
    as_caller(&cheap());
    hub.submit_work(b, h('d'));
}

#[test]
#[should_panic(expected = "ERR_BAD_HASH")]
fn submit_bad_hash() {
    let mut hub = setup();
    let b = post(&mut hub, NEAR, 1);
    let c = bid(&mut hub, &cheap(), b, NEAR / 2);
    as_caller(&coord());
    hub.select_winner(b, c);
    as_caller(&cheap());
    hub.submit_work(b, "nope".into());
}

// ------------------------------------------------------------------ verify

#[test]
#[should_panic(expected = "ERR_NOT_VERIFIER")]
fn coordinator_cannot_verify() {
    let mut hub = setup();
    let (b, _) = to_verifying(&mut hub);
    as_caller(&coord());
    let _ = hub.verify_bounty(b, true, 90, h('c'));
}

#[test]
#[should_panic(expected = "ERR_NOT_VERIFIER")]
fn winner_cannot_self_verify() {
    let mut hub = setup();
    let (b, _) = to_verifying(&mut hub);
    as_caller(&cheap());
    let _ = hub.verify_bounty(b, true, 100, h('c'));
}

#[test]
#[should_panic(expected = "ERR_BAD_SCORE")]
fn verify_score_over_100() {
    let mut hub = setup();
    let (b, _) = to_verifying(&mut hub);
    as_caller(&verifier());
    let _ = hub.verify_bounty(b, true, 101, h('c'));
}

#[test]
#[should_panic(expected = "ERR_BAD_STATUS")]
fn verify_before_submission() {
    let mut hub = setup();
    let b = post(&mut hub, NEAR, 1);
    as_caller(&verifier());
    let _ = hub.verify_bounty(b, true, 90, h('c'));
}

#[test]
#[should_panic(expected = "ERR_BAD_HASH")]
fn verify_bad_hash() {
    let mut hub = setup();
    let (b, _) = to_verifying(&mut hub);
    as_caller(&verifier());
    let _ = hub.verify_bounty(b, true, 90, "x".into());
}

#[test]
fn verify_pass_pays_and_requests_mint() {
    let mut hub = setup();
    let (b, bid_id) = to_verifying(&mut hub);
    as_caller(&verifier());
    let r = hub.verify_bounty(b, true, 80, h('c'));
    assert!(matches!(r, PromiseOrValue::Promise(_)));
    drop(r); // promises are scheduled when dropped/returned

    let bounty = hub.get_bounty(b).unwrap();
    assert_eq!(bounty.status, BountyStatus::Completed);
    assert_eq!(bounty.score, Some(80));
    assert_eq!(bounty.check_results_hash, Some(h('c')));
    assert_eq!(bounty.deliverable_hash, Some(h('d')));
    assert_eq!(bid_status(&hub, bid_id).0, BidStatus::Paid);

    // treasury: 10 funded, 1 escrowed, 0.5 paid, 0.5 back to available
    let t = hub.get_treasury();
    assert_eq!(t.escrowed.0, 0);
    assert_eq!(t.paid_out.0, NEAR / 2);
    assert_eq!(t.available.0, 10 * NEAR - NEAR / 2);
    assert_eq!(t.committed_total.0, NEAR / 2);
    assert_eq!(t.committed_total.0, t.escrowed.0 + t.paid_out.0);

    // reputation: completed 1, total_score 80 -> 10 + 8 = 18
    let w = &hub.get_reputation(Some(cheap()))[0];
    assert_eq!(w.completed, 1);
    assert_eq!(w.total_score, 80);
    assert_eq!(w.earned_yocto.0, NEAR / 2);
    assert_eq!(w.reputation, 18);

    // mint formula: 500 milliNEAR * 80 / 100 * 1e16 = 4 HIVE
    let pm = hub.get_pending_mints();
    assert_eq!(pm.len(), 1);
    assert_eq!(pm[0].recipient, cheap());
    assert_eq!(pm[0].bid_units.0, 500);
    assert_eq!(pm[0].amount.0, 4 * 10u128.pow(18));

    // receipts: payout transfer to the worker + mint call on the token (+ callback)
    let receivers: Vec<String> = get_created_receipts()
        .iter()
        .map(|r| r.receiver_id.to_string())
        .collect();
    assert!(
        receivers.contains(&"cheap.testnet".to_string()),
        "{:?}",
        receivers
    );
    assert!(
        receivers.contains(&"hive.testnet".to_string()),
        "{:?}",
        receivers
    );
    assert!(
        receivers.contains(&"hub.testnet".to_string()),
        "{:?}",
        receivers
    );

    let k = kinds(&hub);
    assert!(k.contains(&ActivityKind::Payout));
    assert!(k.contains(&ActivityKind::VerificationPassed));
}

#[test]
fn mint_formula_examples() {
    assert_eq!(
        mint_amount(NEAR, 100, RATE),
        Some((1000, 10 * 10u128.pow(18)))
    );
    assert_eq!(
        mint_amount(NEAR / 2, 80, RATE),
        Some((500, 4 * 10u128.pow(18)))
    );
    assert_eq!(
        mint_amount(NEAR / 20, 90, RATE),
        Some((50, 45 * 10u128.pow(16)))
    );
    assert_eq!(
        mint_amount(999_999_999_999_999_999_999, 100, RATE),
        Some((0, 0))
    );
    assert_eq!(mint_amount(u128::MAX, 100, u128::MAX), None);
}

#[test]
#[should_panic(expected = "ERR_OVERFLOW")]
fn verify_pass_overflow_reverts() {
    let mut hub = setup();
    as_caller(&owner());
    hub.set_mint_rate(U128(u128::MAX));
    let (b, _) = to_verifying(&mut hub);
    as_caller(&verifier());
    let _ = hub.verify_bounty(b, true, 100, h('c'));
}

#[test]
fn verify_pass_with_zero_mint_returns_value() {
    let mut hub = setup();
    let b = post(&mut hub, NEAR, 1);
    let id = bid(&mut hub, &cheap(), b, 1_000); // < 1 milliNEAR => 0 units
    as_caller(&coord());
    hub.select_winner(b, id);
    as_caller(&cheap());
    hub.submit_work(b, h('d'));
    as_caller(&verifier());
    let r = hub.verify_bounty(b, true, 100, h('c'));
    assert!(matches!(r, PromiseOrValue::Value(())));
    assert!(hub.get_pending_mints().is_empty());
    assert_eq!(status(&hub, b), BountyStatus::Completed);
}

#[test]
fn verify_fail_reopens_then_rebid_passes() {
    let mut hub = setup();
    let b = post(&mut hub, NEAR, 1);
    let c = bid(&mut hub, &cheap(), b, NEAR / 2);
    let q = bid(&mut hub, &quality(), b, NEAR * 8 / 10);
    as_caller(&coord());
    hub.select_winner(b, c);
    as_caller(&cheap());
    hub.submit_work(b, h('d'));
    as_caller(&verifier());
    let r = hub.verify_bounty(b, false, 40, h('e'));
    assert!(matches!(r, PromiseOrValue::Value(())));

    let bounty = hub.get_bounty(b).unwrap();
    assert_eq!(bounty.status, BountyStatus::Open);
    assert_eq!(bounty.round, 1);
    assert_eq!(bounty.attempts, 1);
    assert_eq!(bounty.excluded, vec![cheap()]);
    assert_eq!(bounty.winner_bid_id, None);
    assert_eq!(bounty.check_results_hash, Some(h('e')));
    assert_eq!(bid_status(&hub, c).0, BidStatus::Failed);
    assert_eq!(bid_status(&hub, q).0, BidStatus::Lost);
    assert_eq!(hub.get_reputation(Some(cheap()))[0].failed, 1);
    // escrow untouched
    assert_eq!(hub.get_treasury().escrowed.0, NEAR);
    let k = kinds(&hub);
    assert!(k.contains(&ActivityKind::VerificationFailed));
    assert_eq!(*k.last().unwrap(), ActivityKind::BountyReopened);

    // round 1: quality rebids (new round => not a duplicate) and passes
    let q2 = bid(&mut hub, &quality(), b, NEAR * 7 / 10);
    assert_eq!(hub.bids.get(q2 as u32).unwrap().round, 1);
    assert_eq!(bid_status(&hub, q2).0, BidStatus::Pending);
    as_caller(&coord());
    hub.select_winner(b, q2);
    as_caller(&quality());
    hub.submit_work(b, h('f'));
    as_caller(&verifier());
    let _ = hub.verify_bounty(b, true, 95, h('1'));
    assert_eq!(status(&hub, b), BountyStatus::Completed);
    let t = hub.get_treasury();
    assert_eq!(t.paid_out.0, NEAR * 7 / 10);
    assert_eq!(t.available.0, 10 * NEAR - NEAR * 7 / 10);
    assert_eq!(hub.get_pending_mints()[0].amount.0, 700 * 95 * RATE / 100);
}

#[test]
fn two_failures_cancel_and_refund() {
    let mut hub = setup();
    let b = post(&mut hub, NEAR, 1);
    let c = bid(&mut hub, &cheap(), b, NEAR / 2);
    as_caller(&coord());
    hub.select_winner(b, c);
    as_caller(&cheap());
    hub.submit_work(b, h('d'));
    as_caller(&verifier());
    let _ = hub.verify_bounty(b, false, 10, h('e'));

    let a = bid(&mut hub, &adaptive(), b, NEAR / 2);
    let q = bid(&mut hub, &quality(), b, NEAR / 2);
    as_caller(&coord());
    hub.select_winner(b, a);
    as_caller(&adaptive());
    hub.submit_work(b, h('d'));
    as_caller(&verifier());
    let _ = hub.verify_bounty(b, true, 0, h('e')); // passed but score 0 => fail

    let bounty = hub.get_bounty(b).unwrap();
    assert_eq!(bounty.status, BountyStatus::Cancelled);
    assert_eq!(bounty.attempts, 2);
    assert_eq!(bounty.excluded, vec![cheap(), adaptive()]);
    assert_eq!(bid_status(&hub, q).0, BidStatus::Lost);
    let t = hub.get_treasury();
    assert_eq!(t.escrowed.0, 0);
    assert_eq!(t.available.0, 10 * NEAR);
    assert_eq!(t.refunded_total.0, NEAR);
    assert_eq!(t.committed_total.0, 0);
    let k = kinds(&hub);
    assert!(k.contains(&ActivityKind::TreasuryRefund));
    assert_eq!(*k.last().unwrap(), ActivityKind::BountyCancelled);
    // closed for further bids
    let late = bid(&mut hub, &quality(), b, 1);
    assert_eq!(bid_status(&hub, late).1.as_deref(), Some("bounty closed"));
}

// ------------------------------------------------------------------ mint callback

fn passed_with_pending_mint() -> (BountyHub, u64) {
    let mut hub = setup();
    let (b, _) = to_verifying(&mut hub);
    as_caller(&verifier());
    let _ = hub.verify_bounty(b, true, 80, h('c'));
    (hub, b)
}

#[test]
fn mint_callback_success_records_supply() {
    let (mut hub, b) = passed_with_pending_mint();
    let amount = 4 * 10u128.pow(18);
    as_callback(PromiseResult::Successful(vec![]));
    hub.on_mint_complete(b, cheap(), U128(amount), U128(500), 80, Ok(()));

    assert!(hub.get_pending_mints().is_empty());
    assert_eq!(hub.get_config().total_minted.0, amount);
    let s = hub.get_supply_history(None, None);
    assert_eq!(s.len(), 1);
    assert_eq!(s[0].bounty_id, b);
    assert_eq!(s[0].recipient, cheap());
    assert_eq!(s[0].bid_units.0, 500);
    assert_eq!(s[0].score, 80);
    assert_eq!(s[0].mint_rate.0, RATE);
    assert_eq!(s[0].amount.0, amount);
    assert_eq!(s[0].total_minted_after.0, amount);
    assert_eq!(hub.get_bounty(b).unwrap().hive_minted.0, amount);
    assert_eq!(hub.get_reputation(Some(cheap()))[0].hive_earned.0, amount);
    assert_eq!(*kinds(&hub).last().unwrap(), ActivityKind::Mint);
}

#[test]
fn mint_callback_failure_keeps_pending_then_retry() {
    let (mut hub, b) = passed_with_pending_mint();
    as_callback(PromiseResult::Failed);
    hub.on_mint_complete(
        b,
        cheap(),
        U128(4 * 10u128.pow(18)),
        U128(500),
        80,
        Err(PromiseError::Failed),
    );
    assert_eq!(hub.get_pending_mints().len(), 1);
    assert_eq!(hub.get_config().total_minted.0, 0);
    assert!(hub.get_supply_history(None, None).is_empty());
    assert_eq!(*kinds(&hub).last().unwrap(), ActivityKind::MintFailed);

    as_caller(&owner());
    let _ = hub.retry_mint(b);
    as_callback(PromiseResult::Successful(vec![]));
    hub.on_mint_complete(b, cheap(), U128(4 * 10u128.pow(18)), U128(500), 80, Ok(()));
    assert!(hub.get_pending_mints().is_empty());
    assert_eq!(hub.get_supply_history(None, None).len(), 1);
}

#[test]
#[should_panic(expected = "ERR_BAD_STATUS")]
fn retry_mint_refused_while_in_flight() {
    let (mut hub, b) = passed_with_pending_mint();
    as_caller(&owner());
    let _ = hub.retry_mint(b);
}

#[test]
#[should_panic(expected = "ERR_NO_PENDING_MINT")]
fn retry_mint_without_pending() {
    let mut hub = setup();
    as_caller(&owner());
    let _ = hub.retry_mint(0);
}

#[test]
#[should_panic(expected = "ERR_NOT_OWNER")]
fn retry_mint_owner_only() {
    let (mut hub, b) = passed_with_pending_mint();
    as_caller(&coord());
    let _ = hub.retry_mint(b);
}

// `#[private]` on `on_mint_complete` is enforced by the generated wasm entry point, not by
// direct Rust calls, so it cannot be unit-tested here (covered by the testnet self-check).

#[test]
fn duplicate_callback_does_not_double_count() {
    let (mut hub, b) = passed_with_pending_mint();
    as_callback(PromiseResult::Successful(vec![]));
    hub.on_mint_complete(b, cheap(), U128(7), U128(500), 80, Ok(()));
    as_callback(PromiseResult::Successful(vec![]));
    hub.on_mint_complete(b, cheap(), U128(7), U128(500), 80, Ok(()));
    assert_eq!(hub.get_config().total_minted.0, 7);
    assert_eq!(hub.get_supply_history(None, None).len(), 1);
}

// ------------------------------------------------------------------ cancel

#[test]
fn coordinator_cancels_and_refunds() {
    let mut hub = setup();
    let b = post(&mut hub, NEAR, 1);
    let c = bid(&mut hub, &cheap(), b, NEAR / 2);
    as_caller(&coord());
    hub.select_winner(b, c);
    hub.cancel_bounty(b);
    assert_eq!(status(&hub, b), BountyStatus::Cancelled);
    assert_eq!(bid_status(&hub, c).0, BidStatus::Superseded);
    let t = hub.get_treasury();
    assert_eq!(t.available.0, 10 * NEAR);
    assert_eq!(t.escrowed.0, 0);
    assert_eq!(t.refunded_total.0, NEAR);
    assert_eq!(*kinds(&hub).last().unwrap(), ActivityKind::TreasuryRefund);
}

#[test]
#[should_panic(expected = "ERR_BAD_STATUS")]
fn cannot_cancel_verifying() {
    let mut hub = setup();
    let (b, _) = to_verifying(&mut hub);
    as_caller(&owner());
    hub.cancel_bounty(b);
}

#[test]
#[should_panic(expected = "ERR_NOT_COORDINATOR")]
fn worker_cannot_cancel() {
    let mut hub = setup();
    let b = post(&mut hub, NEAR, 1);
    as_caller(&cheap());
    hub.cancel_bounty(b);
}

// ------------------------------------------------------------------ views / golden vector

#[test]
fn views_paginate() {
    let mut hub = setup();
    for _ in 0..5 {
        post(&mut hub, NEAR / 10, 1);
    }
    assert_eq!(hub.get_bounties(None, None).len(), 5);
    let p = hub.get_bounties(Some(3), Some(10));
    assert_eq!(p.iter().map(|b| b.id).collect::<Vec<_>>(), vec![3, 4]);
    assert_eq!(hub.get_bounties(Some(1), Some(1))[0].id, 1);
    assert!(hub.get_bounty(99).is_none());
    assert!(hub.get_bids(99).is_empty());
    let log = hub.get_activity_log(Some(2), Some(2));
    assert_eq!(log.len(), 2);
    assert_eq!(log[0].id, 2);
    // JSON shape: enums as variant names, amounts as strings
    let json = serde_json::to_value(hub.get_bounty(0).unwrap()).unwrap();
    assert_eq!(json["status"], "Open");
    assert_eq!(json["budget_yocto"], (NEAR / 10).to_string());
    assert_eq!(json["deadline_ms"], T0_MS + HOUR_MS);
}

#[test]
fn golden_bid_payload_vector() {
    let raw = include_str!("../../../tests/vectors/bid_payload.json");
    let v: serde_json::Value = serde_json::from_str(raw).unwrap();
    let i = &v["input"];
    let payload = bid_payload(
        i["bounty_id"].as_u64().unwrap(),
        i["contract"].as_str().unwrap(),
        i["eta_ms"].as_u64().unwrap(),
        i["price_yocto"].as_str().unwrap().parse().unwrap(),
        i["round"].as_u64().unwrap() as u32,
        i["worker"].as_str().unwrap(),
    );
    assert_eq!(payload, v["payload"].as_str().unwrap());
}
