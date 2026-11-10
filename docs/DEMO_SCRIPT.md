# HiveFund demo script (2–3 minutes)

Before recording:
- Run `npm run demo` on testnet, so the dashboard has real events and every transaction has a nearblocks link.
- Start the dashboard with `npm run web` and open http://localhost:3000.
- Keep a nearblocks tab ready for `hub.hivefund-2026.testnet`.

Only show what actually happened in the recorded run. If no verification failed in that run, skip beat 5's failure part rather than staging one.

| # | Time | On screen | Voice-over |
|---|---|---|---|
| 1 | 0:00–0:20 | README problem section, then the dashboard header | "Communities want AI agents to do paid work. But who checks the work before money moves, and why do token rewards come from an admin key instead of from results? HiveFund is a bounty market on NEAR where both payment and token supply depend on verified work." |
| 2 | 0:20–0:45 | Swarm Arena replay at 2×: bounty cards appear on the board, workers walk up and drop bids | "Six agents, each on its own NEAR sub-account with a function-call key limited to its role. The coordinator posts bounties from a spec whose hash is on-chain. The cheap, quality and adaptive workers each decide on their own whether to bid and at what price." |
| 3 | 0:45–1:05 | Bid board: the forger's bid in red, "invalid bid signature"; click its nearblocks link | "Every bid is signed with a key registered on-chain. The forger signed with the wrong key, so the coordinator rejected it on-chain. The rejection stays in the activity log, it doesn't just disappear." |
| 4 | 1:05–1:20 | Bid board: the winner highlighted, with the selection rationale scores | "Selection uses a published formula: price, delivery time and on-chain reputation. The full rationale is stored and hashed. No winner is hard-coded." |
| 5 | 1:20–1:50 | Verification panel: schema ✓, test ✓/✗, NEAR AI rubric table, on-chain hash vs recomputed hash ✓. If the run had a failure, show it: the worker is excluded and the bounty reopens | "The verifier runs the bounty's acceptance test, then a NEAR AI Cloud rubric, and writes a hash of the full report on-chain. The browser recomputes that hash. A failure excludes the worker and reopens the bounty, and two failures refund the treasury." |
| 6 | 1:50–2:15 | HIVE panel: the mint row traced bounty → bid → score → `units × score / 100 × rate`; supply chart; nearblocks payout and mint txs | "On a pass, the hub pays the winner from escrow and mints HIVE, the only way HIVE can be created. The amount is the winning bid in milliNEAR times the score times the mint rate. The token rejects mints from anyone but the hub, including the owner." |
| 7 | 2:15–2:35 | Worker panel: adaptive margin-over-time chart and strategy-change reasons; speech bubble in the arena | "The adaptive worker learns. After wins it raises its margin, after losses it cuts it, after a failed verification it raises its quality. Every change is logged with its reason." |
| 8 | 2:35–2:50 | README testnet table and self-check list | "It's all live on NEAR testnet: sub-accounts, scoped access keys, a NEP-141 token, cross-contract mint callbacks and NEAR AI Cloud inference. The repo has 'do X, see Y' steps to reproduce it." |

## Draft X post (DRAFT, for the human to post)

> Agents can do paid work, but who checks it before money moves?
>
> HiveFund: AI agents bid on community bounties on @NEARProtocol. A verifier runs the acceptance tests plus a NEAR AI rubric, and only a pass pays out and mints HIVE (supply = bid × score). Forged bids get rejected on-chain.
>
> Each agent runs on its own NEAR sub-account with a function-call key limited to its role.
>
> Built at NEAR HACKATHON #NEARHackathon
> Demo: <video link> · Repo: <repo link>
> Feedback welcome!

Checklist:
- [ ] The draft is about 450 characters. Without long posts on X, split it into a 2-post thread at the blank line before "Each agent…".
- [ ] The post says "Built at NEAR HACKATHON".
- [ ] It tags @NEARProtocol and #NEARHackathon.
- [ ] A video is attached, because the demo is local and judges need to see it run.
- [ ] Optionally tag @NearLegion and @NearBuilders.
- [ ] The repo is public, with a LICENSE file.

The human posts it and adds the link to the README.
