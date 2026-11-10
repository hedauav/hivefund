# Stream E notes: docs

Files written:
- `README.md`
- `docs/SPEC.md`
- `docs/MECHANICS.md`
- `docs/DEMO_SCRIPT.md`

Everything in them was checked against the code at commit `457c002`, plus uncommitted changes from other streams.

## Placeholders to fill in

| Placeholder | Where | Who fills it |
|---|---|---|
| `<!-- TX:verifyPass -->`, `<!-- TX:mint -->`, `<!-- TX:forgedBidRejected -->`, `<!-- TX:verifyFail -->` | README "Sample transactions" | Lead or integration agent, after the live testnet run (from `config/deployment.testnet.json` `sampleTxs` / `data/tx.jsonl`) |
| `<!-- DEMO:video -->`, `<!-- DEMO:url -->`, `<!-- DEMO:x -->` | README "Demo" | Human |
| Team, payout NEAR account (mainnet) | README "Team" | Human. Never filled in by an agent |
| Other project by the same person (Q-015) | README "Libraries…" | Human |
| `<video link>`, `<repo link>` | `docs/DEMO_SCRIPT.md` X draft | Human |

## Points to re-check before submission

- **Slugify spec.** The integration agent was hardening it while these docs were written. The docs describe it only generally (a Node acceptance test plus a rubric), so update them if anything more specific is wanted.
- **Swarm Arena.** The README and demo script refer to it (`web/src/components/arena/`, untracked when these docs were written). If it doesn't land, remove those mentions.
- **Test counts.** The README says 80 contract unit tests. The TS test counts are left out on purpose because they change; quote them only after a final `npm test` run.
