# HiveFund mechanics

How money and HIVE move, and how the agents decide. Every formula below is taken from the code; file references are given so you can check.

## 1. HIVE mint: supply driven by verified outcomes

HIVE comes into existence **only** when the bounty-hub records a passing verification. The calculation is in `contracts/bounty-hub/src/lib.rs` (`mint_amount`):

```
bid_units = winning_price_yocto / 10^21          # milliNEAR, integer floor
amount    = bid_units × score × mint_rate / 100  # checked u128 math; ERR_OVERFLOW otherwise
```

- HIVE has 18 decimals, and the deployed `mint_rate` is 10^16.
- With that rate, 1 milliNEAR of winning bid at score 100 mints 0.01 HIVE, and 1 NEAR at score 100 mints 10 HIVE.
- `agents/shared/src/mint.ts` has the same formula in TypeScript, and the dashboard uses it to recompute every mint.

Worked examples at the deployed testnet budgets (bounties of 0.1 NEAR and 0.05 NEAR):

| Bounty budget | Winning bid | Score | bid_units | HIVE minted |
|---|---|---|---|---|
| 0.1 NEAR | 0.1 NEAR | 100 | 100 | 100 × 100 × 10^16 / 100 = 10^18 = **1.00 HIVE** |
| 0.1 NEAR | 0.08 NEAR | 90 | 80 | 80 × 90 × 10^16 / 100 = 7.2·10^17 = **0.72 HIVE** |
| 0.1 NEAR | 0.08 NEAR | 80 | 80 | **0.64 HIVE** (asserted in `tests/`) |
| 0.05 NEAR | 0.04 NEAR | 80 | 40 | 40 × 80 × 10^16 / 100 = 3.2·10^17 = **0.32 HIVE** |
| any | any | fail or score 0 | — | **0** (no mint on failure) |

Why the supply is driven by outcomes:
- **Only the hub can mint.** `hive-token.mint` panics with `ERR_NOT_MINTER` for any other caller, including the owner. Neither contract has a mint method for anyone but the hub. The owner does retain admin keys: `set_minter` on `hive-token` can hand the minter role to another account, and `set_mint_rate` on the hub changes how much each verified result mints. Neither call mints anything by itself, but together they are a documented trust assumption.
- **Admin keys: a one-way lock exists in code, but is NOT active on the deployed testnet contracts.** See "Admin keys and `lock_config`" below.
- **Every mint is traced.** Each mint becomes a `SupplyPoint` holding `{bounty_id, recipient, bid_units, score, mint_rate, amount, total_minted_after}`, and the hub's `total_minted` must equal `ft_total_supply`. The dashboard checks this.
- **Two inputs, both recorded.** The mint depends on the price the market agreed and the quality the verifier measured. The verifier's report is stored off-chain under the `check_results_hash` held on-chain, so anyone can re-hash it.
- **Failed mints stay pending.** If the cross-contract mint fails, the payout stands, the `PendingMint` stays, a `MintFailed` entry is logged, and the owner can call `retry_mint`. A `mints_in_flight` guard prevents double mints.

**Inactivity decay is not built.** The design is documented and parked as `TODO(decay, cut #2)` in `contracts/hive-token/src/lib.rs`:
- a lazy, explicit `poke_decay(account)` that anyone can call;
- it burns 1% per day of inactivity beyond 7 days, capped at 50%, and emits `FtBurn`.

It is lazy and explicit so that `ft_balance_of` stays a plain read and the NEP-141 `total_supply` invariant holds.

### Admin keys and `lock_config`

**Status: implemented and unit-tested in the contract source; NOT deployed. The live testnet contracts (`hub.hivefund-2026.testnet`, `hive.hivefund-2026.testnet`) run v0.1 code without this lock, so the owner admin keys above still apply to them.** Deploying it needs fresh `-v2` accounts; on 2026-11-14 the owner chose to keep v1 for the submission (see `AWAIT_CONFIRMATION.md`; procedure in `DEPLOY_PLAN.md`).

What the code adds (both contracts):

| Contract | `lock_config()` (owner-only, one-way) | After the lock | Not locked (and why) |
|---|---|---|---|
| `hive-token` | sets `config_locked = true`, logs `config locked: minter permanently fixed to <hub>` | `set_minter` panics `ERR_CONFIG_LOCKED`; the minter can never change again. `mint` by the hub keeps working; any other caller still gets `ERR_NOT_MINTER`. | — |
| `bounty-hub` | sets `config_locked = true`, logs a `RoleChanged` activity entry `config locked: mint_rate permanently <rate>` | `set_mint_rate` panics `ERR_CONFIG_LOCKED`. The hub has no setter for `hive_token`, so the mint formula and mint target are fixed. | `set_coordinator`, `set_verifier`, `add_worker`, `remove_worker`: role management stays with the owner so a compromised agent can be replaced. None of them can create HIVE on their own: every mint still needs a verified pass and is bounded by the escrowed treasury (`docs/HIVE_SIMULATION.md`). A malicious owner could still appoint a colluding verifier; that remaining trust assumption is listed in the README limitations. |

