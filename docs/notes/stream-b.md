# Stream B notes: shared node layer, coordinator, demo runner, tests

## What's where

| Path | What |
|---|---|
| `agents/shared/src/node/hub.ts` | `HubClient` interface, `NearHubClient` (the main path), `HubCallError`, `hubErrorCode`, `txUrl` |
| `agents/shared/src/node/mock-chain.ts` | `MockChain` / `MockHubClient`: in-memory port of bounty-hub + hive-token. **Unit tests / offline dev only.** |
| `agents/shared/src/node/store.ts` | `OffchainStore`: content-addressed objects, strategy logs, tx log, snapshot export |
| `agents/shared/src/node/llm.ts` | NEAR AI Cloud chat (`chat`, `chatJson`, `chatJsonFull`) |
| `agents/shared/src/node/config.ts` | `loadEnv`, `getMode` (default **testnet**), `dataDir`, `loadDeployment`, `requireEnv` |
| `agents/shared/src/node/agent.ts` | `AgentContext`, `createTestnetMarket()` (main path), `createMockMarket()` (tests) |
| `agents/shared/src/node/snapshot.ts` | `readChainState(hub, token, source)`: every view in one JSON |
| `agents/shared/src/{selection,spec}.ts` | `scoreBids` (selection formula, also usable in the browser), spec/deliverable/report validators |
| `agents/coordinator/src/coordinator.ts` | `Coordinator`: `postBounties()`, `tick()` (signature check → `reject_bid` forgeries → score → `select_winner`) |
| `agents/coordinator/src/forger.ts` | adversarial worker that signs bids with the wrong key |
| `agents/coordinator/src/run.ts` | `runMarket(market)`: one full lifecycle; shared by demo, sample and e2e |
| `agents/coordinator/src/demo.ts` | `npm run demo` (testnet by default) |
| `agents/coordinator/src/loop.ts` | `npm run agent -- <name>`: one agent per process, polling every 5 s |
| `agents/coordinator/src/sample.ts` | `npm run sample`: regenerates `data/sample/` (UI fixture) |
| `tests/unit/*.test.ts`, `tests/e2e/e2e.test.ts`, `tests/lib/invariants.ts` | node:test suites |

## Commands

```bash
npm run demo                 # TESTNET (needs config/deployment.testnet.json + agent keys in .env.local)
npm run demo -- --steps 12 --no-forger --export-dir web/public/offchain
npm run demo:mock            # offline simulation: in-memory chain, no LLM (dev only, data in data/mock/)
npm run agent -- verifier    # run a single agent as a long-lived process on testnet
npm run sample               # regenerate data/sample (UI fixture, labelled SAMPLE)
npm test                     # unit + mock e2e (testnet e2e is skipped)
npm run test:testnet         # e2e + role tests against the deployed testnet contracts
```

## Testnet is the main path

- `npm run demo` defaults to `--mode testnet`. Without a deployment it exits with a clear message; it never falls back to mock on its own.
- `NearHubClient`:
  - one instance per agent, each with its own function-call key from `.env.local`;
  - RPC failover: `config.rpcUrl` (fastnear) → `https://near-testnet.drpc.org`;
  - transient errors (network, 429/5xx, timeouts, InvalidNonce, expired tx) are retried with backoff;
  - calls are serialized per client, so one access key never races its own nonce;
  - a tx that landed, or a contract panic, is never resent.
- Every call, success or failure, goes to `data/tx.jsonl` as `{ts, actor, contract, method, args, txHash, ok, error?, explorer}`, where `explorer` is `https://testnet.nearblocks.io/txns/<hash>`. The demo summary prints those links.
- At the end of a run the demo writes `data/chain-state.json` (`source: "testnet"`). It then exports `data/` (offchain objects, strategy logs, `tx.jsonl`, `index.jsonl`, `chain-state.json`) to `web/public/offchain/` for the dashboard.
- LLM: agents use NEAR AI Cloud when `NEARAI_API_KEY` is set (testnet mode). Mock mode always passes `llm: null`, so reports there honestly say `rubric.mode = "fallback"`.
  - `chat()` disables GLM thinking by default (`chat_template_kwargs.enable_thinking=false`), or takes `thinkingTokenBudget`.
  - It supports strict `json_schema` and a per-call `model`, and returns `{content, model, usage}`.
  - The key is never logged.

## `data/` layout (same for testnet runs, `data/mock/` and `data/sample/`)

```
data/
  offchain/<sha256>.json   canonical JSON of a spec | deliverable | report | selection; sha256(file bytes) == name
  index.jsonl              {hash, kind, bounty_id, round, actor, ts} per stored object
  strategy/<worker>.jsonl  StrategyChange per line (adaptive worker's margin/quality changes + reason)
  tx.jsonl                 one TxLogEntry per hub call (see above)
  chain-state.json         ChainState: {source, captured_at, hub, token, config, treasury, bounties, bids{id:[]},
                           reputation, activity, supply_history, pending_mints, token_state{ft_total_supply, balances}}
```

