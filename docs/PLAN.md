# HiveFund — Implementation Plan (single source of truth)

Community bounty market on NEAR: worker AI agents compete for bounties, adapt their bidding from outcomes, a verifier checks deliverables against machine-checkable acceptance tests, and the market itself mints the community token HIVE from verified outcomes.

Tracks: **AI Swarms** (primary, id `swarms`), **Memecoins With Mechanics** (secondary, id `memecoins`), **Social Money** (id `social`, only if Sputnik DAO integration works by end of Day 2 — Nov 12 23:59 UTC; otherwise remove every Social Money claim and state the scope change in README).

Deadline: submissions close **2026-11-14 23:59 UTC**. Cut order: dispute → decay → Sputnik DAO → reputation UI → polish.

---

## Corrections (override anything below that conflicts)

1. **No WSL.** Rust runs natively on Windows with the **GNU toolchain + MinGW** (default host `x86_64-pc-windows-gnu`; toolchains `stable` and `1.95.0` gnu; `wasm32-unknown-unknown` target; MinGW at `C:\Users\anish\mingw64\bin`). Build contracts with:
   `cargo near build non-reproducible-wasm --no-abi` (the ABI step fails with the GNU linker).
   Optional ABI workaround: set `CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=C:\Users\anish\.near-abi-stub\near-abi-linker.cmd` — not required.
2. **No near-workspaces / near-sandbox / near-api dev-deps** in contracts (sandbox has no Windows binary; near-api builds OpenSSL and needs a full Perl). Contract testing = **near-sdk unit tests only** (`near-sdk = { version = "5.30", features = ["unit-testing"] }` in dev-deps). If unit tests fail to compile because of a Perl/OpenSSL dependency: stop and report, do not install Perl.
3. **End-to-end tests are TypeScript** (`/tests`), run against `MockHubClient` (offline) and against testnet.
4. Sputnik DAO testnet factory is **`sputnikv2.testnet`** (mainnet `sputnik-dao.near`); DAOs live at `<name>.sputnikv2.testnet`; creating one costs ~6 NEAR; `add_proposal` deposit must equal `proposal_bond` exactly. Global-contract alternative `dao.globals.primitives.testnet`. (Source: docs/research/contracts.md §7.)
5. Every agent has **its own testnet sub-account** holding only a function-call key. Human-only steps (root account creation, approving testnet deploy, mainnet payout account, X post, submission) are never automated.
6. Node: `"engines": { "node": ">=22.22.2" }` (near-api-js 7.x and near-connect require it).
7. **No git commits unless the user asks.** The repo is `git init`-ed with a `.gitignore`; streams leave changes uncommitted.
8. Repo stays at `C:\Users\anish\OneDrive\Documents\Desktop\Near` (not moved). Expect OneDrive sync churn on `target/` and `node_modules/`.
9. Contract wasm output paths (cargo-near workspace): `contracts/target/near/bounty_hub/bounty_hub.wasm`, `contracts/target/near/hive_token/hive_token.wasm` (for a standalone crate it is `target/near/<crate>.wasm` — the deploy script must check both).
10. **Promises** must be returned or `.detach()`-ed (near-sdk ≥ 5.18).
11. `internal_deposit` in near-contract-standards panics for unregistered accounts and does **not** emit `FtMint` — register first, emit the event yourself.

## Judging & track guidance

NEAR judging weights (from the Loops skill): **Technical Implementation 30% · Innovation & Creativity 25% · Sponsor/Track Fit 25% (judges grep the repo for real use of NEAR stack) · Execution & Completeness 20% (working e2e path, docs, git activity).**
AI pre-screen (Claude Code / Codex) checks the repo runs and matches the README → README needs numbered "do X → see Y" steps.

Track-prompt guidance (nearai/near-hackathon-prompt-examples):
- **Swarms:** one sub-account per agent so every on-chain action is attributable; write `RULES.md` before code; a **simulation mode with no LLM calls**; a live dashboard.
- **Memecoins:** the mechanic is **enforced in the contract**: no account but the hub can call `mint` (as built, the owner keeps `set_minter`/`set_mint_rate` admin keys; see README Known limitations); judged on the mechanic, not the chart.
- **Social:** build on Sputnik DAO / Trezu, don't rebuild a multisig.

## Research notes

- `docs/research/contracts.md` — near-sdk 5.30.1 patterns, NEP-141 via near-contract-standards, cross-contract calls/callbacks, unit testing, near-cli-rs commands, Sputnik, 19 pitfalls.
- `docs/research/offchain-web.md` — near-api-js 7.4.0 from Node, ed25519 signing, near-connect in Next.js 16, RPC/explorer, NEAR AI Cloud, sub-account + FC key creation, track prompts, 20 pitfalls.
- Installed skills (load them): `.claude/skills/near-smart-contracts`, `near-contract-audit`, `near-api-js`, `near-kit`, `near-cli-rs`, `near-dapp`, `near-ai-cloud`, `near-intents`; `loops-near-hackathon` (needs `loops auth login`).

