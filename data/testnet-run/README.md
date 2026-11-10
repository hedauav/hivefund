# Recorded testnet run (real data, not a sample)

Off-chain records of the HiveFund runs on NEAR testnet against `hub.hivefund-2026.testnet` / `hive.hivefund-2026.testnet`, committed so judges and a hosted dashboard can re-check every on-chain hash without running agents.

- `npm run demo` → bounties #0 (slugify v2, cancelled after two failed verifications) and #1 (checklist, passed at 90, 0.243 HIVE).
- `npm run test:testnet` → bounties #2 (slugify v2, failed then passed at 100) and #3 (checklist, passed at 87).
- `npm run demo -- --bounties procurement,starter`:
  - #4 procurement, "best-value LLM under $3". Quality picked `openai/gpt-5-nano` ($0.55, the cheapest of 12 live compliant models). The live catalog check passed and the one real delivery call returned HTTP 200. Passed at 90, 0.18 HIVE.
  - #5 starter glossary, price-weighted 0.8/0.0/0.2. Cheap bid with the cold-start prior and scored 0.5672 against quality's 0.5721. Quality won and passed at 94, 0.094 HIVE.

| Path | Content |
|---|---|
| `manifest.json` | Label, network, contracts, counts, file descriptions |
| `offchain/<sha256>.json` | Content-addressed specs, deliverables, verification reports and selection rationales. The file bytes are canonical JSON; `sha256(bytes)` is the file name and equals the hash stored on-chain (`spec_hash`, `deliverable_hash`, `check_results_hash`). |
| `index.jsonl` | One line per object: `{hash, kind, bounty_id, round, actor, ts}` |
| `strategy/<worker>.jsonl` | Adaptive worker strategy changes with reasons |
| `tx.jsonl` | Every transaction the agents sent: `{ts, actor, contract, method, args, txHash, ok, explorer}`. The 8 `ok: false` entries are expected refusals from `npm run test:testnet` (role tests rejected by access keys or with `ERR_*`) and two worker bids refused for insufficient function-call key allowance. |
| `chain-state.json` | Snapshot of all hub and token views after the runs |

Contains bid signatures and public keys only; no private keys or API keys. Check a hash: `node -e "const c=require('crypto'),f=require('fs');for(const n of f.readdirSync('offchain'))console.log(n.slice(0,64)===c.createHash('sha256').update(f.readFileSync('offchain/'+n)).digest('hex'),n)"` (run inside this folder).