`data/sample/` is **only a UI fixture**:
- `chain-state.json` carries `"sample": true` and a `notice`;
- tx hashes are `mock-<n>` and `SAMPLE.md` explains this;
- it uses the minimal budgets (treasury 0.5 NEAR funded, 1 NEAR cap, bounties 0.1 / 0.05 NEAR, mint_rate 1e16);
- the web app must label it as sample data whenever it renders it.

## Agent contract (Stream C packages as built)

- **Workers:** `createCheapWorker` / `createQualityWorker` / `createAdaptiveWorker` take `{accountId, contract, bidKey, now, log, llm?}` and return a `Worker` whose method is `tick(hub, store)`.
- **Verifier:** `new Verifier({accountId, now, log, llm?})`, then `.tick(hub, store)`.
- **Loader:** `agents/coordinator/src/agents.ts` builds these from a `Market`. In mock mode it passes `llm: null`.

## Coordinator behaviour

1. **Post:** for each `/bounties/*.json` spec, `store.put(spec)` returns the `spec_hash`. Then `post_bounty(title, spec_hash, budget_yocto, now + deadline_minutes, min_tier)`. A spec that is already live on-chain (same hash, not terminal) is skipped.
2. **Check signatures:** for each Pending bid in the current round, rebuild the canonical `bidPayload` and require `signed_payload` to equal it. Then `verifyBid(signed_payload, signature, signing_pk from get_reputation)`. A failure calls `reject_bid(..., "invalid bid signature")`, which is on-chain and logged.
3. **Bid window:** select once there are 3 valid bids or 90 s have passed. The demo forces selection each step, because every agent acts within one step.
4. **Score:** `scoreBids` uses price 0.5, eta 0.2 and reputation 0.3; ties go to the lower price. The result goes to `store.put(SelectionRationale)`, then `select_winner`.

## Test coverage (`npm test`: 16 pass, 2 testnet tests skipped unless `HIVEFUND_E2E_TESTNET=1`)

- **Shared:**
  - golden vector, bid sign/verify (forged, tampered and garbage inputs are rejected);
  - mint math with the demo budgets: 0.08 NEAR @ 80 → 640000000000000000 (0.64 HIVE);
  - canonicalize, store re-hash mismatch, fixture validity, selection formula, error/env helpers.
- **MockChain:**
  - roles: coordinator cannot verify, verifier cannot select, non-worker cannot bid, owner-only calls, role conflicts;
  - post errors and escrow;
  - every bid rejection reason;
  - fail → exclude → reopen → rebid → pass, with treasury, reputation and supply math;
  - 2 fails → Cancelled with a refund;
  - MintFailed → `retry_mint`, and no admin mint of HIVE;
  - `cancel_bounty` / `reject_bid`.
- **e2e (mock):** real Stream C agents plus the forger. The forgery is rejected on-chain, an automated test fails, the bounty reopens and is rebid, then passes, pays out and mints. Every on-chain hash resolves to an off-chain object, the adaptive worker logs strategy changes, and the market invariants hold (`tests/lib/invariants.ts`).
- **e2e (testnet):** the same invariants on real transactions:
  - every successful tx has an explorer link;
  - roles are refused at the function-call-key layer and by the contract (owner calling `verify_bounty` gets `ERR_NOT_VERIFIER`, `select_winner` gets `ERR_NOT_COORDINATOR`, `place_bid` gets `ERR_NOT_WORKER`).

## Assumptions Stream A should match (mock = contract)

- **Panic messages** start with the ERR code.
- **`post_bounty` checks**, in order:
  1. title 1..=120 (`ERR_TOO_LONG`);
  2. `spec_hash` is 64 hex (`ERR_BAD_HASH`);
  3. `min_tier` 1..=3 (`ERR_BAD_TIER`);
  4. budget > 0, then ≤ available (`ERR_TREASURY_INSUFFICIENT`);
  5. spend cap (`ERR_SPEND_CAP`);
  6. deadline (`ERR_DEADLINE_PAST`).
- **`reject_bid` on a non-Pending bid:** `ERR_BID_NOT_SELECTABLE`.
- **`select_winner` when the bounty is not Bidding:** `ERR_BAD_STATUS`.
- **`cancel_bounty` by a non-poster:** `ERR_NOT_POSTER`.
- **On select,** the other Pending bids of the round become `Lost`. **On reopen,** any still-Pending bids become `Superseded`.
- **`place_bid` returns** the bid id, for rejected bids too.
- **`get_reputation({})`** returns all workers, each including `signing_pk`.
- **Supply-point timestamps:** the mock mints synchronously inside `verify_bounty`. On-chain the `SupplyPoint` comes from `on_mint_complete` in a later receipt, and the `chain-state` reads happen after the tx completes.