---

## 0. Environment facts

- Node v24.19.0, npm 11.17, git 2.51, Docker 29.5 present. Rust 1.99.1 + 1.95.0 (gnu), cargo-near 0.23.0, near-cli-rs 0.31.1.
- Versions: crates `near-sdk` 5.30.1, `near-contract-standards` 5.30.1; npm `near-api-js` 7.4.0 (`Account`, `JsonRpcProvider`, `KeyPair`, `KeyPairSigner`, `PublicKey`, `teraToGas`, `nearToYocto`, `account.callFunction`, `provider.callFunction`), `@hot-labs/near-connect` 0.12.0 (verify network option via the near-dapp skill), `next` 16.x.
- HACKATHON.md README rules: machine-readable "do X → see Y" steps, no marketing; list all libraries/templates/AI-generated code (Q-005); name NEAR features used; LICENSE (MIT); disclose any other project by the same person (Q-015); testnet-only is eligible (Q-010); local demo OK with video, hosted demo a plus, up until 2026-11-18 (Q-012); never commit secrets; submission is done by the human, once.

---

## 1. Repo layout and ownership

```
/package.json /tsconfig.base.json /.gitignore /.env.example /LICENSE /RULES.md   [Phase 0]
/config/deployment.testnet.json         written by deploy script            [A writes, all read]
/contracts/Cargo.toml (workspace)  /contracts/rust-toolchain.toml            [A]
/contracts/bounty-hub/src/{lib.rs,types.rs,errors.rs,views.rs,tests.rs}      [A]
/contracts/hive-token/src/lib.rs                                             [A]
/scripts/build-contracts.ps1 (+ .sh)   cargo near build ... --no-abi         [A]
/scripts/setup-testnet.ts              near-api-js: accounts, deploy, init, FC keys [A]
/agents/shared/                        @hivefund/shared                      [B; Phase 0 seeds types/canonical/bid/mint]
/agents/coordinator/                   @hivefund/coordinator (+ demo runner) [B]
/tests/                                @hivefund/tests (e2e, golden vectors) [B]
/agents/verifier/                      @hivefund/verifier                    [C]
/agents/worker-core/                   shared worker base                    [C]
/agents/worker-cheap|worker-quality|worker-adaptive/                         [C]
/bounties/                             bounty spec fixtures + test harnesses [C]
/web/                                  Next.js app                           [D]
/docs/{SPEC.md,MECHANICS.md,DEMO_SCRIPT.md}, /README.md                      [lead/E, Day 3; streams append to docs/notes/<stream>.md]
/data/                                 off-chain store (gitignored except /data/sample/)
```

Root `package.json`: workspaces `["agents/*","web","tests"]`, `"type":"module"`, scripts `demo` (`tsx agents/coordinator/src/demo.ts`), `test` (`npm -w tests test`), `setup:testnet` (`tsx scripts/setup-testnet.ts`), `web` (`npm -w web run dev`).
TS packages: no build step, run with `tsx`; `"module":"NodeNext"`, strict; each package `exports` → `./src/index.ts`. `/web` uses `transpilePackages:["@hivefund/shared"]` and imports only `@hivefund/shared` (isomorphic), never `@hivefund/shared/node`.

---

## 2. bounty-hub contract (Stream A)

`near-sdk = "5.30"`; dev-deps `near-sdk = { version = "5.30", features = ["unit-testing"] }`. Use `#[near(contract_state)]`, `near_sdk::store::{Vector, IterableMap}`, `NearToken`, `Gas`, `json_types::U128`.

### Types (`types.rs`, all `#[near(serializers=[borsh,json])]`)

