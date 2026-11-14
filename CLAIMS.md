# CLAIMS — source of truth for Lane A

Every claim in `README.md` (intro, What it is, Track mapping, NEAR features used) plus the token/admin-mint claims in `RULES.md` and `docs/MECHANICS.md`. Evidence is a file path or a real hash from `config/deployment.testnet.json` / `data/testnet-run/tx.jsonl`. Recorded at commit `1f1611e`.

Status: **supported** = code and/or on-chain evidence exists · **needs change** = wording overstates or is stale · **unsupported** = no code/tx behind it.

## Intro / token claims

| # | Claim | Evidence | Status | Note |
|---|---|---|---|---|
| 1 | Each agent runs under its own NEAR sub-account | `config/deployment.testnet.json` (`coordinator`, `verifier`, `workers`), `scripts/setup-testnet.ts` | supported | |
| 2 | Each agent holds a function-call key limited to its own methods | `scripts/setup-testnet.ts:255`; `config/deployment.testnet.json` `selfCheck.results` (18/18 ok) | supported | |
| 3 | Coordinator checks every bid's signature and picks a winner with a published formula | `agents/coordinator/src/coordinator.ts:150`; `RULES.md`; reject tx in `data/testnet-run/tx.jsonl` line 10 | supported | |
| 4 | Verifier grades with acceptance tests + NEAR AI Cloud rubric and writes the report hash on-chain | `agents/verifier`; `contracts/bounty-hub/src/lib.rs:697` (`verify_bounty`); tx `J48nSqTgdVx824CD2TUaZ2gVKuZgCErfF5QaGCiS5zKY` | supported | |
| 5 | Payment happens only after a passing verdict | `contracts/bounty-hub/src/lib.rs:697`; fail tx `5bsVDbGxVyYgoooBCaKCpYGMejvNpsRC8qU35YniFabR` (no payout) | supported | |
| 6 | HIVE mint = `winning_bid_units × score / 100 × mint_rate`, and no account but the hub can call `mint` | `contracts/bounty-hub/src/lib.rs:134` (`mint_amount`); `contracts/hive-token/src/lib.rs:74-76` (`ERR_NOT_MINTER`) | supported | |
| 7 | Owner keeps `set_minter` and `set_mint_rate` (disclosed in README) | `contracts/hive-token/src/lib.rs:94`; `contracts/bounty-hub/src/lib.rs:434` | supported | Correct disclosure |
| 8 | `RULES.md` (committed): "There is no admin mint" | `RULES.md` §7 (working tree) | supported | Reworded to disclose `set_minter`/`set_mint_rate` and the undeployed `lock_config`; committed in Phase 2 |
| 9 | `docs/MECHANICS.md` (committed): "Neither contract has an admin mint" | `docs/MECHANICS.md:29` (working tree) | supported | Discloses admin keys; Lane C added the `lock_config` section (implemented, not deployed); committed in Phase 2 |
| 10 | `docs/PLAN.md`: "no admin mint key" / "there is no admin mint" | `docs/PLAN.md:34`, `docs/PLAN.md:199` | supported | Lane A: reworded to "no account but the hub can call `mint`; owner keeps admin keys" |

## What it is

| # | Claim | Evidence | Status | Note |
|---|---|---|---|---|
| 11 | bounty-hub: treasury/escrow, bounties, bids, roles, verdicts, payouts, HIVE mint via cross-contract call + callback, activity log, supply history | `contracts/bounty-hub/src/lib.rs` (`fund_treasury` :327, `place_bid` :524, `verify_bounty` :697, `on_mint_complete` :843); `views.rs:78` | supported | |
| 12 | hive-token: NEP-141 via near-contract-standards; `mint` only by the hub | `contracts/hive-token/src/lib.rs:12,74`; `contracts/Cargo.toml:13` (5.30.1) | supported | |
| 13 | Coordinator posts bounties, verifies signatures, rejects forged bids on-chain, scores, selects | `agents/coordinator/src/coordinator.ts`; tx `FSFeuRkABATYE54XPTWr1xkigA3oSZyvTBqHjhi3XuH4` | supported | |
| 14 | Workers decide independently, sign bids, produce deliverables with NEAR AI; adaptive changes margin and logs reason | `agents/worker-core/src/strategy.ts`, `agents/worker-*`; `data/testnet-run/strategy/` | supported | |
| 15 | Forger signs with the wrong key; forged bids rejected | `agents/coordinator/src/forger.ts`; tx `CrZYDzyk7tRJEMXFHoAnr1F4YYh7rdgwJ11XRL6JUs1Y` → `FSFeuRkABATYE54XPTWr1xkigA3oSZyvTBqHjhi3XuH4` | supported | |
| 16 | Verifier order: schema/sections → test command → LLM rubric | `agents/verifier/src` | supported | |
| 17 | Content-addressed off-chain store referenced by on-chain hashes | `agents/shared/src/node/store.ts`; `data/testnet-run/offchain/` | supported | |
| 18 | Dashboard reads live testnet contracts; "Swarm Arena replay"; wallet sign-in can fund treasury | `web/src/lib/rpc.ts`; `web/src/components/town/`; `web/src/components/fund-treasury.tsx:9` | supported | Lane A: README now says isometric pixel town; wallet funding "implemented, not exercised in the recorded testnet run" |

