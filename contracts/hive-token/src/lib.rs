//! HIVE — NEP-141 community token of HiveFund.
//!
//! The ONLY way to create HIVE is `mint`, callable only by the bounty-hub contract (`minter`),
//! which mints from verified bounty outcomes. There is no admin mint: the owner can only hand
//! the minter role over (`set_minter`), e.g. to a new hub version.
//!
//! TODO(decay, cut #2): lazy inactivity decay — `last_active_ms: LookupMap<AccountId, u64>`
//! updated on mint/transfer/receive, `poke_decay(account_id)` burning
//! `balance * min(days_inactive - 7, 50)%` with an `FtBurn` event, and a
//! `get_decay_preview(account_id)` view. Not built in v0.1 (see docs/PLAN.md §2 hive-token).

use near_contract_standards::fungible_token::events::FtMint;
use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::collections::LazyOption;
use near_sdk::json_types::U128;
use near_sdk::{
    env, log, near, AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue,
};

pub const ERR_NOT_MINTER: &str = "ERR_NOT_MINTER";
pub const ERR_NOT_OWNER: &str = "ERR_NOT_OWNER";
pub const ERR_ZERO_AMOUNT: &str = "ERR_ZERO_AMOUNT";

const HIVE_ICON: &str = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Cpolygon points='50,5 90,27 90,73 50,95 10,73 10,27' fill='%23f5b301' stroke='%23222' stroke-width='6'/%3E%3Ctext x='50' y='62' font-size='34' text-anchor='middle' font-family='Arial' font-weight='bold' fill='%23222'%3EH%3C/text%3E%3C/svg%3E";

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    FungibleToken,
    Metadata,
}

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct HiveToken {
    token: FungibleToken,
    metadata: LazyOption<FungibleTokenMetadata>,
    owner: AccountId,
    minter: AccountId,
}

#[near]
impl HiveToken {
    #[init]
    pub fn new(owner_id: AccountId, minter_id: AccountId) -> Self {
        let metadata = FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "HiveFund Token".to_string(),
            symbol: "HIVE".to_string(),
            icon: Some(HIVE_ICON.to_string()),
            reference: None,
            reference_hash: None,
            decimals: 18,
        };
        metadata.assert_valid();
        Self {
            token: FungibleToken::new(StorageKey::FungibleToken),
            metadata: LazyOption::new(StorageKey::Metadata, Some(&metadata)),
            owner: owner_id,
            minter: minter_id,
        }
    }

    /// Minter-only (the bounty-hub). Registers the receiver if needed — the token account
    /// pays the storage from its own balance (only the hub can trigger it, so no sybil drain).
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        if env::predecessor_account_id() != self.minter {
            env::panic_str(ERR_NOT_MINTER);
        }
        if amount.0 == 0 {
            env::panic_str(ERR_ZERO_AMOUNT);
        }
        if !self.token.accounts.contains_key(&account_id) {
            self.token.internal_register_account(&account_id);
        }
        self.token.internal_deposit(&account_id, amount.0);
        FtMint {
            owner_id: &account_id,
            amount,
            memo: Some("bounty reward"),
        }
        .emit();
    }

    /// Owner hands the minter role to another account (hub upgrade). Not a mint path.
    pub fn set_minter(&mut self, minter_id: AccountId) {
        if env::predecessor_account_id() != self.owner {
            env::panic_str(ERR_NOT_OWNER);
        }
        log!("minter changed from {} to {}", self.minter, minter_id);
        self.minter = minter_id;
    }

    pub fn get_minter(&self) -> AccountId {
        self.minter.clone()
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner.clone()
    }
}

#[near]
impl FungibleTokenCore for HiveToken {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for HiveToken {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let (used_amount, burned_amount) =
            self.token
                .internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        if burned_amount > 0 {
            log!("Account @{} burned {}", sender_id, burned_amount);
        }
        used_amount.into()
    }
}

#[near]
impl StorageManagement for HiveToken {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        if let Some((account_id, balance)) = self.token.internal_storage_unregister(force) {
            log!("Closed @{} with {}", account_id, balance);
            true
        } else {
            false
        }
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for HiveToken {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.get().unwrap()
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, get_logs, VMContextBuilder};
    use near_sdk::testing_env;