```rust
pub enum BountyStatus { Open, Bidding, InProgress, Verifying, Completed, Disputed, Cancelled }
pub enum BidStatus { Pending, Rejected, Won, Lost, Superseded, Failed, Paid }
pub enum ActivityKind { TreasuryFunded, RoleChanged, WorkerAdded, WorkerRemoved, BountyPosted,
  BidPlaced, BidRejected, WinnerSelected, WorkSubmitted, VerificationPassed, VerificationFailed,
  Payout, Mint, MintFailed, BountyReopened, BountyCancelled, TreasuryRefund, DisputeOpened, DisputeResolved }

pub struct Bounty { id: u64, title: String, spec_hash: String, poster: AccountId,
  budget_yocto: U128, deadline_ms: u64, min_tier: u8, status: BountyStatus,
  round: u32,            // == number of failed verifications so far (0,1); bids carry the round
  attempts: u32,         // failed verifications; 2 => Cancelled
  bid_ids: Vec<u64>, winner_bid_id: Option<u64>, deliverable_hash: Option<String>,
  check_results_hash: Option<String>, score: Option<u32>, excluded: Vec<AccountId>,
  created_ms: u64, updated_ms: u64, hive_minted: U128 }

pub struct Bid { id: u64, bounty_id: u64, round: u32, worker: AccountId, tier: u8,
  price_yocto: U128, eta_ms: u64, signature: String, signed_payload: String,
  status: BidStatus, reject_reason: Option<String>, created_ms: u64 }

pub struct WorkerInfo { account_id: AccountId, tier: u8, signing_pk: String, active: bool,
  completed: u32, failed: u32, total_score: u64, earned_yocto: U128, hive_earned: U128 }
// view WorkerView = WorkerInfo + reputation: u32 = max(0, completed*10 + total_score/10 - failed*15)

pub struct ActivityEntry { id: u64, ts_ms: u64, block_height: u64, actor: AccountId,
  kind: ActivityKind, bounty_id: Option<u64>, bid_id: Option<u64>,
  amount: Option<U128>, detail: String }   // detail <= 200 chars, human readable

pub struct SupplyPoint { id: u64, ts_ms: u64, block_height: u64, bounty_id: u64,
  recipient: AccountId, bid_units: U128, score: u32, mint_rate: U128,
  amount: U128, total_minted_after: U128 }

pub struct Treasury { spend_cap: U128, committed_total: U128, funded_total: U128,
  available: U128, escrowed: U128, paid_out: U128, refunded_total: U128 }

pub struct PendingMint { bounty_id: u64, recipient: AccountId, amount: U128, bid_units: U128, score: u32 }
```

Struct fields are `pub`. Enums serialize as their variant name strings (`"Open"`, `"Pending"`, …).

Contract state: `owner`, `coordinator: Option<AccountId>`, `verifier: Option<AccountId>`, `hive_token: AccountId`, `mint_rate: u128`, `total_minted: u128`, `treasury: Treasury`, `bounties: Vector<Bounty>` (id = index), `bids: Vector<Bid>` (id = index), `workers: IterableMap<AccountId, WorkerInfo>`, `activity: Vector<ActivityEntry>`, `supply: Vector<SupplyPoint>`, `pending_mints: IterableMap<u64, PendingMint>`. Storage prefixes `b"b"`, `b"d"`, `b"w"`, `b"a"`, `b"s"`, `b"p"`.

Hard caps (hub pays its own storage): title ≤ 120 chars; hashes = 64 lowercase hex chars; signature ≤ 200 chars; reason ≤ 200 chars; ≤ 30 bids per bounty.

JSON rules: amounts always `U128` strings; ids, ms timestamps, tier, score, round are JSON numbers (< 2^53).

### Methods (JSON arg names exactly as shown)

| Method | Caller | Behaviour |
|---|---|---|
| `init(owner, hive_token_account, treasury_budget_yocto: U128, mint_rate: U128)` `#[init]` | deployer | `spend_cap = treasury_budget_yocto` |
| `fund_treasury()` `#[payable]` | anyone (community / DAO) | deposit > 0 else `ERR_ZERO_DEPOSIT`; `funded_total += d`, `available += d`; log TreasuryFunded |
| `set_coordinator(account_id)` / `set_verifier(account_id)` | owner | log RoleChanged; `ERR_ROLE_CONFLICT` if the account would be both coordinator and verifier, or is a worker |
| `add_worker(account_id, tier: u8, signing_pk: String)` | owner | tier 1..=3 (`ERR_BAD_TIER`); `signing_pk` = `"ed25519:<base58>"`; must not be coordinator/verifier (`ERR_ROLE_CONFLICT`); log WorkerAdded |
| `remove_worker(account_id)` | owner | `active=false`; log WorkerRemoved |
| `set_mint_rate(mint_rate: U128)` | owner | |
| `post_bounty(title, spec_hash, budget_yocto: U128, deadline_ms: u64, min_tier: u8) -> u64` | owner or coordinator (`ERR_NOT_POSTER`) | checks in order: budget > 0; budget ≤ available (`ERR_TREASURY_INSUFFICIENT`); committed_total + budget ≤ spend_cap (`ERR_SPEND_CAP`); deadline > now (`ERR_DEADLINE_PAST`). Move budget available → escrowed, committed_total += budget; status Open; log BountyPosted |
| `place_bid(bounty_id, price_yocto: U128, eta_ms: u64, signature: String) -> u64` | active registered worker (else panic `ERR_NOT_WORKER`) | business-rule rejections below; valid → Pending, Open → Bidding, log BidPlaced |
| `reject_bid(bounty_id, bid_id, reason: String)` | coordinator | Pending bid only → Rejected, `reject_reason = reason`; log BidRejected (used for forged signatures) |
| `select_winner(bounty_id, bid_id)` | coordinator | status Bidding (`ERR_BAD_STATUS`); bid Pending, same bounty, current round (`ERR_BID_NOT_SELECTABLE`). Winner → Won, other Pending bids of the round → Lost; `winner_bid_id`; status InProgress; log WinnerSelected |
| `submit_work(bounty_id, deliverable_hash)` | winning bid's worker (`ERR_NOT_WINNER`) | status InProgress → Verifying; log WorkSubmitted |
| `verify_bounty(bounty_id, passed: bool, score: u32, check_results_hash: String)` | verifier | status Verifying; score ≤ 100 (`ERR_BAD_SCORE`); caller attaches **100 TGas**. Flow below |
| `on_mint_complete(bounty_id: u64, recipient: AccountId, amount: U128, bid_units: U128, score: u32)` `#[private]` | callback | see below |
| `retry_mint(bounty_id)` | owner | re-issues the PendingMint (`ERR_NO_PENDING_MINT`) |
| `cancel_bounty(bounty_id)` | owner or coordinator | Open/Bidding/InProgress only; escrow → available (refunded_total += budget); Cancelled; log BountyCancelled + TreasuryRefund |
| `open_dispute` / `resolve_dispute` | STRETCH, first cut | keep enum variants, document as future work |

