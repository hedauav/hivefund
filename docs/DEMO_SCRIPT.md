# HiveFund demo script (about 3 minutes)

Before recording:
- Start the dashboard with `npm run web` and open http://localhost:3000. It reads the live testnet contracts, which already hold the recorded run (bounties #0–#3). Running `npm run demo` again adds new bounties and new events.
- Keep nearblocks tabs ready for `hub.hivefund-2026.testnet` and the transactions below.

Show only what actually happened. Every beat below maps to a real transaction from the recorded run (see the README's "What happened in the recorded testnet run").

| # | Time | On screen | Voice-over |
|---|---|---|---|
| 1 | 0:00–0:20 | README problem section, then the dashboard header | "Communities want AI agents to do paid work. But who checks the work before money moves, and why do token rewards come from an admin key instead of from results? HiveFund is a bounty market on NEAR where both payment and token supply depend on verified work." |
| 2 | 0:20–0:45 | Swarm Arena replay at 2×: bounty cards appear on the board, workers walk up and drop bids | "Six agents, each on its own NEAR sub-account with a function-call key limited to its role. The coordinator posts bounties from a spec whose hash is on-chain. The cheap, quality and adaptive workers each decide on their own whether to bid and at what price." |
| 3 | 0:45–1:05 | Bid board: the forger's bids in red, "invalid bid signature", and one "tier below min_tier"; open the [forged bid](https://testnet.nearblocks.io/txns/CrZYDzyk7tRJEMXFHoAnr1F4YYh7rdgwJ11XRL6JUs1Y) and its [on-chain rejection](https://testnet.nearblocks.io/txns/FSFeuRkABATYE54XPTWr1xkigA3oSZyvTBqHjhi3XuH4) | "Every bid is signed with a key registered on-chain. The forger signed with the wrong key, so the coordinator rejected it on-chain, and the contract itself refused a bid below the bounty's tier. Rejections stay in the activity log." |
| 4 | 1:05–1:20 | Bid board for bounty #1: the winner highlighted, with the selection rationale scores | "Selection uses a published formula: price, delivery time and on-chain reputation. The full rationale is stored and hashed. No winner is hard-coded." |
| 5 | 1:20–1:50 | Bounty #0 (slugify v2): round 0 verification ✗ (adaptive's output was cut off), [reopen tx](https://testnet.nearblocks.io/txns/5bsVDbGxVyYgoooBCaKCpYGMejvNpsRC8qU35YniFabR); round 1 ✗ (quality: 11/37 checks, RangeError on default options), [cancel + refund tx](https://testnet.nearblocks.io/txns/2ehkaS2XbSDsw8uTjMskBMBjDk1YGwdBEy6Lx8kTgdoW) | "Bounty zero is a production slugify with ten exact rules and a 37-check acceptance test. Two agents won it and both really failed: one ran out of tokens, the other threw on default options. The verifier wrote each failure on-chain, excluded the worker, and after the second failure the contract cancelled the bounty and refunded the treasury. Nobody got paid for broken work." |
| 6 | 1:50–2:15 | Bounty #1: verification panel (NEAR AI rubric 90, on-chain hash vs recomputed hash ✓), then the HIVE panel mint row: 27 × 90 / 100 × 1e16 = 0.243 HIVE; open the [pass + payout + mint tx](https://testnet.nearblocks.io/txns/J48nSqTgdVx824CD2TUaZ2gVKuZgCErfF5QaGCiS5zKY) | "Bounty one passed with a NEAR AI rubric score of 90. The hub paid the winner from escrow and minted 0.243 HIVE in the same transaction's receipts: the winning bid in milliNEAR, times the score, times the mint rate. Minting is the only way HIVE is created, and the token rejects mints from anyone but the hub." |
| 7 | 2:15–2:30 | Worker panel: adaptive margin 0.20 → 0.25 → 0.21 and "quality medium → high" with reasons; speech bubble in the arena | "The adaptive worker learns from outcomes: it raised its margin after a win, cut it after a loss, and switched to higher quality after its failed verification. Every change is logged with its reason." |
| 8 | 2:30–2:50 | Procurement bounty: the spec (budget $3, tools + structured outputs, ≥ 200k context), the three proposals, then the verification panel's evidence table: quoted vs live price ✓, cost vs budget, one row per requirement, the delivery call's tokens and cost. <!-- VERIFY after live run --> | "Same market, a different job. Give it a budget and requirements, and agents compete to find the best real AI model on NEAR AI Cloud under that price. The verifier re-fetches the live price, checks every requirement and makes one real call to the pick before anyone is paid. They recommend and verify; nobody checks out." |
| 9 | 2:50–3:00 | README testnet table, on-chain state (1.2079 HIVE supply = total minted) and the self-check list | "It's all live on NEAR testnet: sub-accounts, scoped access keys, a NEP-141 token, cross-contract mint callbacks and NEAR AI Cloud inference. The repo has 'do X, see Y' steps to reproduce it." |

## Draft X thread (DRAFT, for the human to post)

Post 1 (≤ 280 characters):

> AI agents can do paid work, but who checks it before money moves?
>
> HiveFund: agents bid on community bounties on @NEARProtocol. A verifier runs real acceptance tests + a NEAR AI rubric. Only a pass pays out and mints HIVE.
>
> Built at NEAR HACKATHON #NEARHackathon 🧵

Post 2 (reply, ≤ 280 characters):

> Each agent has its own NEAR sub-account and a function-call key limited to its role. Forged bids get rejected on-chain; failed work reopens the bounty.
>
> Demo: <video link>
> Repo: <repo link>
> Feedback welcome!

Checklist:
- [ ] Each post is under 280 characters (links count as 23 characters each on X).
- [ ] Post 1 says "Built at NEAR HACKATHON" and tags @NEARProtocol and #NEARHackathon.
- [ ] A video is attached to post 1, because the demo runs locally and judges need to see it.
- [ ] Optionally tag @NearLegion and @NearBuilders.
- [ ] The repo is public, with a LICENSE file.

The human posts it and adds the link to the README.
