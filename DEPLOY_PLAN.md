# DEPLOY_PLAN — HiveFund v2 contracts with `lock_config` (testnet)

> **STOP: nothing in this file has been executed.** No account was created, nothing was deployed, and `lock_config` was not called anywhere. The human must answer `AWAIT_CONFIRMATION.md` first. Testnet only, never mainnet.

## Why fresh `-v2` accounts (no in-place upgrade)

`lock_config` adds a new state field (`config_locked: bool`) to **both** contracts. That changes the borsh state layout, so deploying the new code over the live v0.1 accounts (`hub.hivefund-2026.testnet`, `hive.hivefund-2026.testnet`) would make their existing state undecodable: every call would fail. A state migration is possible but untested and risky on deadline day. So v1 stays exactly as it is, and v2 goes to new accounts:

| | v1 (live today, unchanged) | v2 (proposed) |
|---|---|---|
| Hub | `hub.hivefund-2026.testnet` | `hub-v2.hivefund-2026.testnet` |
| Token | `hive.hivefund-2026.testnet` | `hive-v2.hivefund-2026.testnet` |
| Agents | `coordinator`, `verifier`, `cheap`, `quality`, `adaptive`, `forger` `.hivefund-2026.testnet` | **same accounts**, plus a new function-call key per agent scoped to `hub-v2` |

Both v2 names were checked read-only on 2026-11-14: neither exists yet.

Consequence: HIVE v2 is a **new token with supply 0**. The 1.6599 HIVE minted on v1 stays on `hive.hivefund-2026.testnet`. v1 cannot hand its minter to `hub-v2` and then lock, because the v1 token code has no lock.

## Code to deploy (built locally, not deployed)

Built with `powershell -File scripts/build-contracts.ps1` (`cargo near build non-reproducible-wasm --no-abi`):

| Wasm | Bytes | sha256 |
|---|---|---|
| `contracts/target/near/bounty_hub/bounty_hub.wasm` | 232,602 | `bb286fab11d248a07ec49eabda1927ec8b35c2c6a1becb1952f2bef3aa4ed18a` |
| `contracts/target/near/hive_token/hive_token.wasm` | 161,424 | `80895936cf67cca86d59768d82fbe124151d5137b69e2495997c9d2d127321f8` |

The v1 record in `config/deployment.testnet.json` (hub 231,684 B `7dff3bc1…`, token 160,460 B `6d22536c…`) still describes what is on-chain. To rebuild the exact v1 wasm, check out the commit before this lane's change.

## Cost estimate (testnet NEAR)

Using the same formula as `scripts/setup-testnet.ts` (`ceil(bytes / 100 KB)` NEAR for code + `CONTRACT_STATE_BUFFER_NEAR` 0.2):