**`place_bid` business-rule rejections do NOT panic** — the bid is stored with status `Rejected` and `reject_reason`, logged BidRejected, and its id returned (a panic would revert the log). Exact reason strings:
`"bounty closed"` (status not Open/Bidding) · `"deadline passed"` · `"price exceeds budget"` · `"tier below min_tier"` · `"worker excluded"` · `"duplicate bid this round"` (one Pending bid per worker per round).
The contract builds the canonical `signed_payload` (§4) and stores it with the raw `signature`. **It does not verify the signature** (see decision below).

**`verify_bounty` PASS** (`passed && score > 0`):
1. winner bid → Paid; status → Completed; store `check_results_hash`, `score`.
2. escrow -= budget; paid_out += price; available += budget − price.
3. `Promise::new(winner).transfer(price)` (`.detach()`); log Payout + VerificationPassed.
4. WorkerInfo: completed += 1, total_score += score, earned_yocto += price.
5. `bid_units = price_yocto / 10^21` (milliNEAR, floor). `amount = bid_units * score * mint_rate / 100` with `checked_mul` (else `ERR_OVERFLOW`).
6. If amount > 0: insert PendingMint and return `ext hive_token.mint(account_id=winner, amount)` with **15 TGas** `.then(on_mint_complete)` with **15 TGas**.

**`verify_bounty` FAIL** (`!passed` or score == 0): winner bid → Failed; worker pushed to `excluded`; WorkerInfo.failed += 1; attempts += 1; store `check_results_hash`; log VerificationFailed (detail includes hash).
- attempts ≥ 2 → Cancelled; escrow budget → available (refunded_total += budget); log TreasuryRefund + BountyCancelled.
- else → round += 1; all remaining Pending bids → Superseded; status Open; `winner_bid_id = None`; log BountyReopened. Workers rebid in the new round (adaptation shows here).

**`on_mint_complete`** (`#[callback_result] Result<(), PromiseError>`):
- Ok: `total_minted += amount`; push SupplyPoint; `bounty.hive_minted = amount`; `worker.hive_earned += amount`; remove PendingMint; log Mint.
- Err: log MintFailed; keep PendingMint (owner can `retry_mint`). Must not panic.

**Views**: `get_config() -> {owner, coordinator, verifier, hive_token, mint_rate: U128, total_minted: U128, version: "0.1.0"}` · `get_bounties(from_index: Option<u64>, limit: Option<u64>) -> Vec<Bounty>` (default 0, 50) · `get_bounty(bounty_id) -> Option<Bounty>` · `get_bids(bounty_id) -> Vec<Bid>` · `get_treasury() -> Treasury` · `get_reputation(account_id: Option<AccountId>) -> Vec<WorkerView>` · `get_activity_log(from_index, limit)` (default limit 100) · `get_supply_history(from_index, limit)` · `get_pending_mints() -> Vec<PendingMint>`.

### Panic strings (`errors.rs`, `pub const`, exact text = the constant name)

`ERR_NOT_OWNER`, `ERR_NOT_COORDINATOR`, `ERR_NOT_VERIFIER`, `ERR_NOT_WORKER`, `ERR_NOT_WINNER`, `ERR_NOT_POSTER` (message: `"ERR_NOT_POSTER: only owner or coordinator may post"`), `ERR_ROLE_CONFLICT`, `ERR_BAD_TIER`, `ERR_BAD_SCORE`, `ERR_BAD_HASH`, `ERR_TOO_LONG`, `ERR_TOO_MANY_BIDS`, `ERR_BOUNTY_NOT_FOUND`, `ERR_BID_NOT_FOUND`, `ERR_BAD_STATUS`, `ERR_BID_NOT_SELECTABLE`, `ERR_TREASURY_INSUFFICIENT`, `ERR_SPEND_CAP`, `ERR_DEADLINE_PAST`, `ERR_ZERO_DEPOSIT`, `ERR_OVERFLOW`, `ERR_NO_PENDING_MINT`. Token: `ERR_NOT_MINTER`. Each panic message **starts with** the constant name; tests assert with `#[should_panic(expected = "ERR_...")]` / TS `includes("ERR_...")`.

