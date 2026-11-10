# HiveFund — NEAR Rust contract research (bounty-hub + hive-token)

Researched 2026-11-10 against current docs/crates. Every snippet is either copied from the cited source or marked **[HiveFund sketch]** (adapted from a cited pattern; not compiled).

## 0. Versions (as of 2026-11-10)

| Crate / tool | Latest | Source |
|---|---|---|
| `near-sdk` | **5.30.1** (2026-11-05) | https://crates.io/crates/near-sdk |
| `near-contract-standards` | **5.30.1** (lockstep with sdk; it depends on `near-sdk = "~5.30.1"` with `legacy` feature) | https://crates.io/crates/near-contract-standards , https://github.com/near/near-sdk-rs/blob/master/near-contract-standards/Cargo.toml |
| `cargo-near` (CLI) | **0.23.0** (2026-11-06) | https://crates.io/crates/cargo-near |
| `near-sandbox` | **0.4.0** (2026-10-26) | https://crates.io/crates/near-sandbox |
| `near-api` | **0.8.7** (2026-10-28) | https://crates.io/crates/near-api |
| `near-workspaces` | 0.24.0 (still published; docs no longer use it) | https://crates.io/crates/near-workspaces |
| `near-cli-rs` (binary `near`) | 0.31.1 (main branch Cargo.toml) | https://github.com/near/near-cli-rs |
| `near-token` (NearToken) | 0.3.6 | https://docs.rs/near-token |

