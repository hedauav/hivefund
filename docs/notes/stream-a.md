# Stream A — contracts + testnet setup (notes for the lead and other streams)

## What exists

| Path | What |
|---|---|
| `contracts/bounty-hub` | Market contract (PLAN §2). 71 unit tests. wasm 231,684 B |
| `contracts/hive-token` | HIVE NEP-141 (near-contract-standards 5.30.1), mint restricted to the hub. 9 unit tests. wasm 160,460 B |
| `scripts/build-contracts.ps1` / `.sh` | `cargo near build non-reproducible-wasm --no-abi` for both crates |
| `scripts/setup-testnet.ts` | Idempotent testnet setup + self-check (`--dry-run`, `--offline`, `--check`, `--redeploy`) |
| `scripts/topup.ts` | `fund <acct> <NEAR>`, `treasury <NEAR>`, `rekey <agent> [allowance]`, `status` (all accept `--dry-run`) |
| `scripts/near-ops.ts` | Shared helpers: .env.local upsert, RPC failover + retries, idempotent `step()` |
| `config/deployment.testnet.json` | Pre-deploy template (`status: "not-deployed"`, derived account ids). The real run overwrites it with tx hashes, wasm hashes, params and self-check results. |

Toolchain: `contracts/rust-toolchain.toml` pins `1.95.0` (gnu host on this machine). `cargo test` in `contracts/` runs all 80 unit tests natively (no Perl, no sandbox).

## Deviations from PLAN (all small, interface-compatible)

1. **Treasury `committed_total` = escrowed + paid_out** (net committed spend). On PASS it drops by the unspent part of the budget (`budget − price`); on cancel / 2nd failure it drops by the whole budget. Without this, refunds would permanently eat the spend cap.
2. **Extra panic messages** (all start with a PLAN code so `includes("ERR_…")` still matches):
   - `post_bounty` budget 0 → `ERR_TREASURY_INSUFFICIENT: budget must be > 0`
   - `cancel_bounty` by non-owner/non-coordinator → `ERR_NOT_COORDINATOR: only owner or coordinator may cancel`
   - `add_worker` with a malformed `signing_pk` → `ERR_BAD_HASH: signing_pk must be ed25519:<base58>`
   - `retry_mint` while the previous mint is still in flight → `ERR_BAD_STATUS: mint already in flight`
   - `post_bounty` checks `min_tier` ∈ 1..=3 (`ERR_BAD_TIER`), title ≤ 120, `spec_hash` 64 lowercase hex.
   - hive-token `mint` of 0 → `ERR_ZERO_AMOUNT`; `set_minter` by non-owner → `ERR_NOT_OWNER`.
3. **Mint double-spend guard:** internal `mints_in_flight: LookupSet<u64>` (prefix MintsInFlight). `on_mint_complete` with no PendingMint is a no-op (no double count).
4. **`verify_bounty` returns `PromiseOrValue<()>`**: the mint promise on PASS with amount > 0, otherwise `null`. Callers should attach ≥ 60 TGas (15 mint + 15 callback + execution); PLAN says 100 TGas, which also works.
5. **`cancel_bounty`** marks Pending *and* Won bids `Superseded`; on 2nd failure the remaining Pending bids are `Superseded`, Lost bids stay `Lost`.
6. **Bids keep the bounty's `round`** even when rejected; rejected bids count toward the 30-bids-per-bounty cap.
7. **SupplyPoint.mint_rate** is the hub's mint rate at callback time (same as at verify time unless the owner changes it in between).
8. Hub activity entries also go to the tx logs as `hivefund: <detail>` (handy in the explorer).
9. **Agent recovery key (setup script):** by default each agent sub-account gets *two* keys: its function-call key (the only key the agent process ever sees, in `.env.local`) and ROOT's public key as a full-access **recovery key held by the human**. Reason: FC allowances can't be raised, and with the minimal 0.05 NEAR allowance an agent would otherwise be dead after a handful of calls. `scripts/topup.ts rekey <agent>` uses it to install a fresh FC key. Set `AGENT_RECOVERY_KEY=none` for FC-key-only agents (PLAN §3 step 8 strict mode).
10. Contract accounts (`hub.`, `hive.`) get ROOT's public key as full-access key (upgrades via `--redeploy`).
11. `#[private]` on `on_mint_complete` is enforced by the wasm entry point, so it can't be unit-tested; it's covered on testnet.