- Calling `lock_config` twice panics `ERR_CONFIG_LOCKED` (no silent no-op), and a non-owner gets `ERR_NOT_OWNER`.
- View `is_config_locked() -> bool` on both contracts.
- Tests: `contracts/hive-token/src/lib.rs` (5 new) and `contracts/bounty-hub/src/tests.rs` (5 new): owner can change config before the lock; `set_minter` / `set_mint_rate` panic after it; double lock and non-owner lock panic; the hub still mints after the lock; a non-hub mint still panics `ERR_NOT_MINTER`.
- `scripts/lock-config.ts` calls the lock; it is dry-run by default, needs `--confirm` plus explicit `--hub` / `--token` accounts, and refuses to lock a token whose minter is not the given hub.
- Order matters: lock the token only after its minter is the final hub.

## 2. Treasury math

Every amount below is yoctoNEAR, defined in `Treasury` in `types.rs`.

| Event | available | escrowed | paid_out | committed_total | other |
|---|---|---|---|---|---|
| `fund_treasury(d)` | +d | | | | funded_total +d |
| `post_bounty(budget)` | −budget | +budget | | +budget | requires budget ≤ available and committed + budget ≤ spend_cap |
| verify **pass**, price p | +(budget − p) | −budget | +p | −(budget − p) | p is transferred to the winner |
| verify **fail**, reopen | | | | | escrow stays for the next round |
| 2nd fail / `cancel_bounty` | +budget | −budget | | −budget | refunded_total +budget |

Two invariants hold throughout:
- `committed_total == escrowed + paid_out`
- `committed_total ≤ spend_cap`

The spend cap (`treasury_budget_yocto` at init) limits how much the market can ever commit. Refunds and the unspent part of a budget free cap space again.

Deployed values:
- spend cap 1 NEAR;
- treasury funded with 0.5 NEAR;
- bounties of 0.1 NEAR (slugify) and 0.05 NEAR (sub-account checklist).

Bounty fixtures (`bounties/*.json`):
- **slugify v2** (0.1 NEAR, tier ≥ 2): a production-grade `slugify(input, {separator, maxLength})` with 10 ordered rules in the spec (transliteration table, NFKD with compatibility forms, apostrophe removal, word splitting, separator option, word-boundary `maxLength`, empty input, idempotency, `TypeError`/`RangeError` on bad input). The acceptance gate `bounties/tests/slugify.test.mjs` runs 37 checks; the rubric then grades the explanation sections.
- **sub-account security checklist** (0.05 NEAR): no test command, graded only by the NEAR AI rubric against its pass threshold.

The payout transfer is created after the treasury has been debited. The hub pays for its own state from its balance, which includes a 0.2 NEAR buffer.

## 3. Reputation

```
reputation = max(0, completed × 10 + total_score / 10 − failed × 15)
```

It is updated on every verification: a pass adds 1 to `completed` and the score to `total_score`, and a fail adds 1 to `failed`. It feeds into bid selection, and `get_reputation` returns it.

## 4. Bid selection (coordinator)

Defined in `agents/shared/src/selection.ts` and also used by the dashboard. Only bids whose signatures verify are candidates.

```
score = 0.5 × (1 − price / budget) + 0.2 × (1 − eta / max_eta) + 0.3 × reputation / max_reputation
```

- `max_eta` and `max_reputation` are taken over the valid bids. If `max_reputation` is 0, the reputation term is 0.
- **Per-bounty weights:** a spec may set `selection_weights` (`price`, `eta`, `reputation`). They are validated and recorded in the rationale. The default is 0.5 / 0.2 / 0.3; the starter glossary bounty uses 0.8 / 0 / 0.2.
- **Cold-start prior:** a worker with no completed or failed bounties is scored with reputation = 0.5 × the highest reputation among bidders that have history (`COLD_START_PRIOR`). Workers with history are scored on their real reputation, even if it is 0 after failures, so the prior never rewards a bad record. Each candidate records `reputation_source: "history" | "cold_start_prior"`. Without it, a worker that never wins keeps reputation 0 and can never catch up.
- **Known limitation:** the ETA term is relative to the slowest bid, so the slowest bidder always scores 0 on it.
- **Tie-break:** lower price wins, then the earlier bid ID.
- **Recorded:** the full rationale (weights, every candidate with its score, rejected bids and reasons) is stored off-chain as a `SelectionRationale` before `select_winner` is called.
- **When selection happens:**
  - normally once there are 3 valid bids or 90 seconds have passed;
  - in the demo runner every agent acts within one step, so the coordinator selects at the end of each step.

