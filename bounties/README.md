# Bounty fixtures

Each top-level `*.json` file is a `BountySpec` (see `agents/shared/src/types.ts`). The coordinator stores the spec
off-chain (content-addressed, `spec_hash = sha256(canonical JSON)`) and posts it with `post_bounty`.

| File | Kind | Budget | min_tier | Acceptance |
|---|---|---|---|---|
| `slugify.json` | code | 0.1 NEAR | 1 | `tests/slugify.test.mjs` must exit 0, then rubric >= 60 |
| `subaccount-checklist.json` | docs | 0.05 NEAR | 2 | schema (>= 5 items) + rubric >= 70 |

Budgets are plain yoctoNEAR strings in `budget_yocto`; change them freely (the demo treasury holds 0.5 NEAR,
spend cap 1 NEAR).

Test commands: only `runner: "node"` is allowed and `file` must resolve inside this folder. The verifier writes the
deliverable's `code` files into a fresh temp dir and runs `node <file> <tempdir>` without a shell, with a timeout.
`deliverable_schema.$id` (e.g. `hivefund:slugify-v2`) tells workers which built-in fallback template applies when no
LLM key is configured.
