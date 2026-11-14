# Baseline — Phase 0 (before any lane changes)

Recorded 2026-11-14 at commit `1f1611e` (main). No failures were fixed.

| Command | Result | Counts |
|---|---|---|
| `npm ci` | ✅ pass (exit 0) | Only warning: `esbuild@0.28.2` postinstall not covered by `allowScripts` (harmless) |
| `npm run typecheck` | ✅ pass (exit 0) | `tsc --noEmit` over shared, coordinator, worker-core, worker-cheap, worker-quality, worker-adaptive, verifier, tests, scripts, web |
| `npm test` | ✅ pass (exit 0) | 29 tests: 27 pass, 0 fail, 2 skipped (testnet-gated) |
| `npm run test:agents` | ✅ pass (exit 0) | worker-core: 10 tests, 10 pass. verifier: 26 tests, 25 pass, 1 skipped |
| `cd contracts && cargo test` | ✅ pass (exit 0) | bounty-hub 71 pass; hive-token 9 pass; 0 fail |

## Working tree at baseline (`git status --short`)

```
 M RULES.md
 M docs/MECHANICS.md
?? script.md
```

- `RULES.md` and `docs/MECHANICS.md`: uncommitted one-sentence edits that replace "There is no admin mint" / "Neither contract has an admin mint" with wording that discloses the owner's `set_minter` and `set_mint_rate` keys. The committed (public) versions still contain the old claim.
- `script.md`: untracked local video script (intentionally not in the repo).
- Not present (contrary to earlier notes): `rubric-check.tmp.ts`, uncommitted `agents/verifier/src/rubric.ts`, uncommitted `web/src/generated/recorded-run.json`.
- Also untracked but gitignored: `.env.local` (secrets; never committed).
