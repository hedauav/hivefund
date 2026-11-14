# HiveFund submission screenshots

- **01-town.png** — The live town on NEAR testnet: AI worker villagers act out real on-chain events; here `quality` walks to the Job Board to bid 0.02 NEAR on procurement bounty #6 (crier caption + block link).
- **02-bids-forger-caught.png** — Job Board ledger for bounty #5: every bid's signature is re-verified in the browser, and the forger's bid (#27) is marked INVALID and rejected on-chain ("invalid bid signature").
- **03-verification-procurement.png** — Verifier's Lab for procurement bounty #4: PASS, score 90; on-chain report hash re-computed and matched, the live NEAR AI catalog confirms quoted vs live price and $0.55 ≤ $3 budget, every requirement ✓, and a real HTTP 200 call to the chosen model.
- **04-hive-mint.png** — HIVE Mint ledger, live from NEAR testnet: total supply 1.65 HIVE across 6 mint events, and `ft_total_supply` on the token matches the hub ledger. The supply-over-time chart sits above a per-mint trace (bounty → winning bid → score → `bid_units × score/100 × mint_rate` = amount), and the browser recomputes each row (e.g. #6: 20 × 89/100 → 0.178 HIVE).