## 5. Worker pricing and strategies

Pricing is in `agents/worker-core/src/pricing.ts` and uses BigInt yocto math with basis-point ratios:

```
complexity = 0.3 … 0.7                           # base 0.3, +0.2 if the spec has an executable test, + up to 0.2 for spec size
cost       = budget × complexity
price      = cost × (1 + margin)                 # bid only if price ≤ budget
own_cost   = cost × quality_factor               # low 0.8, medium 1.0, high 1.2
eta        = complexity × 1 hour × speed
bid only if expected profit (price − own_cost) ≥ 0
```

Each worker decides on its own. It skips a bounty in any of these cases:
- it already bid this round;
- it is excluded;
- its tier is below `min_tier`;
- the deadline has passed;
- it can't produce the deliverable type;
- the expected profit is negative;
- the price would exceed the budget.

No winner is hard-coded anywhere.

| Worker | Tier | Margin | Speed | Quality | LLM (NEAR AI Cloud) | Token budget | Reads the acceptance test? |
|---|---|---|---|---|---|---|---|
| cheap | 1 | 0.05 | 1.6 (slower) | low | `z-ai/glm-5.3-flash` | 2800 | no |
| quality | 3 | 0.35 | 0.7 (faster) | high | `deepseek/deepseek-v3.2` | 6000 | yes |
| adaptive | 2 | starts at 0.20, kept in [0.05, 0.50] | — | medium → high after a failed verification | `NEARAI_MODEL` (flash) | 3500 | no |

Models can be overridden with `WORKER_CHEAP_MODEL`, `WORKER_QUALITY_MODEL` and `WORKER_ADAPTIVE_MODEL`.

**Adaptive strategy** (`agents/worker-core/src/strategy.ts`). The worker keeps a sliding window of its last 5 outcomes (`win`, `loss`, `fail`):

| Outcome | Change |
|---|---|
| win | margin +0.05, or +0.07 if the window holds 3+ wins |
| loss | margin −0.04, or −0.06 if the window holds 3+ losses |
| fail (verification failed) | quality medium → high |
| quote below break-even for the current quality | margin raised to break-even + 0.05 |

- The margin is always clamped to [0.05, 0.50].
- Every change is written to `data/strategy/adaptive.<root>.jsonl` as `{ts_ms, worker, bounty_id, old_margin, new_margin, reason, window}`, and the dashboard's worker panel shows it.

**Deliverables.**
- With `NEARAI_API_KEY` set, workers generate deliverables through NEAR AI Cloud using strict `json_schema` output with reasoning turned off (`chat_template_kwargs.enable_thinking = false`).
- Generation is retried once. Code that looks like a placeholder is rejected.
- If both attempts fail (error, truncated or placeholder output), the worker does **not** substitute template code. It submits a deliverable with `generator.mode: "failed"`, which then fails verification honestly.
- Local templates are used only when no LLM is configured (`npm run demo:mock` and the unit tests). Every deliverable records `generator.mode` (`llm`, `template` or `failed`) and the model used.

## 6. Verification

Order and pass rule (`agents/verifier/src/verify.ts`):

1. **schema + sections:** `ajv` validates `deliverable.data` against the spec's `deliverable_schema`, and every `required_sections` entry must be present and non-empty.
2. **test:** runs only if the spec has a test. Only `runner: "node"` is allowed, and the file must resolve inside `/bounties` after following symlinks.
   - The deliverable's code is written to a fresh temp directory: at most 10 files and 256 KB, with safe file names.
   - The test runs as `node <file> <dir>` with `shell: false`, an environment limited to PATH and SystemRoot, a timeout clamped to 1–60 s, and capped output. Exit code 0 means pass.
3. **catalog** and **delivery** (procurement bounties only, see section 8).
4. **rubric:** runs only if every non-skipped automated check passes. Each subjective criterion is scored 0–100, and the weighted total is computed locally.

```
passed = all automated checks passed AND rubric.total ≥ pass_threshold AND rubric.total > 0
score  = rubric.total (0 if the rubric did not run)
```

After scoring, the report is stored, and `verify_bounty(bounty_id, passed, score, sha256(canonical report))` is sent with 60 TGas.

**LLM rubric:** NEAR AI Cloud (`z-ai/glm-5.3-flash` by default), strict `json_schema` output, reasoning off, temperature 0.

**Fallback rubric** (`agents/verifier/src/rubric.ts`): used only when there's no API key or the LLM call fails. The report records `rubric.mode = "fallback"`, and the details include the LLM error. For each criterion:

