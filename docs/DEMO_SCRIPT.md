# HiveFund demo script (about 2:15)

## Submission checklist

Deadline: **Nov 14, 2026, 23:59 UTC**. One submission per project; a repo can be submitted only once.

### Human-only tasks (agents never fill these in)

- [ ] Record the demo video using the script below (≈ 2:15; X free accounts allow at most 2:20). MP4 (H.264), 1080p, under 512 MB.
- [ ] Post the X thread below with the video attached. Post 1 must say "Built at NEAR HACKATHON" and tag @NEARProtocol and #NEARHackathon.
- [ ] Add the video link and the X post link to the README's Demo section (`<!-- DEMO:video -->`, `<!-- DEMO:x -->`).
- [ ] Add the team name(s) to the README's Team section.
- [ ] Enter the payout NEAR wallet (mainnet) **in the submission form only**. It is not written in the repo.
- [ ] Fill in the "Other projects" line in the README (or state there are none).
- [x] `AWAIT_CONFIRMATION.md` decided 2026-11-14: **keep v1**. The `lock_config` admin-key lock is implemented and tested in code, not deployed; the README says so.
- [ ] Submit the form at https://nearhackathon.com/#apply:
  - tracks: `swarms`, `agents`, `memecoins` (optionally `open`); do not tick `social`;
  - repo URL: https://github.com/hedauav/hivefund;
  - demo URL: the X post link;
  - **leave the `website` field empty** (it is a spam trap);
  - tick consent.

### Commands to verify the build

Run from the repo root:

```
npm ci
npm run typecheck
npm test                      # 27 passed, 2 skipped (testnet-gated)
npm run test:agents           # worker-core 10, verifier 25 (+1 skipped)
cd contracts && cargo test    # bounty-hub 71, hive-token 9
cd .. && npm run web:build
npm run demo -- --mode mock   # offline market run, no chain, no LLM
npm run simulate:supply       # 60-day HIVE supply simulation (offline)
npm run procure -- --budget 2 --task "summarise long support tickets" --need tools,structured-outputs --min-context 128000 --dry-run
```

`--dry-run` posts nothing; it prints the generated spec and the live catalog shortlist. Without `--dry-run`, `npm run procure` and `npm run demo` send real testnet transactions and need the keys in `.env.local`.

## Before recording

- Open https://hivefund-near.vercel.app full-screen (light mode, 100% zoom). It reads the live testnet contracts, which hold the recorded run (bounties #0–#6).
- Open a terminal in the repo folder.
- Extra tabs: the [bounty #6 verify + pay + mint tx](https://testnet.nearblocks.io/txns/GdcPTRuhN8mw8EGyj3qpbTCzo5AfU9xGuhDVxvhRVnu6) and https://github.com/hedauav/hivefund.
- Running `npm run procure` live spends a little testnet NEAR from the agents' allowances.

Show only what actually happened. Every beat maps to the live dashboard or a real transaction.

## Script

| Time | On screen | Voice-over |
|---|---|---|
| 0:00–0:15 | The town, idle | "AI agents are starting to do paid work. But their output often looks right and isn't. And when the money is shared, like a DAO or an open-source fund, who decides which agent gets paid?" |
| 0:15–0:30 | Slowly hover over the buildings | "HiveFund is a bounty market on NEAR. AI agents compete for jobs, an independent verifier checks the work, and money moves only if it passes. Every step is on-chain." |
| 0:30–0:50 | Terminal: `npm run procure -- --budget 2 --task "summarise long support tickets" --need tools,structured-outputs --min-context 128000` | "Here I ask for the best AI model for summarising support tickets, under two dollars. Three agents compete, cheap, quality and adaptive, each searching NEAR AI's live model catalog." |
| 0:50–1:10 | Villagers walk to the Job Board; click **Job Board** and show the forger's bid in red ([forged bid](https://testnet.nearblocks.io/txns/CrZYDzyk7tRJEMXFHoAnr1F4YYh7rdgwJ11XRL6JUs1Y), [on-chain rejection](https://testnet.nearblocks.io/txns/FSFeuRkABATYE54XPTWr1xkigA3oSZyvTBqHjhi3XuH4)) | "Each agent signs its bid. Here, a forger tried a fake bid. It was caught and rejected on-chain, in public. The coordinator scores the honest bids on price, speed and reputation." |
| 1:10–1:35 | Click **Verifier's Lab**: PASS, hash ✓, live price $0.55 ≤ budget, requirements ✓ | "The verifier doesn't trust the agent. It re-fetches the live price, checks every requirement, actually calls the chosen model, then scores the pick. The full report's fingerprint is locked on-chain." |
| 1:35–1:55 | Click **HIVE Mint** (chart and formula), then the nearblocks tab | "It passed, so the winner is paid from escrow and HIVE is minted: bid times score times rate. No pass, no HIVE. Here's the real transaction on NEAR testnet." |
| 1:55–2:10 | Click a worker house, or show the README accounts table | "Every agent is its own NEAR account with a key that can only call its role's methods. The coordinator can't approve work; the chain refuses it. AI runs on NEAR AI Cloud." |
| 2:10–2:15 | GitHub tab, then back to the town | "HiveFund: agents compete, prove their work, and get paid only for verified results. Built at NEAR HACKATHON." |

**Backup if the live run is slow:** skip the terminal and open the finished bounty #6 in the dashboard. It is the same real result: `quality` picked `openai/gpt-5-nano` at $0.55, PASS, 0.178 HIVE minted. In that run the score of 89 came from the deterministic fallback scorer, because the NEAR AI grader returned invalid JSON; don't call it an AI score on camera.

## Draft X thread (DRAFT, for the human to post)

Post 1 (attach the video):

> AI agents can do paid work, but who checks it before they get paid?
>
> HiveFund: agents compete for bounties, a verifier tests the work, and payment + HIVE mint happen only on a pass. All on-chain.
>
> Built at NEAR HACKATHON @NEARProtocol #NEARHackathon

Post 2 (reply to post 1):

> Live on NEAR testnet: each agent has its own account & role-locked key, results hash-locked on-chain, AI via NEAR AI Cloud.
>
> Demo: https://hivefund-near.vercel.app
> Code: https://github.com/hedauav/hivefund
>
> Feedback welcome 🙏

Checklist:
- [ ] Each post is under 280 characters (links count as 23 characters each on X).
- [ ] Post 1 says "Built at NEAR HACKATHON" and tags @NEARProtocol and #NEARHackathon.
- [ ] A video is attached to post 1.
- [ ] Optionally tag @NearLegion and @NearBuilders.
- [ ] The repo is public, with a LICENSE file.

The human posts it and adds the link to the README.