- near-sdk **MSRV = Rust 1.95** (https://github.com/near/near-sdk-rs/blob/master/README.md). The FT example pins `rust-toolchain.toml` channel `1.97.1` + `targets = ["wasm32-unknown-unknown"]`.
- near-sdk 5.30.0 changelog notable: "[breaking] back the unit-testing mock with nearcore's host functions" (#1629); 5.26.1 "update gas defaults to 1 PGas"; 5.25 added `Self::ext_self()`; 5.24 added `env::promise_result_checked()` and `#[callback_result(max_bytes = N)]`; 5.18 made `Promise` `#[must_use]` (see pitfalls). https://github.com/near/near-sdk-rs/blob/master/CHANGELOG.md

---

## 1. Project setup, macros, types

### Cargo.toml (cargo-near project)

Official template (`cargo near new`) — https://github.com/near/cargo-near-new-project-template/blob/main/Cargo.toml (template still says `near-sdk = "5.24"` + `near-workspaces 0.22`; bump versions):

```toml
[package]
name = "bounty-hub"
version = "0.1.0"
edition = "2024"
resolver = "3"
repository = "https://github.com/<you>/hivefund"   # used by NEP-330 contract_source_metadata

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
near-sdk = "5.30.1"
# hive-token only:
# near-contract-standards = "5.30.1"

[dev-dependencies]
near-sdk = { version = "5.30.1", features = ["unit-testing"] }
# integration tests (current docs pattern, from near-examples/FT Cargo.toml):
near-sandbox = "0.4"
near-api = "0.8.7"
cargo-near-build = "0.11.5"     # FT example version; check crates.io before pinning
testresult = "0.4.1"
anyhow = "1.0"
tokio = { version = "1", features = ["full"] }
serde_json = "1"

[profile.release]
codegen-units = 1
opt-level = "z"
lto = true
debug = false
panic = "abort"
overflow-checks = true    # security checklist requires this
```
The near-examples/FT Cargo.toml (https://github.com/near-examples/FT/blob/master/Cargo.toml) uses exactly: `near-sdk = "5.29.1"`, `near-contract-standards = "5.29.1"`, dev-deps `near-sandbox = "0.3"`, `near-api = "0.8.6"`, `testresult = "0.4.1"`, `anyhow`, `tokio = {version="1.41.0", features=["full"]}`, `cargo-near-build = "0.11.5"`.

Features of near-sdk (https://github.com/near/near-sdk-rs/blob/master/near-sdk/Cargo.toml): default `wee_alloc`; `unit-testing` (testing_env!, VMContextBuilder, mock); `legacy` (old `near_sdk::collections`, pulled in automatically by near-contract-standards); `abi`; `unstable`; `deterministic-account-ids`; `universal-accounts` (needs protocol 88+, don't enable). The `[package.metadata.near.reproducible_build]` block in the template is only needed for `reproducible-wasm` builds.

Workspace tip: with two contracts in a cargo workspace, put `[profile.release]` in the **workspace root** Cargo.toml (profiles in member crates are ignored by cargo).

### Contract skeleton

`#[near(contract_state)]` on the single state struct, `#[near]` on impl blocks — https://docs.near.org/smart-contracts/anatomy/anatomy.md . `PanicOnDefault` + `#[init]` pattern from https://github.com/near-examples/FT/blob/master/src/lib.rs :

```rust
use near_sdk::borsh::BorshSerialize;
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise};

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct Contract {
    owner: AccountId,
    records: LookupMap<AccountId, String>,
}

#[derive(BorshSerialize, BorshStorageKey)]
#[borsh(crate = "near_sdk::borsh")]
enum StorageKey {
    Records,
    Nested(AccountId),   // data-carrying variant => unique prefix per inner collection
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId) -> Self {
        Self { owner, records: LookupMap::new(StorageKey::Records) }
    }

    #[payable]
    pub fn fund(&mut self) { let amt: NearToken = env::attached_deposit(); /* ... */ }

    #[private]                 // only callable by env::current_account_id()
    pub fn on_something(&mut self) {}
}

impl Contract { // no #[near] => NOT exported
    fn assert_owner(&self) { require!(env::predecessor_account_id() == self.owner, "Only owner"); }
}
```

Macro sub-attributes (https://docs.rs/near-sdk/latest/near_sdk/attr.near.html):
- `#[near(contract_state)]` — exactly one per crate; custom key: `#[near(contract_state(key = b"CUSTOM"))]`.
- `#[near(serializers = [json, borsh])]` on structs/enums (borsh is the default; add `json` for args/returns). Borsh options: `#[near(serializers = [borsh(use_discriminant = true)])]`.
- `#[init]` panics if state exists; `#[init(ignore_state)]` for migrations.
- `#[payable]` — without it any attached deposit makes the call panic.
- `#[private]` — predecessor must equal current account.
- `#[handle_result]` — return `Result<T, E>` where `E: FunctionError` (Err => panic with message).
- `#[result_serializer(borsh)]`, `#[callback_result]`, `#[callback_unwrap]`, `#[callback_vec]`, `#[near(event_json(standard = "nepXXX"))]` + `#[event_version("1.0.0")]` on variants, `contract_metadata(...)`.
- `PanicOnDefault` makes `Default` panic with `"The contract is not initialized"` (asserted in FT tests).
- Methods with `&self` are view; `&mut self` are change. Only `pub` fns (and trait impls) inside `#[near]` blocks are exported (https://docs.near.org/smart-contracts/anatomy/functions.md).

### Serializable types

```rust
#[near(serializers = [json])]
pub struct Bid {
    pub bidder: AccountId,
    pub amount: U128,
}
```
(https://docs.near.org/smart-contracts/anatomy/functions.md). For anything stored in state AND returned in JSON use `#[near(serializers = [json, borsh])]` (https://docs.near.org/smart-contracts/anatomy/serialization.md). Enums used in JSON (e.g. `Tier`, `BountyStatus`) need the same attribute.

- `near_sdk::json_types::{U64, I64, U128, I128}` — serialize as strings in JSON, use them at the interface; `.0` / `.into()` to get native ints. `U128(x)`, `let n: u128 = x.into();`
- `AccountId` validates on deserialize — prefer over `String`. Parse: `"alice.testnet".parse::<AccountId>().unwrap()`.

### NearToken API (near-token 0.3.6, https://docs.rs/near-token/latest/near_token/struct.NearToken.html)
- `const fn from_near(u128)`, `from_millinear`, `from_micronear`, `from_yoctonear`; `NearToken::ZERO`, `MAX`.
- `as_near()` (truncates), `as_millinear()`, `as_yoctonear() -> u128`, `is_zero()`, `exact_amount_display()`.
- `checked_add(NearToken) / checked_sub(NearToken) -> Option<Self>`, `checked_mul(u128) / checked_div(u128)`, `saturating_*` variants. No `+`/`-` operators on raw u128 — use checked/saturating.
- `NearToken` serializes to JSON as a yocto string, so it can be used directly in args/returns.

### env (near-sdk 5.30.1, https://docs.rs/near-sdk/latest/near_sdk/env/index.html , https://docs.near.org/smart-contracts/anatomy/environment.md)
- `env::predecessor_account_id() -> AccountId` (immediate caller — use for auth), `env::signer_account_id()` (tx signer), `env::current_account_id()`.
- `env::attached_deposit() -> NearToken`, `env::account_balance() -> NearToken` (includes attached deposit), `env::storage_usage() -> u64` bytes, `env::storage_byte_cost() -> NearToken`.
- `env::block_timestamp()` (ns, u64), `env::block_timestamp_ms()` (ms, u64), `env::block_height()`, `env::epoch_height()`.
- `env::prepaid_gas()`, `env::used_gas()`; `env::random_seed()` / `random_seed_array()` (block-producer influenceable).
- `env::sha256`, `sha256_array`, `keccak256(_array)`, `env::log_str`, `env::panic_str`, `env::state_exists()`.
- **ed25519_verify** (https://docs.rs/near-sdk/latest/near_sdk/env/fn.ed25519_verify.html):
  ```rust
  pub fn ed25519_verify(signature: &[u8; 64], message: impl AsRef<[u8]>, public_key: &[u8; 32]) -> bool
  ```
  Takes raw 32-byte key (not `near_sdk::PublicKey` which has a curve-type prefix byte: `pk.as_bytes()[1..]`). Pass sig/pk in JSON as base64/hex `String` or `Base64VecU8` and convert with `try_into()` to fixed arrays; include a nonce/bounty id in the message to prevent replay.

### Collections (`near_sdk::store`) — https://docs.near.org/smart-contracts/anatomy/collections.md
- `LookupMap<K,V>` (no iteration, cheapest), `IterableMap<K,V>` (iterate/paginate via `.iter().skip(from).take(limit)`), `Vector<T>`, `LookupSet`, `IterableSet`, `LazyOption`.
- API (store): `insert(k, v)` takes owned values; `get(&k) -> Option<&V>`; `get_mut(&k)`; `remove(&k)`; `contains_key`; `len()`.
- `near_sdk::collections::*` is the old API behind the `legacy` feature (insert takes `&k, &v`, get returns owned). near-contract-standards' `FungibleToken` uses legacy `collections::LookupMap` internally.
- Each collection needs a unique prefix (`BorshStorageKey` enum). Nested: `Vector::new(StorageKey::Nested(key.clone()))`; `clear()` inner before removing outer.
- store collections cache and flush on `Drop` (automatic for fields of contract state); `IterableMap::remove` swaps last element (O(1) but touches 2 entries).
- Keep plain `Vec`/`HashMap` fields tiny (whole struct is deserialized each call; docs say ~100 entries max).

---

## 2. Cross-contract calls, gas, callbacks, transfers

Source: https://docs.near.org/smart-contracts/anatomy/crosscontract.md , https://docs.rs/near-sdk/latest/near_sdk/ (lib.rs docs), https://github.com/near/near-sdk-rs/blob/master/near-sdk/src/promise.rs

### High-level (`#[ext_contract]`)
```rust
#[ext_contract(external_trait)]
trait Contract {
    fn function_name(&self, param1: T, param2: T) -> T;
}

const CALL_GAS: Gas = Gas::from_tgas(10);
const CALLBACK_GAS: Gas = Gas::from_tgas(5);

external_trait::ext("external_address")
    .with_static_gas(CALL_GAS)
    .function_name(arguments)
    .then(
        Self::ext(env::current_account_id())   // or Self::ext_self() (sdk >= 5.25)
            .with_static_gas(CALLBACK_GAS)
            .callback_name(arguments)
    );
```
Builder methods: `.with_attached_deposit(NearToken)`, `.with_static_gas(Gas)`, `.with_unused_gas_weight(u64)` (docs: use `0` for gas-sensitive promises; default weight 1 shares leftover gas).

### Callback
```rust
#[private] // Public - but only callable by env::current_account_id()
pub fn hl_query_greeting_callback(
    &self,
    #[callback_result] call_result: Result<String, PromiseError>,
) -> String {
    if call_result.is_err() {
        log!("There was an error contacting Hello NEAR");
        return "".to_string();
    }
    call_result.unwrap()
}
```
- `PromiseError` = `Failed | TooLong(usize)`. For `()` return use `Result<(), PromiseError>`.
- `#[callback_result]` returns `Err` only when the callee **failed**; malformed success data still panics. Bounded variant: `#[callback_result(max_bytes = N)]` or manual `env::promise_result_checked(0, MAX_LEN)` (sdk >= 5.24) — https://docs.near.org/smart-contracts/security/cross-contract-calls/callback-failures.md

### Low-level
```rust
let promise = Promise::new("external_address").function_call(
    "function_name".to_owned(),
    arguments,      // Vec<u8>, e.g. json!({..}).to_string().into_bytes()
    DEPOSIT,        // NearToken
    GAS             // Gas
);
```
Current signature: `fn function_call(self, function_name: impl Into<String>, arguments: impl Into<Vec<u8>>, amount: NearToken, gas: Gas) -> Self`. (Note: some docs pages still show old `Gas(5_000_000_000_000)` / u128 deposits — those are pre-5.x; use `Gas::from_tgas` and `NearToken`.)

### Transfers
```rust
Promise::new(to).transfer(amount);   // amount: NearToken
```
(https://docs.near.org/smart-contracts/anatomy/actions.md). Docs: only fails if receiver account doesn't exist; costs ~0.45 TGas for named accounts, ~8.35 TGas for 64-hex implicit accounts. Failed transfer => NEAR returns to the contract (no automatic notice unless you `.then()` a callback).

Other actions: `Promise::new(id).create_account().transfer(..).add_full_access_key(pk)`, `.deploy_contract(code)`, `.add_access_key_allowance(pk, Allowance, receiver_id, method_names)`, `.refund_to(account)` (sdk 5.24+), `.then_concurrent(...)`.

### `Promise` is `#[must_use]` (sdk >= 5.18)
`#[must_use = "return or detach explicitly via .detach()"]`. Either **return** the Promise from the method (callers see final result) or call `.detach()` for fire-and-forget. near-contract-standards itself now writes `Promise::new(env::predecessor_account_id()).transfer(refund).detach();`. Not doing either => compiler warning (and with `#![deny(warnings)]`, an error). Dropped promises are still scheduled.

### [HiveFund sketch] bounty-hub → hive-token mint with rollback
Patterns combined from crosscontract.md, refunds.md and callback-failures.md:
```rust
use near_sdk::{ext_contract, env, near, Gas, NearToken, Promise, PromiseError, json_types::U128, AccountId, log};

#[ext_contract(ext_hive_token)]
trait HiveToken {
    fn mint(&mut self, account_id: AccountId, amount: U128);
}

const MINT_GAS: Gas = Gas::from_tgas(15);
const ON_MINT_GAS: Gas = Gas::from_tgas(10);
const FT_STORAGE_DEPOSIT: NearToken = NearToken::from_micronear(1_250); // 0.00125 NEAR, see §3

#[near]
impl BountyHub {
    pub fn approve_submission(&mut self, bounty_id: u64) -> Promise {
        // 1. auth + validate (panic here is fine: nothing changed yet)
        // 2. DEBIT FIRST: mark bounty Paid, subtract reward from treasury accounting
        let (winner, reward, rep) = self.internal_settle(bounty_id);
        // 3. NEAR payout (only fails if winner account doesn't exist)
        Promise::new(winner.clone()).transfer(reward)
            .and(
                ext_hive_token::ext(self.token_id.clone())
                    .with_attached_deposit(FT_STORAGE_DEPOSIT)
                    .with_static_gas(MINT_GAS)
                    .mint(winner.clone(), U128(rep)),
            )
            .then(Self::ext(env::current_account_id())
                .with_static_gas(ON_MINT_GAS)
                .on_payout(bounty_id, winner, reward, U128(rep)))
    }

    #[private]
    pub fn on_payout(&mut self, bounty_id: u64, winner: AccountId, reward: NearToken, rep: U128) {
        // with .and(), check each result by index; don't panic, settle instead
        for i in 0..env::promise_results_count() {
            if env::promise_result_checked(i, 64).is_err() {
                log!("payout leg {} failed for bounty {}", i, bounty_id);
                // i == 0: NEAR transfer failed -> funds are back in contract: re-credit treasury / mark PayoutFailed
                // i == 1: mint failed -> record pending rep mint for retry
            }
        }
    }
}
```
Simpler alternative: send the NEAR transfer detached, and only `.then()` the mint (one result → `#[callback_result] r: Result<(), PromiseError>`).

---

## 3. NEP-141 with near-contract-standards (hive-token)

Source: https://github.com/near-examples/FT/blob/master/src/lib.rs (uses near-sdk/near-contract-standards 5.29.1), standards source https://github.com/near/near-sdk-rs/tree/master/near-contract-standards/src/fungible_token

### Verified FT example structure (copy this)
```rust
use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::borsh::BorshSerialize;
use near_sdk::collections::LazyOption;
use near_sdk::json_types::U128;
use near_sdk::{
    env, log, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue,
};

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct Contract {
    token: FungibleToken,
    metadata: LazyOption<FungibleTokenMetadata>,
}

#[derive(BorshSerialize, BorshStorageKey)]
#[borsh(crate = "near_sdk::borsh")]
enum StorageKey {
    FungibleToken,
    Metadata,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner_id: AccountId, total_supply: U128, metadata: FungibleTokenMetadata) -> Self {
        require!(!env::state_exists(), "Already initialized");
        metadata.assert_valid();
        let mut this = Self {
            token: FungibleToken::new(StorageKey::FungibleToken),
            metadata: LazyOption::new(StorageKey::Metadata, Some(&metadata)),
        };
        this.token.internal_register_account(&owner_id);
        this.token.internal_deposit(&owner_id, total_supply.into());

        near_contract_standards::fungible_token::events::FtMint {
            owner_id: &owner_id,
            amount: total_supply,
            memo: Some("new tokens are minted"),
        }
        .emit();

        this
    }
}

#[near]
impl FungibleTokenCore for Contract {
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

    fn ft_total_supply(&self) -> U128 { self.token.ft_total_supply() }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 { self.token.ft_balance_of(account_id) }
}

#[near]
impl FungibleTokenResolver for Contract {
    #[private]
    fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        let (used_amount, burned_amount) =
            self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        if burned_amount > 0 {
            log!("Account @{} burned {}", sender_id, burned_amount);
        }
        used_amount.into()
    }
}

#[near]
impl StorageManagement for Contract {
    #[payable]
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }
    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }
    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        #[allow(unused_variables)]
        if let Some((account_id, balance)) = self.token.internal_storage_unregister(force) {
            log!("Closed @{} with {}", account_id, balance);
            true
        } else {
            false
        }
    }
    fn storage_balance_bounds(&self) -> StorageBalanceBounds { self.token.storage_balance_bounds() }
    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Contract {
    fn ft_metadata(&self) -> FungibleTokenMetadata { self.metadata.get().unwrap() }
}
```
Metadata in tests: `FungibleTokenMetadata { spec: FT_METADATA_SPEC.to_string(), name, symbol, icon: Some(..), reference: None, reference_hash: None, decimals: 24 }` (`use near_contract_standards::fungible_token::metadata::FT_METADATA_SPEC;`).

### FungibleToken internals (near-contract-standards master, core_impl.rs / storage_impl.rs)
- `pub struct FungibleToken { pub accounts: LookupMap<AccountId, Balance>, pub total_supply: Balance, pub account_storage_usage: StorageUsage }` — `accounts` is the **legacy** `collections::LookupMap` (`insert(&k,&v)`, `get(&k) -> Option<u128>`), and it's `pub`, so `self.token.accounts.contains_key(&id)` works.
- `internal_register_account(&id)` panics `"The account is already registered"` if present.
- `internal_deposit(&id, u128)` panics `"The account {} is not registered"` if not registered; checked add on balance and total_supply. `internal_withdraw` = burn primitive (panics `"The account doesn't have enough balance"`).
- `internal_transfer` emits `FtTransfer`. `internal_deposit` does **not** emit `FtMint` — you must emit it yourself (and `FtBurn` when burning).
- `storage_balance_bounds()` = `env::storage_byte_cost() * account_storage_usage` for min == max. Docs: registering costs **0.00125 NEAR** (`--depositYocto 1250000000000000000000`) — https://docs.near.org/primitives/ft/ft.md . Don't hardcode in the token; call `self.token.storage_balance_bounds().min`.
- `storage_deposit` can register a third party (`account_id: Some(x)`); refunds excess / full deposit if already registered to **predecessor** (using `.detach()`).
- `ft_transfer`, `ft_transfer_call`, `storage_withdraw`, `storage_unregister` call `assert_one_yocto()` — caller must attach exactly 1 yocto ⇒ **function-call access keys cannot call them** (FC keys can't attach deposits).

Events (`near_contract_standards::fungible_token::events`): `FtMint { owner_id: &AccountIdRef, amount: U128, memo: Option<&str> }.emit()`; also `FtTransfer`, `FtBurn`, and `emit_many(&[..])`. Logged as NEP-297 `EVENT_JSON:{"standard":"nep141","version":"1.0.0","event":"ft_mint",...}`.

### [HiveFund sketch] restricted mint with auto-registration
Two options for "who pays storage when a new worker gets their first HIVE":
- **A (recommended): minter attaches deposit.** `mint` is `#[payable]`; if receiver unregistered, require `attached >= storage_balance_bounds().min`, register, refund excess to predecessor (bounty-hub). Hub always attaches 0.00125 NEAR (or calls `storage_balance_of` first — costs an extra hop). Excess refunds go back to the hub, so it's safe to always attach.
- **B: token auto-registers at its own expense.** Token contract balance pays ~0.00125 NEAR per new holder. Acceptable because only the hub can mint (no sybil drain by strangers), but the token account must stay funded.
```rust
#[near]
impl Contract {
    #[payable]
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        require!(env::predecessor_account_id() == self.minter, "Only bounty-hub can mint");
        let mut deposit = env::attached_deposit();
        if !self.token.accounts.contains_key(&account_id) {
            let min = self.token.storage_balance_bounds().min;
            require!(deposit >= min, "Attach storage deposit for new account"); // option A
            self.token.internal_register_account(&account_id);
            deposit = deposit.saturating_sub(min);
        }
        self.token.internal_deposit(&account_id, amount.0);
        near_contract_standards::fungible_token::events::FtMint {
            owner_id: &account_id, amount, memo: Some("bounty reward"),
        }.emit();
        if !deposit.is_zero() {
            Promise::new(env::predecessor_account_id()).transfer(deposit).detach();
        }
    }
}
```
Lazy inactivity decay: store `last_active_ms: LookupMap<AccountId, u64>` beside the FT; apply decay in a helper called at the start of `ft_transfer`/`mint`/`ft_balance_of` (view returns computed value, change methods persist it via `internal_withdraw` + `FtBurn` event). Note `ft_balance_of` and `ft_total_supply` are views — they can't write, so total_supply drifts above the sum of decayed balances until burns are persisted; document that or keep decay out of the token (compute "reputation" in bounty-hub).

Alternative library: `near-sdk-contract-tools` (`#[derive(Owner, FungibleToken)]`, `deposit_unchecked`, hooks) — https://docs.near.org/primitives/ft/sdk-contract-tools.md . Docs now say: prefer the pre-deployed **global FT contract** unless you need custom behavior (we do: restricted mint), and "do not implement the FT standard by hand".

---

## 4. Unit testing

Sources: https://docs.near.org/smart-contracts/testing/unit-test.md , https://github.com/near/near-sdk-rs/tree/master/near-sdk/src/test_utils , FT example tests.

```rust
#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder, get_logs, get_created_receipts};
    use near_sdk::{testing_env, NearToken};

    fn ctx(predecessor: AccountId, deposit: NearToken) -> VMContextBuilder {
        let mut b = VMContextBuilder::new();
        b.current_account_id(accounts(0))
         .signer_account_id(predecessor.clone())
         .predecessor_account_id(predecessor)
         .attached_deposit(deposit)
         .block_timestamp(1_700_000_000_000_000_000); // ns
        b
    }

    #[test]
    #[should_panic(expected = "The contract is not initialized")]
    fn test_default_panics() { Contract::default(); }

    #[test]
    fn transfer_creates_receipt() {
        testing_env!(ctx(accounts(1), NearToken::from_near(1)).build());
        let mut c = Contract::new(accounts(1));
        c.fund();
        let receipts = get_created_receipts();   // Vec<Receipt { receiver_id, actions: Vec<MockAction>, .. }>
        // MockAction::Transfer { receipt_index, deposit }, MockAction::FunctionCallWeight { method_name, args, attached_deposit, prepaid_gas, .. }
        assert!(get_logs().is_empty());
    }
}
```
- `accounts(i)` → `["alice","bob","charlie","danny","eugene","fargo"][i]`.
- `VMContextBuilder` setters: `current_account_id, signer_account_id, signer_account_pk, predecessor_account_id, block_height, block_timestamp(u64 ns), epoch_height, account_balance(NearToken), storage_usage, attached_deposit(NearToken), prepaid_gas(Gas), random_seed([u8;32]), is_view(bool)`; then `.build()`.
- Call `testing_env!(builder.build())` again to change predecessor/deposit between calls; storage persists across `testing_env!` calls.
- **Testing callbacks**: pass promise results as 5th arg:
  ```rust
  use near_sdk::{test_vm_config, RuntimeFeesConfig, PromiseResult};
  testing_env!(
      ctx(accounts(0), NearToken::ZERO).build(),     // predecessor == current for #[private]
      test_vm_config(),
      RuntimeFeesConfig::test(),
      Default::default(),
      vec![PromiseResult::Failed],                   // or PromiseResult::Successful(serde_json::to_vec(&x).unwrap())
  );
  contract.on_mint(...);  // #[callback_result] receives Err(PromiseError::Failed)
  ```
  (`testing_env!` macro arities in test_utils/mod.rs; `PromiseResult { Successful(Vec<u8>), Failed }` in near-sdk/src/types/vm_types.rs). Callbacks are normal methods in unit tests — call them directly.
- Panic assertions: `#[should_panic(expected = "substring")]` matches a substring of the panic message (`require!(cond, "msg")` / `env::panic_str`).
- Unit tests cannot verify gas, real transfers, cross-contract execution or storage staking — use integration tests.

---

## 5. Integration testing

**Current recommendation: `near-sandbox` + `near-api` (+ `cargo-near-build` to compile)** — https://docs.near.org/smart-contracts/testing/integration-test.md . The page no longer mentions near-workspaces (still used by the `cargo near new` template, v0.22). Use the docs/FT-example stack.

Minimal test (verified from docs "Snippet I" + FT tests/common.rs):
```rust
use near_api::{AccountId, NearToken, Contract, Signer, NetworkConfig};
use near_sdk::serde_json::json;

#[tokio::test]
async fn test_contract_is_operational() -> testresult::TestResult<()> {
    let contract_wasm_path = cargo_near_build::build_with_cli(Default::default())?;
    let contract_wasm = std::fs::read(contract_wasm_path)?;

    let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
    let sandbox_network =
        near_api::NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);

    let user_account = create_subaccount(&sandbox, "user.sandbox").await?;
    let contract = create_subaccount(&sandbox, "contract.sandbox").await?.as_contract();

    // sandbox-created accounts share the genesis key
    let signer = near_api::Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse().unwrap(),
    )?;

    near_api::Contract::deploy(contract.account_id().clone())
        .use_code(contract_wasm)
        .with_init_call("new", json!({"owner": user_account.account_id()}))?   // or .without_init_call()
        .with_signer(signer.clone())
        .send_to(&sandbox_network)
        .await?
        .assert_success();

    contract
        .call_function("set_greeting", json!({"greeting": "Hello World!"}))
        .transaction()
        .deposit(NearToken::from_near(1))         // optional
        .gas(near_api::Gas::from_tgas(100))       // optional
        .with_signer(user_account.account_id().clone(), signer.clone())
        .send_to(&sandbox_network)
        .await?
        .assert_success();

    let greeting: String = contract
        .call_function("get_greeting", ())
        .read_only()
        .fetch_from(&sandbox_network)
        .await?
        .data;
    assert_eq!(greeting, "Hello World!");
    Ok(())
}

async fn create_subaccount(sandbox: &near_sandbox::Sandbox, name: &str)
    -> testresult::TestResult<near_api::Account> {
    let account_id: AccountId = name.parse().unwrap();
    sandbox.create_account(account_id.clone())
        .initial_balance(NearToken::from_near(10))
        .send().await?;
    Ok(near_api::Account(account_id))
}
```
- Build a different crate (e.g. hive-token from bounty-hub tests): `cargo_near_build::build_with_cli(cargo_near_build::BuildOpts { manifest_path: Some("../hive-token/Cargo.toml".into()), no_abi: true, no_embed_abi: true, no_locked: true, ..Default::default() })` (FT common.rs). Cache with `static WASM: LazyLock<Vec<u8>>`.
- Balance: `account.tokens().near_balance().fetch_from(&net).await?.total`. Refunds are async — FT example polls until balance settles.
- Time travel: `sandbox.fast_forward(1000).await` (blocks). Block height: `near_api::Chain::block_number().fetch_from(&net)`.
- Pin a node version: `Sandbox::start_sandbox_with_version("2.x.y")`.
- `cargo test -- --nocapture` to see prints. Env vars: `NEAR_SANDBOX_BIN_PATH` (custom binary), `NEAR_ENABLE_SANDBOX_LOG=1`, `NEAR_RPC_TIMEOUT_SECS` (default 10), `SANDBOX_ARTIFACT_URL` (https://github.com/near/near-sandbox-rs README).

### Windows notes
- near-sandbox README: sandbox execution supports **macOS ARM64 and Linux x86 only** — no native Windows binary. On this Windows 11 machine run integration tests in **WSL2 (Ubuntu)** or CI (GitHub Actions ubuntu-latest). near-workspaces has the same limitation (same neard-sandbox binary).
- Keep the repo inside the WSL filesystem (`~/hivefund`), not `/mnt/c/...OneDrive...` — cargo builds on /mnt/c are very slow and OneDrive sync can lock `target/` files.
- Docs-mentioned in-process alternative: `near-mock` (wasmtime, `cargo install near-mock`, community repo Kampouse/near-mock) — no node needed; platform support not documented (unverified on Windows).
- Unit tests (`cargo test` w/ `unit-testing`) run natively; note 5.30 now links nearcore host functions into the mock — **unverified** whether it builds cleanly on MSVC Windows; if it fails, run in WSL.
- cargo-near installs on Windows via `irm https://github.com/near/cargo-near/releases/latest/download/cargo-near-installer.ps1 | iex` (cargo-near README). Quickstart docs: in WSL/headless Linux the keychain may be unavailable → use `save-to-legacy-keychain` (files under `~/.near-credentials`).

---

## 6. Build & deploy (cargo-near + near-cli-rs)

### Build
```bash
rustup target add wasm32-unknown-unknown
cargo near build non-reproducible-wasm          # dev builds; reproducible-wasm needs Docker + committed Cargo.lock
```
Output path (from cargo-near-build source, types/cargo/metadata.rs + types/near/mod.rs):
- standalone crate: `<target-dir>/near/<package_name_with_underscores>.wasm` (quickstart: `./target/near/auction.wasm`)
- **workspace member**: `<workspace>/target/near/<pkg_underscored>/<pkg_underscored>.wasm` → `target/near/bounty_hub/bounty_hub.wasm`, `target/near/hive_token/hive_token.wasm`. ABI json lands next to it. Override with `--out-dir`.
- `cargo near deploy build-non-reproducible-wasm <account>` = build + interactive deploy.

### Accounts (near-cli-rs; https://github.com/near/near-cli-rs/blob/main/docs/GUIDE.en.md , https://docs.near.org/tools/cli.md)
```bash
# top-level testnet account via faucet
near account create-account sponsor-by-faucet-service hivefund.testnet autogenerate-new-keypair save-to-keychain network-config testnet create
# (WSL/headless: save-to-legacy-keychain)

# sub-accounts funded by parent (GUIDE.en.md "fund-myself")
near account create-account fund-myself hub.hivefund.testnet '5 NEAR' \
    autogenerate-new-keypair save-to-keychain \
    sign-as hivefund.testnet \
    network-config testnet sign-with-keychain send
near account create-account fund-myself token.hivefund.testnet '3 NEAR' \
    autogenerate-new-keypair save-to-keychain \
    sign-as hivefund.testnet network-config testnet sign-with-keychain send
```
Short legacy-compatible form also works: `near create-account <id> --useFaucet`.

### Deploy with init call (GUIDE.en.md "deploy")
```bash
near contract deploy token.hivefund.testnet \
    use-file target/near/hive_token/hive_token.wasm \
    with-init-call new \
    json-args '{"minter":"hub.hivefund.testnet","metadata":{"spec":"ft-1.0.0","name":"Hive","symbol":"HIVE","decimals":18}}' \
    prepaid-gas '100 Tgas' \
    attached-deposit '0 NEAR' \
    network-config testnet \
    sign-with-keychain \
    send
# without init: ... use-file <wasm> without-init-call network-config testnet sign-with-keychain send
```
Calls:
```bash
near contract call-function as-read-only hub.hivefund.testnet get_bounty json-args '{"id":1}' network-config testnet now
near contract call-function as-transaction hub.hivefund.testnet create_bounty json-args '{...}' \
    prepaid-gas '100.0 Tgas' attached-deposit '1 NEAR' sign-as alice.testnet network-config testnet sign-with-keychain send
```

### Function-call access key limited to methods (GUIDE.en.md "add-key")
Verified example:
```bash
near account \
    add-key fro_volod.testnet \
    grant-function-call-access \
        --allowance '0.1 NEAR' \
        --contract-account-id meta.pool.testnet \
        --function-names 'set_a, set_b' \
    autogenerate-new-keypair \
    save-to-keychain \
    network-config testnet \
    sign-with-plaintext-private-key \
        --signer-public-key ed25519:... \
        --signer-private-key ed25519:... \
    send
```
With a pre-generated key (key sub-command `use-manually-provided-public-key <pk>` is the same choice used by `create-account` / `add-key grant-full-access`, so this combination is valid):
```bash
near account add-key coordinator-agent.testnet \
    grant-function-call-access \
        --allowance '0.25 NEAR' \
        --contract-account-id hub.hivefund.testnet \
        --function-names 'assign_bounty, submit_verdict' \
    use-manually-provided-public-key ed25519:<PUBKEY> \
    network-config testnet sign-with-keychain send
```
Generate a keypair: `near generate-keypair print-to-terminal` or `save-to-file ./key.json`. List keys: `near account list-keys <acct> network-config testnet now`.
- FC keys: allowance pays gas only; **cannot attach any deposit** (not even 1 yocto) → methods called with an agent's FC key must not be `#[payable]`-required or `assert_one_yocto`. Empty `--function-names` = any method on that contract.

---

## 7. Sputnik DAO v2 (stretch)

Source: https://docs.near.org/primitives/dao.md , https://github.com/near-daos/sputnik-dao-contract
- Factory: **`sputnikv2.testnet`** (testnet), **`sputnik-dao.near`** (mainnet). DAOs live at `<name>.sputnikv2.testnet`.
- Create (docs CLI; `args` is base64 JSON, ~6 NEAR deposit):
  ```bash
  export COUNCIL='["your-account.testnet"]'
  export ARGS=`echo '{"config": {"name": "Primitives", "purpose": "Building primitives on NEAR", "metadata":""}, "policy": '$COUNCIL'}' | base64`
  near call sputnikv2.testnet create "{\"name\": \"primitives\", \"args\": \"$ARGS\"}" --useAccount your-account.testnet --amount 6 --gas 150000000000000
  ```
  (on Linux use `base64 -w0`). Alternative: deploy the global contract onto your own account: `near contract deploy <acct> use-global-account-id dao.globals.primitives.testnet with-init-call new json-args '{"config":{...},"policy":["<acct>"]}' prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-keychain send`.
- From a contract: `#[ext_contract(ext_dao_factory_contract)] trait ExternalDaoFactoryContract { fn create(&mut self, name: AccountId, args: Base64VecU8) -> Promise; }`.
- **Funding the DAO treasury**: the DAO is a normal account — bounty-hub can just `Promise::new(dao_id).transfer(amount)` (e.g. protocol fee), or FT via `ft_transfer` (DAO must be storage-registered on the token).
- **Proposals**: `add_proposal({"proposal": {"description": "...", "kind": {"Transfer": {"token_id": "", "receiver_id": "hub.hivefund.testnet", "amount": "<yocto>"}}}})` with deposit **exactly = policy `proposal_bond`** (default 0.1 NEAR, check `get_policy`) else `ERR_MIN_BOND`; ~300 TGas. `token_id: ""` = NEAR. Other kinds: `FunctionCall { receiver_id, actions: [{method_name, args(base64), deposit, gas}] }` — lets the DAO call bounty-hub admin methods (make the DAO the hub `owner`). Vote: `act_proposal '{"id": 0, "action": "VoteApprove"}'` (`VoteReject`, `VoteRemove`). Default policy: only council can propose.
- Contract-side `add_proposal` via `#[ext_contract(ext_dao_contract)] trait ExternalDaoContract { fn add_proposal(&mut self, proposal: ProposalInput) -> Promise; }` returns proposal id `u64`.

---

## 8. Security checklist highlights (callbacks & payments)

From https://docs.near.org/smart-contracts/security/checklist.md and the cross-contract-calls pages:
- **Access**: every callback `#[private]` (otherwise anyone's contract can call `on_x(user, amount)` and fake success — https://docs.near.org/smart-contracts/security/cross-contract-calls/callbacks.md ). Decide `predecessor_account_id` vs `signer_account_id` per check (use predecessor for "only bounty-hub can mint"). Sensitive user-key methods: require 1 yocto. Bound inputs (string lengths, list sizes), reject duplicate entries (e.g. duplicate winners) before paying.
- **Storage**: users pay for state they create (bid/bounty creation should charge a storage deposit or be covered by the bounty escrow); unique prefixes; `overflow-checks = true` or checked math.
- **Funds**: debit/lock internal balances **before** scheduling a transfer; keep enough liquid balance for storage + pending refunds; no method may spend funds already assigned to a pending op (escrowed bounty rewards must be excluded from "free treasury").
- **Cross-contract**: state is NOT rolled back when the callee fails — attached NEAR returns to *your contract*, not the user; refund in the callback (https://docs.near.org/smart-contracts/security/cross-contract-calls/refunds.md). Callbacks always run but can fail (gas, panics, malformed result, log limits 100 logs/16 KiB); a failed callback reverts only its own changes and is not retried (https://docs.near.org/smart-contracts/security/cross-contract-calls/callback-failures.md). Commit outcome-dependent credits in the callback; for withdrawals debit before and restore on failure. **Don't panic in callbacks** — settle and return (https://docs.near.org/smart-contracts/security/cross-contract-calls/callback-panics.md). Give callbacks measured worst-case gas + margin. Other methods can run between call and callback (1–2 blocks) — guard with status flags (`PayoutPending`). Return the Promise when callers need the final result.
- **FT**: `ft_on_transfer` must check predecessor is the expected token; `ft_resolve_transfer` private.
- **Economic**: one account ≠ one person (sybil); don't rely on `random_seed` for valuable outcomes; repeated/aborted/reordered actions must not profit (e.g. double `approve_submission`).
- **Ops/testing**: sandbox tests for failed promises, insufficient gas, failed callbacks, refunds, repeated and concurrent pending ops.

---

## Known pitfalls

1. `near-contract-standards` must match `near-sdk` exactly-ish (`~5.30.1`); mismatched minors → duplicate near-sdk crates and trait mismatch errors.
2. `near-contract-standards` turns on near-sdk `legacy`; `FungibleToken.accounts` is a **legacy** `collections::LookupMap` (`insert(&k,&v)`, owned `get`) while your own code uses `store::*` (`insert(k,v)`, `get -> Option<&V>`). Don't mix up the APIs; FT example's `LazyOption` is also `near_sdk::collections::LazyOption`.
3. `internal_deposit` panics if receiver not registered and doesn't emit `FtMint` — register first and emit the event yourself.
4. `ft_transfer`/`storage_withdraw`/`storage_unregister` require exactly 1 yocto ⇒ unusable with function-call access keys; same for any of your methods that use `assert_one_yocto`.
5. FC access keys can't attach deposits at all — `#[payable]` methods that *require* deposit can't be driven by agent FC keys; fund them from the hub instead.
6. `Promise` is `#[must_use]` (sdk ≥ 5.18): return it or `.detach()`. Missing `.then` callbacks = no failure handling.
7. Failed cross-contract call: NEAR comes back to the hub, state changes before the call persist → explicit compensation in a `#[private]` callback; never `panic!`/`unwrap()`/`require!` in the expected-failure path.
8. Callback gas: reserve with `.with_static_gas`; default unused-gas weight 1 may starve or over-feed; measure in sandbox. Hub→token mint chain needs enough prepaid gas on the original tx (e.g. 100–300 TGas).
9. `#[callback_result]` only catches callee *failure*; wrong return type/oversized data still panics → match the callee's exact return type (`()` for `mint`) or use `promise_result_checked`.
10. `#[init]` must be called before anything else; `PanicOnDefault` panics on any call before init. Deploy with `with-init-call` to avoid a front-run init window. Redeploy keeps state — changing the state struct without a migration (`#[init(ignore_state)]`) bricks deserialization.
11. Collections: unique prefix per collection; replacing a collection without `clear()` leaks storage; `mem::forget` skips flush; iteration is O(n) gas — paginate views (`from_index`, `limit`).
12. Use `U128`/`U64`/`NearToken` at JSON boundaries (JS can't hold > 2^53); amounts are strings in CLI JSON args.
13. Timestamps: `block_timestamp()` is **nanoseconds**, `block_timestamp_ms()` is milliseconds; VMContextBuilder `block_timestamp` takes ns.
14. Transfers to non-existent accounts fail (funds return to contract) — validate winner `AccountId` exists or handle via callback; implicit 64-hex accounts cost ~8 TGas per transfer.
15. Storage staking: contract balance must cover its state (~1 NEAR per 100 KB; `storage_byte_cost` = 1e19 yocto/byte). Don't let treasury withdrawals drain below storage needs — keep treasury accounting separate from `env::account_balance()`.
16. Windows: no native neard-sandbox → integration tests in WSL2/CI; keep project off OneDrive paths in WSL; keychain issues → `save-to-legacy-keychain`.
17. Docs pages still contain pre-5.x snippets (`Gas(5_000_000_000_000)`, `u128` deposits, `near call ... --accountId`). Current types: `Gas::from_tgas(n)`, `NearToken::from_*`; JS-CLI style flags (`--useAccount`, `--deposit`) work only with the legacy-compatible command forms.
18. workspace builds output to `target/near/<crate>/<crate>.wasm` (underscored), not `target/near/<crate>.wasm` — check the path cargo-near prints.
19. Sputnik `add_proposal` deposit must equal `proposal_bond` exactly; DAO account must be storage-registered on hive-token before receiving HIVE.