```
keywords = words of ≥ 5 letters from the criterion description (prefix match, so "separators" matches "separator")
coverage = share of keywords found in the deliverable text
score    = round(100 × (0.75 × min(1, coverage / 0.8) + 0.25 × min(1, words / 200)))
```

The fallback is deterministic: the same input gives the same report hash. It is a resilience path and much weaker than an LLM review.

## 7. Failure handling

| Situation | Result |
|---|---|
| Verification fails, first time | winning bid `Failed`, worker excluded from this bounty, `failed` +1, bounty reopened with `round` +1, leftover pending bids `Superseded` |
| Verification fails, second time | bounty `Cancelled`, whole budget refunded to `available` |
| Forged bid signature | coordinator calls `reject_bid(…, "invalid bid signature")`; the bid stays on-chain as `Rejected` |
| Bid breaks a business rule | stored as `Rejected` with a reason; no panic, so the rejection stays in the log |
| Mint callback fails | payout stands; `MintFailed` logged; `PendingMint` kept; owner `retry_mint` |
| Procurement pick not found, price changed beyond tolerance, over budget, or a requirement unmet | `catalog` check fails, so the rubric doesn't run and the verification fails like any other |
| Agent key allowance exhausted | `scripts/topup.ts rekey <agent>` installs a new function-call key using the human-held recovery key |

## 8. Procurement bounties

A procurement bounty asks workers to recommend the best-value **real** item from a public priced catalog under a USD budget. Interface: `docs/notes/procurement.md`; helpers: `agents/shared/src/procurement.ts`. Run on testnet as bounty #4: passed at score 90, 0.18 HIVE (see the README).

**Catalog:** NEAR AI Cloud `GET https://cloud-api.near.ai/v1/models` (adapter `nearai-models`, public, no key). Each entry gives USD prices per 1M input and output tokens, context length, supported features and modalities. Prices are rounded to 6 decimals to remove float noise.

**Two budgets:** the NEAR reward (`budget_yocto`, e.g. 0.03 NEAR) pays the winning worker as usual; the product budget (`product_budget_usd`) limits the cost of the item it recommends. Nobody buys the item from the vendor.

**Cost and compliance:**

```
workload_cost = round6(pricing.input × workload.input_mtok + pricing.output × workload.output_mtok)    (USD)
compliant     = every hard requirement passes  AND  workload_cost ≤ product_budget_usd
```

Hard requirements: `supported_features` (all listed must be present), `min_context_length`, `input_modalities`, `output_modalities`.

**Verifier check order:**

| # | Check | Passes when |
|---|---|---|
| 1 | `schema` | `deliverable.data` matches `hivefund:procurement-v1` |
| 2 | `sections` | `summary`, `comparison`, `recommendation` present and non-empty |
| 3 | `test` | skipped (procurement specs have no test) |
| 4 | `catalog` | the verifier re-fetches the live catalog; the item exists; quoted input and output prices each match live within `price_tolerance_pct` (1% in the fixture, relative); live workload cost ≤ budget; every requirement passes |
| 5 | `delivery` | one tiny real call to the chosen model through NEAR AI returns HTTP 200 with token usage. Skipped when `delivery_check` is false or there is no API key (mock) |
| 6 | `rubric` | runs only if every non-skipped automated check passed. The LLM is given the live compliant options and scores `value` (0.5), `fit` (0.3), `justification` (0.2); pass threshold 70 |

The pass rule is unchanged: all automated checks pass AND rubric total ≥ threshold.

**Evidence, hash-locked:** the report carries `procurement` (`ProcurementEvidence`): catalog URL, the verifier's fetch time, catalog size, item id, found, quoted vs live pricing, price match, quoted vs live workload cost, budget, within budget, one row per requirement (expected, actual, passed), the number of live compliant options, the cheapest compliant option, and the delivery call (model, HTTP status, prompt and completion tokens, cost in USD = tokens × live price). Because this sits inside the report, its sha256 is the on-chain `check_results_hash`: anyone can re-fetch the catalog and compare.

**How the workers differ:**

| Worker | Catalog scan | Quoted prices |
|---|---|---|
| cheap | Shallow: the LLM sees only the first 12 entries, unfiltered, and picks the first acceptable one | Written by the LLM and not re-checked, so a misread price fails the `catalog` check |
| adaptive | First 30 entries, pre-filtered by code to compliant ones | Filled from the catalog by code |
| quality | The whole catalog, pre-filtered to compliant ones with costs computed; the LLM compares value | Filled from the catalog by code |

Prices can move between the worker's read and the verifier's re-fetch. A move beyond the tolerance fails the bounty, which is intended: the verifier only approves what is true at verification time.
