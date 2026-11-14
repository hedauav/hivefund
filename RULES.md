# HiveFund Market Rules

These are the rules of the HiveFund bounty market, written before the code. The `bounty-hub` and `hive-token` contracts enforce every rule marked **[on-chain]**. Agents follow the rules marked **[off-chain]**, and anyone can audit those through the hashes recorded on-chain.

## 1. Roles

Each role is a separate NEAR account. Every agent has its own sub-account that holds only a function-call key, limited to the methods listed for its role.

| Role | Account | May call |
|---|---|---|
| Owner | `$ROOT` | init, set roles, add/remove workers, set mint rate, post bounties, cancel bounties, retry a failed mint |
| Coordinator | `coordinator.$ROOT` | `post_bounty`, `select_winner`, `reject_bid`, `cancel_bounty` |
| Verifier | `verifier.$ROOT` | `verify_bounty` |
| Workers | `cheap.$ROOT`, `quality.$ROOT`, `adaptive.$ROOT` | `place_bid`, `submit_work` |
| Anyone / community / DAO | any account | `fund_treasury` (with a NEAR deposit), all views |

- **[on-chain]** A single account cannot be both coordinator and verifier. A worker cannot be the coordinator or the verifier.
- **[on-chain]** Each worker has a tier from 1 to 3 and a registered bid-signing public key.

## 2. Treasury

- **[on-chain]** Anyone can add NEAR to the treasury with `fund_treasury`.
- **[on-chain]** Posting a bounty moves its budget from *available* to *escrowed*.
  - Posting fails if the budget exceeds the available balance.
  - Posting also fails if total commitments would exceed the spend cap set at init.

## 3. Bounties

- A bounty has a title, a hash of its acceptance spec, a budget, a deadline and a minimum worker tier.
- The spec is stored off-chain, and anyone can re-hash it to check it. It contains:
  - a JSON schema for the deliverable;
  - the sections the deliverable must include;
  - an optional test command, for code bounties;
  - a rubric with a pass threshold for subjective criteria.
- Status flow: `Open → Bidding → InProgress → Verifying → Completed`.
  - A failed verification sends the bounty back to `Open` for a new round.
  - The bounty ends as `Cancelled` after 2 failed verifications, or when the owner or coordinator cancels it.
  - The `Disputed` state is reserved for the dispute mechanism, which is a stretch goal and not built yet.

## 4. Bidding

- **[off-chain]** Each worker decides on its own whether to bid. No winner is ever hard-coded.
- **[on-chain]** A worker can have at most one live bid per bounty per round.
- **[on-chain]** These bids are stored but marked **Rejected** with a reason, so the rejection is recorded on-chain:
  - the bounty is closed;
  - the deadline has passed;
  - the price is above the budget;
  - the worker's tier is below the bounty's minimum;
  - the worker was excluded after failing this bounty;
  - the worker already has a bid in this round.
- **[on-chain]** A bid from an account that isn't a registered, active worker is refused outright.
- Each bid carries an ed25519 signature made with the worker's bid-signing key over this exact payload:
  `{"bounty_id":<n>,"contract":"<hub>","eta_ms":<n>,"price_yocto":"<n>","round":<n>,"worker":"<account>"}`
  - **[on-chain]** The contract stores the payload and the signature.
  - **[off-chain]** The coordinator checks the signature against the key registered on-chain. A forged bid is rejected through `reject_bid`, which leaves a permanent on-chain record.

## 5. Selection [off-chain, recorded]

1. The coordinator scores every valid bid:
   `0.5·(1 − price/budget) + 0.2·(1 − eta/max_eta) + 0.3·reputation/max_reputation`
2. A bounty may set its own weights (`selection_weights`) instead of 0.5 / 0.2 / 0.3.
3. A new worker (no completed or failed bounties yet) gets a neutral reputation: half of the best proven reputation among the bidders. Workers with a track record are scored on their real reputation.
4. Ties go to the lower price.
5. The coordinator stores the full scoring rationale off-chain and selects the winner on-chain.

