# Stream C notes: verifier, workers, bounty fixtures

## Packages and exports
| Package | Exports |
|---|---|
| `@hivefund/worker-core` | `Worker` (`tick(hub, store) -> TickReport`), `AdaptiveStrategy`, `StaticStrategy`, `quote`, `complexity`, `generateDeliverable`, `createNearAiClient`, `nearAiFromEnv`, `TEMPLATES`, ports (`HubLike`, `StoreLike`, `LlmClient`), `WORKER_CALL_GAS_TGAS` (30) |
| `@hivefund/worker-cheap` / `-quality` / `-adaptive` | `createCheapWorker` / `createQualityWorker` / `createAdaptiveWorker(opts)`, `PROFILE` |
| `@hivefund/verifier` | `Verifier` (`tick(hub, store) -> VerificationOutcome[]`), `verify(spec, deliverable, opts)`, `VERIFY_GAS_TGAS` (60), check and rubric helpers |

Factory options: `accountId`, `contract` (hub id, goes into the signed bid payload), `bidKey`, optional `llm`
(`undefined` = NEAR AI from env, `null` = no LLM), `now`, `log`, `bountiesDir` (defaults to `<repoRoot>/bounties`).
The coordinator's loader (`agents/coordinator/src/agents.ts`) already passes these; mock mode passes `llm: null`.

`ports.ts` declares minimal structural interfaces instead of importing `@hivefund/shared/node`, so these packages
compile and test without Stream B's code. Stream B's `NearHubClient`, `MockHubClient` and store satisfy them.

## Workers
- Each tick, a worker: (1) reads its own bids and turns new `Won`/`Lost`/`Failed` statuses into win/loss/fail
  outcomes; (2) submits work for bounties it won; (3) decides independently whether to bid on each Open/Bidding
  bounty. It skips when it already bid this round, is excluded, is below `min_tier`, the deadline has passed, it
  cannot produce that deliverable type, expected profit is negative, or the price would exceed the budget.
- Pricing is BigInt yocto with basis-point ratios: `cost = budget × complexity` (complexity 0.3–0.7 from the spec),
  `price = cost × (1 + margin)`, `ownCost = cost × quality factor` (low 0.8 / medium 1.0 / high 1.2). There is no
  fixed minimum price by default (`minCostYocto` = 0), so the 0.1 and 0.05 NEAR budgets price fine and stay above
  1 milliNEAR (HIVE mint units are never 0).
- No winner is hardcoded: workers only bid; the coordinator selects on-chain.
- Adaptive: last-5 window. A win adds 0.05 to the margin (0.07 if 3+ wins in the window); a loss subtracts 0.04
  (0.06 if 3+ losses), clamped to [0.05, 0.50]. A failed verification raises quality medium → high. If the margin
  is below break-even for the current quality, the worker raises it to break-even + 0.05. Every change goes to
  `store.appendStrategy` with its reason and window.

## Deliverable generation (real LLM; template only as fallback)
- With `NEARAI_API_KEY` set, workers write deliverables through NEAR AI Cloud (`https://cloud-api.near.ai/v1`):
  strict `json_schema` structured output, and `chat_template_kwargs {enable_thinking:false}` (GLM otherwise spends
  `max_tokens` on hidden reasoning and returns empty content).
- The quality gap is genuine, not scripted:

  | Worker | Model (env override) | Token budget | Reads the acceptance test? |
  |---|---|---|---|
  | cheap | `z-ai/glm-5.3-flash` (`WORKER_CHEAP_MODEL`) | 900 | no |
  | adaptive | `NEARAI_MODEL` (flash) (`WORKER_ADAPTIVE_MODEL`) | 2500 | no |
  | quality | `deepseek/deepseek-v3.2` (`WORKER_QUALITY_MODEL`) | 6000 | yes, full source |

- `z-ai/glm-5.3` was tried for the quality worker and rejected. Under `json_schema` it returned placeholder
  skeletons (`"..."`) for the code and sections, and under `json_object` it echoed the schema back.
  `deepseek/deepseek-v3.2` works.