## Env keys for `.env.example` (lead: please merge; minimal defaults)

```
# ---- Testnet setup budgets (scripts/setup-testnet.ts; all NEAR, minimal defaults) ----
# Contract accounts default to ceil(wasm_bytes / 100 KB) NEAR + CONTRACT_STATE_BUFFER_NEAR
HUB_FUND_NEAR=
HIVE_FUND_NEAR=
CONTRACT_STATE_BUFFER_NEAR=0.2
AGENT_FUND_NEAR=0.1
FC_ALLOWANCE_NEAR=0.05
TREASURY_FUND_NEAR=0.5
TREASURY_CAP_NEAR=1
MINT_RATE=10000000000000000
GAS_MARGIN_NEAR=0.3
# root = ROOT's public key stays on agent accounts as a human-held recovery key (enables `topup.ts rekey`); none = FC key only
AGENT_RECOVERY_KEY=root
# optional overrides
HUB_PREFIX=hub
TOKEN_PREFIX=hive
RPC_URL=https://test.rpc.fastnear.com
RPC_FALLBACK_URL=https://near-testnet.drpc.org
```

With the current wasm sizes the defaults are: hub 3.2 NEAR, hive 2.2 NEAR, 6 agents × 0.1, treasury 0.5 → **~6.8 NEAR incl. 0.3 gas margin** (root has 10).

## For Stream B / C (agents)

- **Gas:** FC allowance is only 0.05 NEAR. Prepaid gas is charged against the allowance, so don't use 100 TGas everywhere. Suggested: `place_bid`, `submit_work`, `reject_bid`, `select_winner`, `post_bounty`, `cancel_bounty` → **30 TGas**; `verify_bounty` → **60 TGas** (needs 30 for mint + callback). When an allowance runs out: `npx tsx scripts/topup.ts rekey <agent>`.
- `place_bid` business rejections return a bid id and **do not throw**; read `get_bids` to see `status: "Rejected"` + `reject_reason`.
- `select_winner` requires status `Bidding` (at least one Pending bid in the current round).
- After a failed verification the bounty is `Open` again with `round` + 1; the failed worker is in `excluded`.
- `get_reputation()` (no arg) lists all workers incl. `signing_pk` for off-chain bid-signature checks.
- `verify_bounty` result: `null` (fail or zero mint) or the mint promise. `get_pending_mints` shows mints whose callback hasn't run or failed (`retry_mint` is owner-only).
- Treasury storage: the hub pays for its own state out of its balance (buffer 0.2 NEAR ≈ 20 KB ≈ 60 activity entries + bids). Top up with `topup.ts fund hub 0.2` for longer demos.

## Running it (lead, after the user's go-ahead)

```
powershell -File scripts/build-contracts.ps1      # or: bash scripts/build-contracts.sh
npx tsx scripts/setup-testnet.ts --dry-run        # read-only pre-flight
npx tsx scripts/setup-testnet.ts                  # REAL testnet run (idempotent; safe to re-run)
npx tsx scripts/setup-testnet.ts --check          # self-check only
npx tsx scripts/topup.ts status
```

The self-check verifies: `get_config` roles, token minter == hub, HIVE metadata, 4 workers with tiers + signing keys, treasury funded and cap, every agent FC key's receiver + method list, three access-key rejections (coordinator→`verify_bounty`, verifier→`select_winner`, worker→`select_winner`) and one on-chain `ERR_NOT_VERIFIER` panic (owner calling `verify_bounty`; its tx hash is recorded as `sampleTxs.selfCheckNotVerifier`).