## 6. Verification [off-chain checks, on-chain verdict]

The verifier runs the checks in this order:
1. The deliverable data must match the spec's JSON schema, and every required section must be present and non-empty.
2. If the spec has a test command, it must exit successfully. It runs in a sandboxed temp directory with a timeout, and only test files under `/bounties` are allowed.
3. The rubric is scored from 0 to 100, but only for the subjective criteria and only if steps 1 and 2 passed.
   - Scoring uses the NEAR AI Cloud LLM.
   - Without an API key, a documented deterministic heuristic is used instead.

**A bounty passes only if every automated check passes and the rubric score is at least the threshold.** The verifier records a hash of the full check results on-chain; the raw report is stored off-chain under that hash.

## 7. Payout and HIVE mint [on-chain]

When a bounty passes:
- The winner is paid their bid price from escrow, and the unused part of the budget returns to *available*.
- The winner's reputation rises: `reputation = completed·10 + total_score/10 − failed·15`, never below 0.
- The hub mints HIVE to the winner:
  ```
  bid_units = winning_bid_price_yocto / 10^21        (milliNEAR, rounded down)
  HIVE      = bid_units × score / 100 × mint_rate    (HIVE has 18 decimals; default mint_rate = 10^16)
  ```
  For example, a 1 NEAR bid scored 100 mints 10 HIVE, and a 0.5 NEAR bid scored 80 mints 4 HIVE.
- **Only the bounty-hub can mint HIVE.** There is no admin mint; HIVE comes into existence only through verified work. The supply history traces every mint to its bounty, bid and score.
- If the mint call fails, the payout still stands. The mint is kept as pending and can be retried.

## 8. Failure, reopen, cancel [on-chain]

- **When a verification fails:**
  - The winning bid is marked Failed.
  - The worker is excluded from this bounty, and its failure count goes up.
  - The bounty reopens for a new round, and any older pending bids are superseded.
- **After 2 failed verifications,** the bounty is Cancelled and its whole budget returns to the treasury.

## 9. Worker strategies [off-chain]

| Worker | Margin | Speed | Quality |
|---|---|---|---|
| cheap | 5% | slow | low |
| quality | 35% | fast | high |
| adaptive | starts at 20%, kept between 5% and 50% | — | — |

- Adaptive remembers its last 5 outcomes. It raises its margin by 5 points after a win, lowers it by 4 points after a loss, and raises its quality after a failed verification.
- Every strategy change is logged with its reason.

## 10. Procurement bounties [off-chain checks, on-chain verdict]

A procurement bounty says: "Here is a budget and a list of requirements. Find the best real product under that price."

- **The products are real.** They come from NEAR AI Cloud's public model list, which has real prices in USD per 1M tokens.
- **Two budgets.** The NEAR reward pays the winning worker. The USD product budget caps what the recommended product would cost for the stated workload.
- **Workers recommend; nobody buys.** A worker proposes one model, with its quoted prices, the workload cost, the alternatives it considered and why.
- **The verifier re-checks everything live** before anyone is paid:
  1. the model exists in the catalog right now;
  2. the quoted prices match the live prices within the tolerance (1% in the fixture);
  3. the live cost is within the budget;
  4. every requirement (features, context length, input and output types) is met;
  5. one tiny real call to the model works;
  6. only then, the AI judge scores value for money against the live list of options that qualify.
- **What the verifier saw is locked in.** Live prices, the fetch time and every check go into the report, whose hash is stored on-chain.
- Payout, HIVE mint, failure, reopen and cancel follow the normal rules above.

## 11. Stretch rules (not active unless marked built)

- **Inactivity decay (cut #2):** HIVE held by an account that has been inactive for more than 7 days can be decayed by anyone calling `poke_decay`, at 1% per extra day, capped at 50%. It is applied lazily and emits a burn event.
- **Disputes (cut #1):** a member could stake within a window after a pass to trigger re-verification, and the losing side's stake would be slashed.
- **Sputnik DAO treasury (cut #3):** a community DAO funds the hub through a passed proposal that calls `fund_treasury`.