### Mint units

HIVE has 18 decimals. `winning_bid_units` = winning bid price in **milliNEAR** (`price_yocto / 10^21`). Default `mint_rate = 10^16`:
- 1 NEAR at score 100 → 1000 × 100 × 10^16 / 100 = 10^19 = **10 HIVE**.
- 0.5 NEAR at score 80 → 500 × 80 × 10^16 / 100 = 4×10^18 = **4 HIVE**.
- Worst case 1e9 units × 100 × 1e16 = 1e27 ≪ u128::MAX.

### Bid signature decision: on-chain anchor, off-chain check

The tx signature already authenticates the sender. The ed25519 payload signature is a portable commitment ("worker X offers price P / eta E for bounty B round R on contract C") made with a **separate bid-signing key** whose public key the owner registered on-chain (`signing_pk`). The coordinator verifies it against that key before ranking, so a forged bid lands on-chain and is visibly rejected via `reject_bid` (logged) — the required test/demo moment. `env::ed25519_verify` would block forged bids so they'd never appear in the log. Document in SPEC.md; on-chain verify = future work.

### Unit tests (`tests.rs`, `VMContextBuilder` + `testing_env!`)

Callback results: `testing_env!(ctx, test_vm_config(), RuntimeFeesConfig::test(), Default::default(), vec![PromiseResult::Successful(vec![])])` (or `PromiseResult::Failed`). Cover: init; fund (zero deposit); roles (non-owner, conflict); post (each error); each bid rejection reason + non-worker panic; coordinator cannot `verify_bounty`; verifier cannot `select_winner`; worker cannot select; `reject_bid`; select wrong round / superseded; submit by non-winner; verify pass (treasury math, reputation, PendingMint, mint formula); verify fail → reopen → rebid → pass; two fails → Cancelled + refund; mint callback success and failure; `retry_mint`; `cancel_bounty`; overflow; golden test — canonical payload equals `/tests/vectors/bid_payload.json` (`include_str!("../../../tests/vectors/bid_payload.json")`).

### hive-token (Stream A)

