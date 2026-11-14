# Lane D — live demo verification report

Verified on 2026-11-14 (live views read 2026-11-14 ~19:16 local / IST) against `README.md` as it was at the start of this lane (commit `1f1611e`; snapshot taken before Lanes A–C edited it). Chain reads came from `hub.hivefund-2026.testnet` and `hive.hivefund-2026.testnet` via `rpc.testnet.near.org`, with drpc and fastnear as fallbacks.

## Summary

- **Web build:** `npm run web:build`, `tsc --noEmit -p web` and `npm -w web run lint` all pass, before and after the fixes. The prebuild left `web/src/generated/recorded-run.json` unchanged.
- **Live mode:**
  - `/api/config` reports `mode: live` on `hub.hivefund-2026.testnet`, with the recorded run at 32 objects and 79 txs.
  - The "SAMPLE DATA — NOT LIVE" banner does not appear on `/` or on `/bounty/0` through `/bounty/6`.
  - The header shows "LIVE · testnet", and "Could not load market data" does not appear.
- **Bounty values and totals:** every README value for bounties #0–#6 matches the live chain: 42 of 42 bounty checks, 5 of 5 treasury figures, HIVE supply, the mint count, HIVE per worker, and the forger rejections.
- **Transaction links:** 44 unique hashes are linked from the README.
  - 3 resolved on the RPC (FINAL, SuccessValue): the bounty #6 post, select and verify, all from today.
  - The other 41 returned `UNKNOWN_TRANSACTION` from the public non-archival testnet RPCs. Those nodes only keep about 2–3 days of transactions, and the earlier runs date from Nov 10–11, so this means the transactions have been pruned, not that the hashes are wrong.
  - 38 of the 44 hashes are in `data/testnet-run/tx.jsonl` or `config/deployment.testnet.json`, every one marked `ok:true`.
  - Checking on an archival RPC or nearblocks was **not done (time box)**.
- **Web bugs fixed:**
  1. **Time axis:** the HIVE supply chart and the worker margin chart showed hh:mm only. When the data spans several days the labels read as going backwards (07:23 PM, then 06:33 PM). The axis now adds the date when the range crosses a day boundary.
  2. **"No admin mint" wording:** the dashboard said "there is no admin mint" in the HIVE panel subtitle and the Mint drawer intro. That contradicts the code (the owner keeps `set_minter` and `set_mint_rate`), so both texts now say only the hub can mint and the owner can still change the minter and mint rate.

## Bounty values: README vs live chain

| Item | Expected (README) | Observed (live) | Status |
|---|---|---|---|
| #0 status / winner / score | Cancelled / none / 0 | Cancelled / none / 0 (2 attempts, round 1) | match |
| #0 paid / HIVE / refund | 0 / 0 / 0.1 NEAR | 0 / 0 / covered by treasury refunded 0.1 | match |
| #1 status / winner / score | Completed / quality / 90 | Completed / quality / 90 | match |
| #1 paid / HIVE | 0.0278235 / 0.243 | 0.0278235 / 0.243 | match |
| #2 status / winner / score | Completed / adaptive / 100 | Completed / adaptive / 100 (1 attempt, round 1) | match |
| #2 paid / HIVE | 0.0730598 / 0.73 | 0.0730598 / 0.73 | match |
| #3 status / winner / score | Completed / quality / 87 | Completed / quality / 87 | match |
| #3 paid / HIVE | 0.0278235 / 0.2349 | 0.0278235 / 0.2349 | match |
| #4 status / winner / score | Completed / quality / 90 | Completed / quality / 90 | match |
| #4 paid / HIVE | 0.02025 / 0.18 | 0.0202500 / 0.18 | match |
| #5 status / winner / score | Completed / quality / 94 | Completed / quality / 94 | match |
| #5 paid / HIVE | 0.0106974 / 0.094 | 0.0106974 / 0.094 | match |
| #6 status / winner / score | Completed / quality / 89 | Completed / quality / 89 | match |
| #6 paid / HIVE | 0.02025 / 0.178 | 0.0202500 / 0.178 | match |

## Totals

| Item | Expected (README) | Observed (live) | Status |
|---|---|---|---|
| Treasury funded | 0.5 | 0.5000000 | match |
| Treasury paid out | 0.1799042 | 0.1799042 | match |
| Treasury refunded | 0.1 | 0.1000000 | match |
| Treasury available | 0.3200958 | 0.3200958 | match |
| Treasury escrowed | 0 | 0 | match |
| HIVE `ft_total_supply` | 1.6599 | 1.6599 | match |
| Sum of `get_supply_history` amounts | = ft_total_supply | 1.659900 | match |
| Mint events | 6 | 6 | match |
| HIVE earned: quality / adaptive / cheap / forger | 0.9299 / 0.73 / 0 / 0 | 0.9299 / 0.73 / 0 / 0 | match |
| Forger bids rejected | 8 of 8 (6 bad signature, 2 below tier) | 8 of 8 ("invalid bid signature", "tier below min_tier") | match |

## Live dashboard checks (local production build, `next start`)