## Track mapping

| # | Claim | Evidence | Status | Note |
|---|---|---|---|---|
| 19 | AI Swarms: six agents, each its own sub-account | `config/deployment.testnet.json` | supported | |
| 20 | AI Swarms: FC keys limit roles (coordinator 4, verifier 1, workers 2) | `config/deployment.testnet.json` selfCheck lines 139–159; tx `7sdtnTVkZWz5fWzN5VBVYyNJ9MuQTWvGwRYjHdRe9Fb9` | supported | |
| 21 | AI Swarms: workers bid independently with different strategies; no hard-coded winner | `agents/worker-core/src/pricing.ts`, `agents/shared` selection code | supported | |
| 22 | AI Swarms: adaptive keeps last 5 outcomes, margin within [0.05, 0.50], logs each change | `agents/worker-core/src/strategy.ts:2,11` | supported | |
| 23 | AI Swarms: coordinator verifies ed25519 signatures vs on-chain keys, rejects with on-chain record | `agents/coordinator/src/coordinator.ts:150`; `reject_bid` `contracts/bounty-hub/src/lib.rs:606` | supported | Off-chain verify (disclosed in Known limitations) |
| 24 | AI Swarms: verifier gates payment; report hash on-chain | `verify_bounty` `contracts/bounty-hub/src/lib.rs:697` | supported | |
| 25 | AI Swarms: rules before code; offline no-LLM mode; live dashboard | `RULES.md`; `package.json:18` (`demo:mock`); `web/` | supported | |
| 26 | Memecoins: supply set by verified outcomes, computed in contract | `contracts/bounty-hub/src/lib.rs:134,697` | supported | Lane A: README row added citing `docs/HIVE_SIMULATION.md` / `npm run simulate:supply` |
| 27 | Memecoins: only the hub can mint (owner can rotate minter / change rate) | `contracts/hive-token/src/lib.rs:74-76,94`; `contracts/bounty-hub/src/lib.rs:434` | supported | Wording already discloses admin keys |
| 28 | Memecoins: every mint traced (`get_supply_history`) | `contracts/bounty-hub/src/lib.rs:873` (`SupplyPoint`); `views.rs:78` | supported | |
| 29 | Memecoins: failed mints don't double-count (pending mint + callback, `retry_mint`) | `contracts/bounty-hub/src/lib.rs:75,783,843,917` | supported | Unit-tested; never triggered on testnet |
| 30 | Agent Economy (supporting): procurement — agents recommend paid compute under a USD budget; verifier re-fetches live prices and makes one real paid call | `bounties/procurement/`, `agents/shared/src/procurement.ts`; tx `7hwNRWpJDr5zcUcYyd3vzcuzUsi44G58yfGdFmacvwG5` (bounty #4) | supported | Lane A: rows now cite #4 (`7hwNRWpJ…`) and `npm run procure` / #6 (`88P2r6wq…`, `GdcPTRuh…`, both in `tx.jsonl`); README states the paid call is billed to the API key |
| 31 | Social Money: not claimed | — | supported | Correct as written |
| 31a | Agent Economy: coordinator hires a worker per bounty, winner paid in NEAR from escrow with on-chain receipt | `select_winner`, `verify_bounty` in `contracts/bounty-hub/src/lib.rs`; tx `J48nSqTgdVx824CD2TUaZ2gVKuZgCErfF5QaGCiS5zKY` | supported | Added by Lane A |
| 31b | Agent Economy: Agent API spending-limit check | `agents/shared/AGENTAPI_NOTES.md` | dropped (not claimed) | Lane B stopped: API is mainnet-only, needs owner-signed agent + key, wouldn't govern contract escrow. README track row removed; listed under Known limitations as future work |
| 31c | Memecoins: `lock_config` admin-key lock | contracts working tree (Lane C) | implemented in code, not deployed | 76 + 14 contract tests pass. Decision 2026-11-14: keep v1 (`AWAIT_CONFIRMATION.md`); README/MECHANICS/RULES say not deployed |
| 31d | Open Innovation (optional): token minted only by AI-verified work, auditable on-chain | `verify_bounty`; `docs/HIVE_SIMULATION.md` | supported | Modest claim, added by Lane A |

## NEAR features used

| # | Claim | Evidence | Status | Note |
|---|---|---|---|---|
| 32 | Sub-accounts for six agents + two contracts under `hivefund-2026.testnet` | `config/deployment.testnet.json` | supported | |
| 33 | FC keys scoped to hub with method lists; allowance 0.05 at deploy, now 0.1 | `config/deployment.testnet.json` selfCheck (0.05); rekey txs `DzcrzPtjj9Eq9fZjZfWypYaSX3VomLmyFG5XXE5JMEYf`, `2qWf4DJiBSgWMfaWZ3M53xyDdjM3XCEPhF4k6jFz6EeM`, `JAnKs1WVVNVXSoxGsxpso8cboPGUFnvDm3f95wnXU7g2`, `AtuXqmSxvN2mU6KTNsMmxYWA6evPcKTh6xfVR5J2hNuy`, `9BypHhbiBwaF6FatwoAUXLVwq9AWzregZT3KqTZbu6ur`, `6d7jooPSgZeLCaRa1oDugQ1PkuVwWkshaKSX6jioe4t` | supported | Rekey hashes are in README only, not in `config/deployment.testnet.json` |
| 34 | Root public key kept on agents as recovery key; `AGENT_RECOVERY_KEY=none` option | `scripts/setup-testnet.ts`; `docs/notes/stream-a.md` | supported | |
| 35 | NEP-141 on near-contract-standards 5.30.1 (FungibleToken, storage, metadata, FtMint) | `contracts/Cargo.toml:13`; `contracts/hive-token/src/lib.rs:12,85` | supported | |
| 36 | Cross-contract `verify_bounty` → `hive-token.mint` → `#[private] on_mint_complete`, pending-mint record, `MintFailed` | `contracts/bounty-hub/src/lib.rs:697,783,843` | supported | |
| 37 | NEAR AI Cloud: `z-ai/glm-5.3-flash` (cheap, adaptive, verifier) and `deepseek/deepseek-v3.2` (quality); structured `json_schema` | `agents/worker-core/src/llm.ts:7`; `agents/worker-quality/src/index.ts:15`; `agents/shared/src/node/llm.ts:100` | supported | |
| 38 | near-connect wallet sign-in on testnet; `fund_treasury` sent from the dashboard | `web/src/providers/near-provider.tsx`; `web/src/components/fund-treasury.tsx` | supported | Lane A: README says implemented, not exercised; treasury funded by setup script (tx `9VtuvA17sKd65g94p1SZyx54SKKG42FtdkBTFhi3wt2T`) |
| 39 | near-api-js 7.4; browser views via fastnear with drpc fallback | `agents/shared/package.json:15`; `web/src/lib/rpc.ts:13` | supported | Lane A: README now says fastnear → drpc → `rpc.testnet.near.org` |
| 40 | NEAR Intents and Chain Signatures are not used | — | supported | Correct disclosure; nothing to remove |

## Summary

- Total claims: **44** (40 original + 31a–31d added by Lane A)
- Supported: **40**
- Needs change: **0**
- Implemented, not deployed (stated as such in README): **1** (#31c `lock_config`)
- Dropped / not claimed: **1** (#31b Agent API)
- Unsupported: **0**

_Updated by Lane A and Phase 2 (2026-11-14). Original Phase 0 counts: 34 supported, 6 needs change, 0 unsupported._

### Needs change (Phase 0 list, all resolved by Lane A / Phase 2)
1. #8 `RULES.md` — commit the working-tree fix (admin keys disclosed).
2. #9 `docs/MECHANICS.md` — commit the working-tree fix.
3. #10 `docs/PLAN.md:34,199` — "no admin mint" in the planning doc.
4. #18 README "What it is": "Swarm Arena replay" → isometric town; wallet funding not exercised end-to-end.
5. #38 README "NEAR features": `fund_treasury` from dashboard implemented but not exercised in the recorded run.
6. #39 README: RPC fallback wording (drpc, then rpc.testnet.near.org).
7. (Accuracy add, not a fix) #26/#30: add `docs/HIVE_SIMULATION.md` to Memecoins and `npm run procure` / bounty #6 to Agent Economy if those tracks are ticked.