`near-contract-standards = "5.30"`. Follow the near-examples FT pattern: implement `FungibleTokenCore`, `FungibleTokenResolver`, `StorageManagement` by delegating to `FungibleToken`, plus `FungibleTokenMetadataProvider`.
State: `token: FungibleToken`, `metadata`, `owner: AccountId`, `minter: AccountId`.
- `new(owner_id, minter_id)` `#[init]`. Metadata: spec `ft-1.0.0`, name "HiveFund Token", symbol "HIVE", decimals 18, icon = data-URI SVG.
- `mint(account_id, amount: U128)`: panic `ERR_NOT_MINTER` unless predecessor == minter. If unregistered → `token.internal_register_account(&account_id)` (token pays storage from its own balance; fund with 2 NEAR at deploy). Then `internal_deposit`, emit `FtMint { owner_id, amount, memo: Some("bounty reward") }`.
- `set_minter(minter_id)` owner-only (handover only; there is no mint method for the owner, but the owner can rotate the minter, which is an admin key; see README Known limitations).
- View `get_minter()`.
- **Decay (cut #2; only if core done by end of Day 2):** lazy and explicit. `last_active_ms: LookupMap<AccountId,u64>` updated on mint/transfer/receive. `poke_decay(account_id)` (anyone): if inactive > 7 days, burn `balance × min(days_inactive − 7, 50)%` (1%/day), emit `FtBurn`, reset timer. View `get_decay_preview(account_id) -> U128`. Avoids a lazy `ft_balance_of` that breaks the NEP-141 total_supply invariant.

---

## 3. Accounts, keys, deploy (Stream A, `scripts/setup-testnet.ts` with near-api-js)

`ROOT_ACCOUNT` (e.g. `hivefund-xyz.testnet`) is **created by the human** (faucet / `near create-account <x>.testnet --useFaucet`), key in `.env.local`. **Running the script against testnet requires the human's explicit approval.**

Sub-accounts: `hub.$ROOT`, `hive.$ROOT` (contracts), `coordinator.$ROOT`, `verifier.$ROOT`, `cheap.$ROOT`, `quality.$ROOT`, `adaptive.$ROOT`, `forger.$ROOT` (adversarial demo: registered worker signing bids with the wrong bid key).

Script steps:
1. Create accounts (hub 3 NEAR, hive 3 NEAR, agents 0.5 each). Note: `createSubAccount` always adds a full-access key; use a hand-built batch (`createAccount` + `transfer` + `addFunctionCallAccessKey`) signed by the parent for agents, or delete the full key afterwards.
2. Deploy wasm from `contracts/target/near/*/*.wasm` (fallback `contracts/target/near/*.wasm`).
3. `hive.new(owner_id=ROOT, minter_id=hub)`.
4. `hub.init(owner=ROOT, hive_token_account=hive, treasury_budget_yocto=20 NEAR, mint_rate=1e16)`.
5. Set roles; `add_worker` tiers: cheap 1, adaptive 2, quality 3, forger 1.
6. `fund_treasury` 5 NEAR.
7. FC key per agent: `addFunctionCallAccessKey(pk, hub, methods, allowance 1 NEAR)`:
   - coordinator: `[post_bounty, select_winner, reject_bid, cancel_bounty]`
   - verifier: `[verify_bounty]`
   - workers: `[place_bid, submit_work]`
8. Remove agents' full-access keys — agents only ever hold FC keys.
9. Generate a separate ed25519 bid-signing key per worker.
10. Write secrets to `.env.local` (gitignored) and public info to `/config/deployment.testnet.json`.
Idempotent: skip existing accounts.

`/config/deployment.testnet.json`:
```json
{"network":"testnet","rpcUrl":"https://test.rpc.fastnear.com","hub":"hub.X.testnet","token":"hive.X.testnet",
 "owner":"X.testnet","coordinator":"coordinator.X.testnet","verifier":"verifier.X.testnet",
 "workers":{"cheap":"cheap.X.testnet","quality":"quality.X.testnet","adaptive":"adaptive.X.testnet","forger":"forger.X.testnet"},
 "explorer":"https://testnet.nearblocks.io","deployedAt":"ISO","sampleTxs":{"deploy":"","verifyPass":""}}
```

`.env.example` keys: see `/.env.example`.

FC-key gotchas: FC keys **cannot attach a deposit** (so agent-callable methods are non-payable; `fund_treasury` comes from owner or a wallet); allowance defaults to 0.25 NEAR if omitted and cannot be raised later; gas is paid from the sub-account balance.

---

## 4. Shared TS interface (`@hivefund/shared`, Stream B owns; Phase 0 seeded `types.ts`, `canonical.ts`, `bid.ts`, `mint.ts`)

Root `index.ts` is isomorphic (web-safe):
- `types.ts` — TS mirrors of the Rust types. Amounts are `string`; enums are string unions identical to Rust variant names.
- `canonical.ts` — `canonicalize(v): string` (keys sorted recursively, no whitespace, rejects bigint/undefined/NaN/Infinity/functions), `sha256Hex(s | bytes)` via `@noble/hashes`, `hashJson(v) = sha256Hex(canonicalize(v))`.
- `bid.ts` — `bidPayload({bounty_id, contract, eta_ms, price_yocto, round, worker}) => string` (canonical JSON). Must byte-match Rust:
  `format!(r#"{{"bounty_id":{},"contract":"{}","eta_ms":{},"price_yocto":"{}","round":{},"worker":"{}"}}"#, bounty_id, contract, eta_ms, price_yocto, round, worker)`.
  `signBid(payload, bidKey: "ed25519:...") => "ed25519:<base58 sig>"`; `verifyBid(payload, signature, signing_pk) => boolean`.
- `mint.ts` — `bidUnits(priceYocto)`, `mintAmount(priceYocto, score, mintRate)` (BigInt, same formula as contract).
- `spec.ts` (B) — BountySpec / Deliverable / VerificationReport light validator.
- `config.ts` (B) — loads deployment JSON + env.

`@hivefund/shared/node` (Node only, Stream B):
- `hub.ts` — `interface HubClient { view<T>(method, args): Promise<T>; call(method, args, opts?: {gasTGas?: number; depositYocto?: string}): Promise<{txHash: string; result: any}> }`. `NearHubClient(accountId, privateKey, cfg)` uses near-api-js v7 `Account.callFunction` / `callFunctionRaw` (default 100 TGas; txHash = `transaction_outcome.id`). `MockHubClient` = in-memory TS port of the state machine (same method names, same error strings, simulated minting) for `HIVEFUND_MODE=mock`.
- `store.ts` — content-addressed off-chain store: `put(obj, meta:{kind, bounty_id?, round?, actor}) -> hash` writes `${DATA}/offchain/<hash>.json` containing exactly `canonicalize(obj)`, appends `${DATA}/index.jsonl`; `get(hash)` re-hashes and throws on mismatch; `appendStrategy(worker, StrategyChange)` → `${DATA}/strategy/<worker>.jsonl`; `appendTx({ts, actor, method, args, txHash})` → `${DATA}/tx.jsonl`; `exportSnapshot(dir)` → `web/public/offchain/`.
- `llm.ts` — `chat(messages, {json: true})` via `openai` with `baseURL = NEARAI_BASE_URL`; returns `null` when `NEARAI_API_KEY` unset → callers use deterministic fallbacks. Suggested model `z-ai/glm-5.3-flash` (configurable via `NEARAI_MODEL`; list via `GET /v1/models`). Try `response_format: json_schema`, fall back to `json_object`.

Off-chain shapes (`kind`: `spec` | `deliverable` | `report` | `selection`):
```ts
BountySpec { version:1; title; description; deliverable_schema: object /* JSON Schema for Deliverable.data */;
  required_sections: string[]; test: { runner:"node"; file: string /* path under /bounties */; timeout_ms:number } | null;
  rubric: { criteria:{id;description;weight:number}[]; pass_threshold:number /*0-100*/ };
  budget_yocto:string; min_tier:1|2|3; deadline_minutes:number }
Deliverable { bounty_id; round; worker; sections: Record<string,string>; data: unknown; code?: Record<string,string> }
VerificationReport { bounty_id; round; worker; spec_hash; deliverable_hash;
  checks: {id:"schema"|"sections"|"test"|"rubric"; passed:boolean; skipped?:boolean; details:string; duration_ms:number}[];
  rubric: {mode:"llm"|"fallback"; model:string|null; scores:{criterion;score;rationale}[]; total:number; threshold:number} | null;
  passed:boolean; score:number; verifier:string; created_ms:number }   // hash => check_results_hash
SelectionRationale { bounty_id; round; weights; candidates:{bid_id;worker;price_yocto;eta_ms;reputation;sig_valid:boolean;score:number}[]; winner_bid_id; rejected:{bid_id;reason}[] }
StrategyChange { ts_ms; worker; bounty_id; old_margin; new_margin; reason; window:("win"|"loss"|"fail")[] }
```

Golden vector `/tests/vectors/bid_payload.json`: `{"input":{...}, "payload":"<exact string>"}`; Rust and TS tests assert equality.

---

## 5. Agents

**Coordinator** (B, `agents/coordinator/src/coordinator.ts`, class with `tick()`):
1. Post bounties from `/bounties/*.json` (`put` spec → spec_hash → `post_bounty`).
2. For each Bidding bounty past its bid window (demo: N bids or timeout): load bids, verify each Pending bid's signature against the worker's `signing_pk` from `get_reputation`; invalid → `reject_bid(reason "invalid bid signature")`.
3. Score `0.5·(1 − price/budget) + 0.2·(1 − eta/max_eta) + 0.3·rep/max_rep`; tie → lower price.
4. `put(SelectionRationale)` → `select_winner`. **Never hardcode the winner.**

**Verifier** (C, `agents/verifier`), on status Verifying:
1. Load spec + deliverable by hash.
2. Checks in order: (1) JSON-schema check of `data` (ajv) + required sections present and non-empty; (2) test command — only `runner:"node"` with `file` resolved inside `/bounties/`; write `deliverable.code` into a temp dir, `node <file> <tmpdir>` via `child_process.spawn` with timeout; exit 0 = pass; (3) rubric only if (1) and (2) pass — LLM via NEAR AI, JSON 0–100 per criterion, weighted total. **Fallback** (no key): deterministic keyword/coverage heuristic (documented in MECHANICS.md).
3. `passed = all automated pass && total ≥ threshold`; `score = passed || rubric ? total : 0`.
4. `put(report)` → `verify_bounty(bounty_id, passed, score, hash)`.

**Workers** (C, `agents/worker-core` + 3 thin config packages). `tick()`: read Open/Bidding bounties + spec; decide independently (skip if tier < min_tier, price > budget, expected_profit < 0); `cost = budget · complexity(spec)` with complexity ∈ [0.3, 0.7] from spec size / test presence; `price = cost · (1 + margin)`; `eta = base_eta · speed`; sign + `place_bid`. On win: generate deliverable (LLM if key, else template generator whose thoroughness = quality) → `put` → `submit_work`.
- cheap: margin 0.05, speed 1.6, quality "low" (template skips edge cases → naturally fails the slugify unicode test; not scripted).
- quality: margin 0.35, speed 0.7, quality "high".
- adaptive: margin 0.20 within [0.05, 0.50], quality "medium → high after a fail"; keeps last 5 outcomes; win → +0.05, loss → −0.04, verification fail → raise quality; every change `appendStrategy` with reason.
- forger (tests / demo only): signs with the wrong key.

**Demo** (`npm run demo`, B, `agents/coordinator/src/demo.ts`): one process, explicit steps — post 2 bounties → all workers tick + forger bids → coordinator rejects forgery and selects → winner submits → verifier checks → on fail: reopen, rebid (adaptive logs strategy change), select, pass, mint → print summary table + tx hashes → `exportSnapshot`. Flags `--mode mock|testnet`, `--loop` (poll 5 s; separate processes via `npm run agent:<name>`). **`--mode mock` runs with no LLM and no chain (simulation mode).**

---

## 6. Web (D) — Next.js 16 App Router, Tailwind v4, recharts

- Config from `NEXT_PUBLIC_*`, fallback import of `/config/deployment.testnet.json`.
- Chain reads: client-side `JsonRpcProvider.callFunction` views, polled every 5 s.
- Off-chain: `app/api/offchain/[hash]/route.ts` (reads `HIVEFUND_DATA_DIR`, fallback `public/offchain/`, re-verifies hash), `app/api/strategy/[worker]/route.ts`, `app/api/tx/route.ts`.
- Wallet: `@hot-labs/near-connect` (optionally `near-connect-hooks`); filter wallets with testnet support; signed-in users can `fund_treasury` with a deposit; explorer links `https://testnet.nearblocks.io/txns/<hash>`, `/address/<id>`.
- Panels on `/` (+ `/bounty/[id]` drill-down): (1) bounty board — status chips, budget, deadline, round/attempts, spec link; (2) bid board — rationale scores, winner highlighted, Rejected/Superseded **red** with reason, signature-valid badge; (3) verification panel — each check, rubric table, llm/fallback mode, on-chain hash vs recomputed ✓; (4) HIVE panel — supply over time from `get_supply_history`, each mint traced bounty → bid → score → `units×score/100×rate = amount`; (5) worker panel — margin over time from strategy jsonl, win rate, reasons; (6) treasury & reputation; (7) activity feed.
- Dev fixture: `HIVEFUND_MODE=mock` renders from `/data/sample` so D never blocks on deploy.

---

## 7. Streams, order, checklists

Order: Phase 0 (done) → A, B, C, D in parallel (B delivers `MockHubClient` + store early; C and D use mock until A deploys) → testnet integration Day 2 (**human approves deploy**) → **Sputnik gate end of Day 2 (Nov 12 23:59 UTC)**: create DAO via `sputnikv2.testnet`, FunctionCall proposal → `hub.fund_treasury` with deposit, vote, execute, show tx in Treasury panel; else drop `social` and note scope change → Day 3 docs, polish, demo recording → Nov 14 buffer + human submission.

- **A:** both crates build with `cargo near build non-reproducible-wasm --no-abi`; `cargo test` passes every path in §2 incl. golden vector; `setup-testnet.ts` idempotent (written; run only after approval), deployment JSON populated, FC keys verified (coordinator key calling `verify_bounty` fails); sample tx hash recorded.
- **B:** shared unit tests (golden vector, sign/verify round-trip, forged → false, `mintAmount` = 4 HIVE case, store re-hash mismatch throws); `npm run demo -- --mode mock` fully offline; `tests/e2e.test.ts` (node:test) vs mock and vs testnet: post, 3 honest bids + forged, forged rejected and logged, select, automated check fails, reopen, rebid, pass, Payout, Mint, treasury reduced by exact price, supply history +1, ft_balance matches; role tests: coordinator `verify_bounty` → `ERR_NOT_VERIFIER`, verifier `select_winner` → `ERR_NOT_COORDINATOR`, non-worker bid → `ERR_NOT_WORKER`.
- **C:** verifier on slugify fixture — cheap fails the test check, quality passes; no `NEARAI_API_KEY` → deterministic (same input → same report hash); test runner refuses paths outside `/bounties`; workers skip over-budget / under-tier bounties; adaptive logs a reason on every change and stays in bounds over 20 simulated outcomes.
- **D:** `next build` passes; all 7 panels render against `/data/sample` and testnet; wallet sign-in + `fund_treasury` on testnet; recomputed hash = on-chain `check_results_hash`; rejected bids red.
- **Docs:** README (pitch, problem, Mermaid diagram, track mapping one line per feature per track, "do X → see Y", setup, testnet IDs + tx, demo video placeholder, team/wallet placeholder — filled by the human, never invented, libraries + AI-generated code disclosure, NEAR features used: sub-accounts, function-call keys, NEP-141, cross-contract calls + callbacks, NEAR AI Cloud, near-connect, Sputnik if kept; known limitations; LICENSE). SPEC.md (data model, state machine as Mermaid stateDiagram, role/key table with per-agent method lists). MECHANICS.md (mint formula, adaptive strategy, rubric fallback, decay). DEMO_SCRIPT.md.

Cut order: dispute → decay → Sputnik → reputation UI → polish.

## 8. Risks

1. GNU-toolchain quirks (ABI step) — use `--no-abi`; Docker `sourcescan/cargo-near` or GitHub Actions as fallback.
2. near-api-js v7 API details — load the `near-api-js` skill; near-connect testnet config — load `near-dapp`.
3. Testnet root account + faucet limits need a human step; budget ~20 testnet NEAR.
4. FC-key allowance (1 NEAR) can run out after many 100 TGas calls — top up in the script.
5. FC keys cannot attach deposits → `fund_treasury` from owner or wallet.
6. Callback gas — `retry_mint` covers mint failure.
7. NEAR AI model names change — list via `GET /v1/models`, keep configurable.
8. `child_process` test execution is a code-execution surface — allowlist runner + path, temp dir, timeout.
9. OneDrive path churn on `target/` and `node_modules/`.
10. Hosted web (Vercel) cannot read local `/data` — use the exported `public/offchain` snapshot.