    fn ctx(pred: AccountId) -> VMContextBuilder {
        let mut b = VMContextBuilder::new();
        b.current_account_id("hive.testnet".parse().unwrap())
            .predecessor_account_id(pred.clone())
            .signer_account_id(pred)
            .account_balance(NearToken::from_near(2));
        b
    }

    fn hub() -> AccountId {
        "hub.testnet".parse().unwrap()
    }

    fn setup() -> HiveToken {
        testing_env!(ctx(accounts(0)).build());
        HiveToken::new(accounts(0), hub())
    }

    #[test]
    fn metadata_and_init() {
        let t = setup();
        let m = t.ft_metadata();
        assert_eq!(m.symbol, "HIVE");
        assert_eq!(m.decimals, 18);
        assert_eq!(m.spec, FT_METADATA_SPEC);
        assert_eq!(t.get_minter(), hub());
        assert_eq!(t.get_owner(), accounts(0));
        assert_eq!(t.ft_total_supply().0, 0);
    }

    #[test]
    fn hub_mints_auto_registers_and_emits_event() {
        let mut t = setup();
        testing_env!(ctx(hub()).build());
        t.mint(accounts(1), U128(4_000_000_000_000_000_000));
        assert_eq!(t.ft_balance_of(accounts(1)).0, 4_000_000_000_000_000_000);
        assert_eq!(t.ft_total_supply().0, 4_000_000_000_000_000_000);
        let logs = get_logs();
        assert!(logs
            .iter()
            .any(|l| l.contains("\"event\":\"ft_mint\"") && l.contains("bounty reward")));
        // second mint to an already-registered account
        t.mint(accounts(1), U128(1));
        assert_eq!(t.ft_balance_of(accounts(1)).0, 4_000_000_000_000_000_001);
        assert!(t.storage_balance_of(accounts(1)).is_some());
    }

    #[test]
    #[should_panic(expected = "ERR_NOT_MINTER")]
    fn owner_cannot_mint() {
        let mut t = setup();
        testing_env!(ctx(accounts(0)).build());
        t.mint(accounts(0), U128(1));
    }

    #[test]
    #[should_panic(expected = "ERR_NOT_MINTER")]
    fn stranger_cannot_mint() {
        let mut t = setup();
        testing_env!(ctx(accounts(3)).build());
        t.mint(accounts(3), U128(1));
    }

    #[test]
    #[should_panic(expected = "ERR_ZERO_AMOUNT")]
    fn zero_mint_rejected() {
        let mut t = setup();
        testing_env!(ctx(hub()).build());
        t.mint(accounts(1), U128(0));
    }

    #[test]
    fn owner_hands_over_minter() {
        let mut t = setup();
        testing_env!(ctx(accounts(0)).build());
        t.set_minter(accounts(4));
        assert_eq!(t.get_minter(), accounts(4));
        testing_env!(ctx(accounts(4)).build());
        t.mint(accounts(1), U128(5));
        assert_eq!(t.ft_balance_of(accounts(1)).0, 5);
    }

    #[test]
    #[should_panic(expected = "ERR_NOT_MINTER")]
    fn old_minter_loses_rights() {
        let mut t = setup();
        testing_env!(ctx(accounts(0)).build());
        t.set_minter(accounts(4));
        testing_env!(ctx(hub()).build());
        t.mint(accounts(1), U128(5));
    }

    #[test]
    #[should_panic(expected = "ERR_NOT_OWNER")]
    fn non_owner_cannot_set_minter() {
        let mut t = setup();
        testing_env!(ctx(hub()).build());
        t.set_minter(hub());
    }

    #[test]
    fn holders_can_transfer() {
        let mut t = setup();
        testing_env!(ctx(hub()).build());
        t.mint(accounts(1), U128(100));
        t.mint(accounts(2), U128(1));
        let mut c = ctx(accounts(1));
        c.attached_deposit(NearToken::from_yoctonear(1));
        testing_env!(c.build());
        t.ft_transfer(accounts(2), U128(40), None);
        assert_eq!(t.ft_balance_of(accounts(1)).0, 60);
        assert_eq!(t.ft_balance_of(accounts(2)).0, 41);
        assert_eq!(t.ft_total_supply().0, 101);
    }
}