| Item | NEAR |
|---|---|
| `hub-v2` account (232,602 B → 3 + 0.2) | 3.2 |
| `hive-v2` account (161,424 B → 2 + 0.2) | 2.2 |
| Treasury `fund_treasury` (`TREASURY_FUND_NEAR` default) | 0.5 |
| New FC keys on the 6 existing agents (gas only, paid by each agent's balance) | ~0.003 |
| Roles, workers, init, lock, self-check txs (gas) | ~0.05 |
| **Total from root** | **≈ 5.95** (the script's pre-flight also wants a 0.3 gas margin → **≈ 6.25**) |

**Root balance, read live 2026-11-14: 3.4405 NEAR. That is NOT enough.** A top-up of at least **~3 testnet NEAR** is needed first (browser faucet: https://near-faucet.io/ or https://docs.near.org/faucet, account `hivefund-2026.testnet`). Even the bare code-storage minimum (2.33 + 1.62 NEAR + 0.5 treasury ≈ 4.5 NEAR) exceeds the current balance.

## Exact steps (only after confirmation)

Run from the repo root in PowerShell.

**0. Preconditions**
- `AWAIT_CONFIRMATION.md` answered "deploy v2".
- Root balance ≥ 6.3 NEAR:
  ```powershell
  npx tsx scripts/topup.ts status
  ```
- Clean build:
  ```powershell
  powershell -File scripts/build-contracts.ps1
  ```
  Confirm the sha256 values above.

**1. Back up the v1 record and keys** (nothing is lost if anything goes wrong):
```powershell
Copy-Item config/deployment.testnet.json config/deployment.testnet.v1.json
Copy-Item .env.local .env.local.v1.bak   # gitignored (.env.*); never commit
```

**2. Give the agents fresh v2 keys.** `setup-testnet.ts` reuses an agent's key from `.env.local` and skips it if that key already exists on-chain. The v1 keys are scoped to the v1 hub, so the 6 FC key lines must be removed for the script to generate and add new keys scoped to `hub-v2`. It adds them with the root recovery key that every agent holds.

Bid-signing keys (`WORKER_*_BID_KEY`) are kept and reused.
```powershell
node -e "const f='.env.local';const fs=require('fs');const drop=['COORDINATOR_KEY','VERIFIER_KEY','WORKER_CHEAP_KEY','WORKER_QUALITY_KEY','WORKER_ADAPTIVE_KEY','WORKER_FORGER_KEY'];fs.writeFileSync(f,fs.readFileSync(f,'utf8').split(/\r?\n/).filter(l=>!drop.some(k=>l.startsWith(k+'='))).join('\n')+'\n')"
```
The v1 FC keys stay valid on-chain, and their secrets stay in `.env.local.v1.bak`.

**3. Dry run, then deploy v2**, using the existing prefix overrides `HUB_PREFIX` / `TOKEN_PREFIX`:
```powershell
$env:HUB_PREFIX="hub-v2"; $env:TOKEN_PREFIX="hive-v2"
npx tsx scripts/setup-testnet.ts --dry-run
npx tsx scripts/setup-testnet.ts
```
This does the following:
- creates `hub-v2` and `hive-v2`;
- deploys and inits `hive-v2.new(owner_id=root, minter_id=hub-v2)` and `hub-v2.init(owner=root, hive_token_account=hive-v2, treasury_budget_yocto=1 NEAR, mint_rate=1e16)`;
- sets the coordinator and verifier;
- runs `add_worker` for cheap (tier 1), quality (tier 3), adaptive (tier 2) and forger (tier 1);
- funds the treasury with 0.5 NEAR;
- adds FC keys scoped to `hub-v2` (coordinator: `post_bounty`, `select_winner`, `reject_bid`, `cancel_bounty`; verifier: `verify_bounty`; workers: `place_bid`, `submit_work`; allowance `FC_ALLOWANCE_NEAR`);
- runs the self-check;
- writes `config/deployment.testnet.json`, which is now the v2 record (see step 6).

**4. Lock** (irreversible):
```powershell
npx tsx scripts/lock-config.ts --hub hub-v2.hivefund-2026.testnet --token hive-v2.hivefund-2026.testnet
npx tsx scripts/lock-config.ts --hub hub-v2.hivefund-2026.testnet --token hive-v2.hivefund-2026.testnet --confirm
```
The script refuses to lock the token unless its minter is `hub-v2`.

**5. Prove the lock on-chain** (record the tx hashes):
```powershell
near contract call-function as-read-only hub-v2.hivefund-2026.testnet is_config_locked json-args '{}' network-config testnet now
near contract call-function as-read-only hive-v2.hivefund-2026.testnet is_config_locked json-args '{}' network-config testnet now
# expected to FAIL with ERR_CONFIG_LOCKED:
near contract call-function as-transaction hub-v2.hivefund-2026.testnet set_mint_rate json-args '{"mint_rate":"1"}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as hivefund-2026.testnet network-config testnet sign-with-legacy-keychain send
near contract call-function as-transaction hive-v2.hivefund-2026.testnet set_minter json-args '{"minter_id":"hivefund-2026.testnet"}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as hivefund-2026.testnet network-config testnet sign-with-legacy-keychain send
```
Optionally prove minting still works by running one bounty against v2: `npm run demo -- --mode testnet`. The agents read the hub from `config/deployment.testnet.json`.

**6. Config files.** Recommended: keep the dashboard on v1.
```powershell
Move-Item config/deployment.testnet.json config/deployment.testnet.v2.json
Copy-Item config/deployment.testnet.v1.json config/deployment.testnet.json
Copy-Item .env.local .env.local.v2.bak
Copy-Item .env.local.v1.bak .env.local
```
Expected `config/` result:
- `deployment.testnet.json` is unchanged v1, and stays primary for the dashboard and agents.
- `deployment.testnet.v1.json` is an identical backup.
- `deployment.testnet.v2.json` is new, with `hub: hub-v2…`, `token: hive-v2…`, the new wasm hashes, the v2 txs and the self-check.

Add the four step-5 tx hashes under a `lockTxs` key by hand. Use only the real hashes printed.

## Impact on the recorded run and the dashboard

- **v1 history is untouched:** bounties #0–#6, 1.6599 HIVE, `data/testnet-run/` and all README tx links.
- **The dashboard shows the bundled recorded run only when its `manifest.hub` equals the configured hub** (`web/src/lib/server/data.ts`, `recordedFor(hub)`). Pointing the dashboard or Vercel env (`NEXT_PUBLIC_HUB_CONTRACT`, `NEXT_PUBLIC_TOKEN_CONTRACT`) at `hub-v2` would therefore show an **empty** market with no history. That's why step 6 keeps v1 primary.
- **README / CLAIMS:** after a successful v2 deploy and lock, the honest claim is: "v2 contracts with a verified, irreversible config lock are deployed at `hub-v2` / `hive-v2` (tx …); the demo history runs on v1, which has no lock." Until then the claim stays "implemented in code, not deployed".

## Rollback

- v1 is never modified, so there's nothing to roll back there. Restore `config/deployment.testnet.json` and `.env.local` from the step-1 backups.
- The lock itself **cannot** be undone on v2 (by design).
- To abandon v2 entirely and recover most of its NEAR, delete the v2 contract accounts with the root as beneficiary. Use their full-access key: the setup script creates them with the root key.
  ```powershell
  near account delete-account hub-v2.hivefund-2026.testnet beneficiary hivefund-2026.testnet network-config testnet sign-with-legacy-keychain send
  near account delete-account hive-v2.hivefund-2026.testnet beneficiary hivefund-2026.testnet network-config testnet sign-with-legacy-keychain send
  ```
- The extra `hub-v2`-scoped FC keys on the agent accounts are harmless; remove them with `near account delete-keys` if wanted.
