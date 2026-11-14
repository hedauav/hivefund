# AWAIT_CONFIRMATION — contract redeploy decision (Lane C stopped here)

> **Decided 2026-11-14: Keep v1.** See the DECISION section at the end.

**Nothing has been deployed and `lock_config` has not been called on any account.** A human must choose one option below.

## What exists now
- `lock_config()` is implemented in both contracts and unit-tested: bounty-hub 76 tests (71 existing + 5 new), hive-token 14 (9 + 5). After the lock, `set_mint_rate` and `set_minter` panic `ERR_CONFIG_LOCKED`; the hub still mints; non-hub mints still panic `ERR_NOT_MINTER`.
- The **live** testnet contracts (`hub.hivefund-2026.testnet`, `hive.hivefund-2026.testnet`) run v0.1 code **without** the lock. They can't be upgraded in place, because the new state field breaks the storage layout.

## The decision

### Option A: deploy v2 + lock (see `DEPLOY_PLAN.md`)
- New accounts `hub-v2` and `hive-v2`, deployed and then locked irreversibly; the agents get extra keys for `hub-v2`.
- **Needs ≈ 6.3 testnet NEAR. Root has 3.44.** You must top up ~3 NEAR from a browser faucet first (https://near-faucet.io/, account `hivefund-2026.testnet`).
- About 20–30 minutes plus faucet time. HIVE v2 starts at supply 0.
- The demo history stays on v1, and the dashboard stays pointed at v1. Otherwise it would show an empty market.
- **Gain:** the Memecoins "no admin keys over minting" claim can be stated as true for v2, with on-chain proof (`is_config_locked = true` plus failed `set_mint_rate` / `set_minter` txs).

### Option B: keep v1, document the limitation (no deploy)
- Nothing on-chain changes. The README and MECHANICS say: "the lock is implemented and tested in code, not deployed; the live contracts still have owner admin keys".
- Zero cost and zero risk on deadline day. The Memecoins track keeps the admin-key caveat.

## Lane C recommendation
**Option B for the submission**, unless you can top up ~3 testnet NEAR and spend about 30 minutes. In that case Option A is low-risk, because v1 is never touched.

Reply with **"deploy v2"** or **"keep v1"**.

---

## DECISION (recorded 2026-11-14): **Keep v1 (Option B)**
- Chosen by the project owner in the session on 2026-11-14.
- Reasons: the root account had only ~3.44 testnet NEAR (Option A needs ~6.3) and the submission deadline is 2026-11-14 23:59 UTC.
- Result: `lock_config()` stays **implemented and unit-tested in code, not deployed**. The live contracts `hub.hivefund-2026.testnet` / `hive.hivefund-2026.testnet` keep the owner admin keys (`set_minter`, `set_mint_rate`), documented as a known limitation in README, MECHANICS and RULES.
- `DEPLOY_PLAN.md` remains as the procedure for a later v2 deployment. No account was created, nothing was deployed, and `lock_config` was not called.