| Item | Expected | Observed | Status |
|---|---|---|---|
| `npm run web:build` | success | success (twice, before and after fixes) | pass |
| `tsc --noEmit -p web`, `npm -w web run lint` | clean | clean | pass |
| `/api/config` | mode live, hub `hub.hivefund-2026.testnet` | mode live, hub `hub.hivefund-2026.testnet`, recorded 32 objects / 79 txs | pass |
| SAMPLE banner on `/` | absent | absent | pass |
| SAMPLE banner on `/bounty/0` … `/bounty/6` | absent | absent on all 7 | pass |
| Verdict shown per bounty page | #0 FAIL, #2 FAIL then PASS, others PASS | #0 FAIL; #2 FAIL + PASS; #1, #3–#6 PASS | pass |
| HTTP errors (≥ 400) while loading | none | none | pass |
| Browser console | no errors | 2 CORS errors on `https://test.rpc.fastnear.com/` (its 429/error responses have no CORS header); the page falls back to other RPCs and loaded fully | note |

## Transaction links in README

| Group | Count | Status |
|---|---|---|
| Resolved via RPC `EXPERIMENTAL_tx_status` (FINAL, SuccessValue): `88P2r6wqJuQJF9ZVAFU9dnf9wNKnSLHivFYFQbQiK5bk` (post #6), `Bb512jiiiTtLMa9WQPJjavAFFhWFzL3hVQpyPoSwhWZA` (select #6), `GdcPTRuhN8mw8EGyj3qpbTCzo5AfU9xGuhDVxvhRVnu6` (verify #6) | 3 | verified |
| `UNKNOWN_TRANSACTION` on non-archival RPC; present in `data/testnet-run/tx.jsonl` (all `ok:true`) and/or `config/deployment.testnet.json` | 35 | recorded; on-chain resolution **not checked (time box)**, needs an archival RPC or nearblocks |
| `UNKNOWN_TRANSACTION` and **not present** in `tx.jsonl` or `deployment.testnet.json`: the six key-rotation (rekey) txs `2qWf4DJiBSgWMfaWZ3M53xyDdjM3XCEPhF4k6jFz6EeM`, `DzcrzPtjj9Eq9fZjZfWypYaSX3VomLmyFG5XXE5JMEYf`, `JAnKs1WVVNVXSoxGsxpso8cboPGUFnvDm3f95wnXU7g2`, `AtuXqmSxvN2mU6KTNsMmxYWA6evPcKTh6xfVR5J2hNuy`, `9BypHhbiBwaF6FatwoAUXLVwq9AWzregZT3KqTZbu6ur`, `6d7jooPSgZeLCaRa1oDugQ1PkuVwWkshaKSX6jioe4t` | 6 | **not checked (time box)**; not backed by a committed record (they came from `scripts/topup.ts` output), so verify on nearblocks or drop them from the README |

No README hash conflicts with `tx.jsonl`. Every recorded hash the README cites is present with the matching method, so there are no corrected hashes to suggest.

## Web changes (bug fixes only)

- `web/src/lib/format.ts`: new `axisTimeFormatter(ts)`. Shows hh:mm, and adds month and day when the data spans more than one calendar day.
- `web/src/components/hive-panel.tsx`: supply chart x-axis uses `axisTimeFormatter`; subtitle wording corrected (admin keys).
- `web/src/components/worker-panel.tsx`: margin chart x-axis uses `axisTimeFormatter`.
- `web/src/components/town/drawer.tsx`: Mint drawer intro wording corrected (admin keys).

Left as is (layout only, no data hidden): the mint trace table needs about 760px and scrolls sideways inside the 637px drawer, so the CHECK and TX columns are reached by scrolling.

## Phase 2 addendum (2026-11-14): archival check of every README tx link

The public RPC nodes are not archival, so the 41 older hashes were checked against the nearblocks archival API (`https://api-testnet.nearblocks.io/v1/txns/<hash>`) with ~2–6 s spacing.

| Result | Count |
|---|---|
| README tx hashes checked | 44 |
| Found on nearblocks | **44** |
| Not found | 0 |
| Found, outcome success | 43 |
| Found, outcome failure (expected) | 1: `7sdtnTVk…`, the setup self-check where root calls `verify_bounty` and gets `ERR_NOT_VERIFIER` on purpose |

The 6 rekey hashes that were not in any committed record are all real, successful `ADD_KEY` transactions signed by the agent account:

| Agent | Hash | Status |
|---|---|---|
| coordinator | `DzcrzPtjj9Eq9fZjZfWypYaSX3VomLmyFG5XXE5JMEYf` | ✅ success |
| verifier | `2qWf4DJiBSgWMfaWZ3M53xyDdjM3XCEPhF4k6jFz6EeM` | ✅ success |
| cheap | `JAnKs1WVVNVXSoxGsxpso8cboPGUFnvDm3f95wnXU7g2` | ✅ success |
| quality | `AtuXqmSxvN2mU6KTNsMmxYWA6evPcKTh6xfVR5J2hNuy` | ✅ success |
| adaptive | `9BypHhbiBwaF6FatwoAUXLVwq9AWzregZT3KqTZbu6ur` | ✅ success |
| forger | `6d7jooPSgZeLCaRa1oDugQ1PkuVwWkshaKSX6jioe4t` | ✅ success |

They are kept in the README and now recorded in `config/deployment.testnet.json` under `rekeyTxs`.