- Generation is retried once. Code shorter than 40 characters, or made only of dots, is rejected as a
  placeholder. After that the worker falls back to the built-in template for the spec's
  `deliverable_schema.$id`; if there is none, it submits an honest empty deliverable, which fails verification.
- Each deliverable carries `generator: {mode: "llm"|"template"|"failed", model}`. **Stream B:** consider adding
  `generator?: {mode; model}` to the `Deliverable` type. It is hashed with the deliverable and ignored by grading.
- Live smoke run (2026-11-10), command: `node --env-file=.env.local --import tsx agents/verifier/scripts/live-smoke.ts`. Results:
  - cheap (glm-5.3-flash): test 14/14, LLM rubric 100
  - quality (deepseek-v3.2): test 14/14, LLM rubric 93

  On this simple bounty both models pass. The cheap worker's failure is therefore not guaranteed in LLM mode,
  and that is real behaviour. In mock/fallback mode, the low and medium templates do fail the unicode cases.

## Verifier
- Check order:
  1. schema (ajv) and required sections
  2. test command
  3. rubric, which runs only when 1 and 2 pass
- Pass and score:
  - `passed = automated pass && total >= threshold && total > 0`
  - `score` = rubric total, or 0 when no rubric ran
- Rubric:
  - Uses NEAR AI (strict json_schema, thinking off, temperature 0); the weighted total is computed locally.
  - Falls back to a deterministic keyword-coverage heuristic only without a key or after an LLM error. The
    report records `rubric.mode`, and the rubric check's `details` include the LLM error.
  - Fallback formula: `75 × min(1, coverage/0.8) + 25 × min(1, words/200)`, where coverage is the share of
    rubric-description keywords (≥ 5 letters, prefix match) found in the deliverable. Document this in MECHANICS.md.
- Test runner:
  - Only `runner: "node"` is accepted, and the file must resolve inside `/bounties` after symlink resolution.
  - Deliverable code goes into a fresh temp dir: at most 10 files, 256 KB, with safe file names.
  - It runs as `node <file> <dir>` with `shell: false`, an environment of only PATH/SystemRoot (so no keys
    leak), timeout clamped to 1–60 s, and output capped. The temp path is replaced with `<deliverable-dir>`,
    so identical input gives an identical report hash.
- Limitation: deliverable code is untrusted and runs as a local process with no OS-level sandbox. This is
  acceptable for the hackathon, but document it in README "known limitations".
- `verify_bounty` is sent with 60 TGas, and worker calls with 30 TGas, to fit the 0.05 NEAR function-call key
  allowance.

## Fixtures (`/bounties`)
| Spec | Kind | Budget | Tier | Test | Pass threshold |
|---|---|---|---|---|---|
| `slugify.json` | code | 0.1 NEAR | 1 | `tests/slugify.test.mjs`, 14 cases (diacritics, ß, CJK, separators) | 60 |
| `subaccount-checklist.json` | docs | 0.05 NEAR | 2 | none (schema needs ≥ 5 items) | 70 |

## Env vars used (add to `.env.example`, root-owned)
`NEARAI_API_KEY`, `NEARAI_BASE_URL`, `NEARAI_MODEL`, `WORKER_CHEAP_MODEL`, `WORKER_ADAPTIVE_MODEL`, `WORKER_QUALITY_MODEL`.
The key is never logged.

## Tests
`node --import tsx --test "test/**/*.test.ts"` in `agents/worker-core` (10 tests) and `agents/verifier` (16 tests).
They cover:
- **Verifier:** cheap/medium slugify fail the real test, quality passes; report hash is deterministic without a key;
  traversal, absolute paths, non-node runners and bad file names are refused; runaway code times out; checklist
  schema and rubric gates work; LLM mode is recorded, with honest fallback on LLM error; the Verifier agent stores
  the report and its on-chain hash matches.
- **Workers:** signed bids verify against the bid key; no double bids; tier, budget, deadline, exclusion and
  can't-produce skips; adaptive bounds hold over 20+ outcomes and every change is logged; small-budget pricing
  works; LLM effort scales with quality.
