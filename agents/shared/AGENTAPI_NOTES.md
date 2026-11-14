# NEAR Intents Agent API: checked, not integrated

Status: **not integrated**. No HiveFund code calls the Agent API, and HiveFund makes **no claim** to use it. Checked 2026-11-14 (UTC) by the Lane B time box.

## What was checked

| Source | Result |
|---|---|
| `https://agentsonintents.com`, `https://www.agentsonintents.com` | DNS does not resolve (`ENOTFOUND`) |
| `https://docs.agentsonintents.com/integration/agent-api/overview` | Agent API overview; links to Policies & Limits, Authentication, Executions |
| `https://docs.agentsonintents.com/integration/agent-api/policies-and-limits` | Policy fields, budget usage, refusal codes |
| `https://docs.agentsonintents.com/integration/agent-api/authentication` | `X-API-Key` header; keys from the partner portal |
| `https://docs.agentsonintents.com/integration/agent-api/executions` | Money actions and the order of policy checks |
| `https://api.demo.agentsonintents.com/v1/network` | 200, public. Reports `"network":"mainnet"`, `contract_id` `outlayer.near` |
| `https://api.demo.agentsonintents.com/openapi.json` and `/llms.txt` | 200, public. OpenAPI 3.1, server `https://api.demo.agentsonintents.com` |
| `.env.local` | No `AGENT_API_DEMO_KEY` (nor any other Agent API key or agent id) |

## Endpoints that would be relevant

From the demo OpenAPI and `llms.txt`:

- `GET /v1/agents/{agent_id}/policy` (`X-API-Key`): returns `PolicyView` with `policy` and `usage`. `usage.budget` has `daily` / `weekly` / `monthly` caps, each with `limit_usd`, `spent_usd`, `remaining_usd`, `resets_at`. `policy.limits` has `per_transaction` / `hourly` / `daily` / `monthly`, each a map of `asset_id` to an atomic amount.
- `GET /v1/tokens` (public): USD prices per `asset_id`, used for the budget.
- Money actions (`POST /v1/agents/{agent_id}/transfer`, `/withdraw`, `/swap`, `/native/near/transfer`, `/native/near/call`) are where the API enforces the policy. Refusals include `spend_budget_exceeded`, `policy_transaction_limit_exceeded`, `policy_limit_exceeded` (403). A `dry: true` preview returns `spend.amount_usd`, `spend.budget` and `warnings`.
- Creating an agent or setting its policy is an **owner intent**: `POST /v1/generate-intent` → the owner's wallet signs (NEP-413 / NEP-366 / EIP-712 / passkey) → `POST /v1/submit-intent` → `GET /v1/status`.

## Why it was not integrated

1. **No key.** `AGENT_API_DEMO_KEY` is not in `.env.local`. Keys come from the partner portal (`partners.demo.agentsonintents.com`, or `partners.near-intents.org` for production). The ground rules forbid inventing one.
2. **No agent to check against.** The spending-limit read (`GET /v1/agents/{agent_id}/policy`) needs an `agent_id`. An agent only exists after an **owner-signed `agent_create` intent**, which needs a human's wallet signature and acceptance of the Owner Terms and risk notice. An agent cannot do that on the user's behalf.
3. **Mainnet only.** The API states: "The Agent API is an experimental, mainnet-only beta. You and your users may lose all assets used with it." Even the demo host reports `network: mainnet`. HiveFund runs on NEAR **testnet**, and the ground rules forbid mainnet work.
4. **Our money does not move through it.** HiveFund's payouts are testnet NEAR transfers made by the `bounty-hub` contract from escrow, and bids are `place_bid` calls signed with function-call keys. The Agent API's limits only govern money actions sent **through the Agent API** from the agent's NEAR Intents custody wallet. A pre-check that reads a mainnet USD budget and then lets a testnet contract pay anyway would not actually limit anything, so calling it "permissioning" would be an unsupported claim.

## What enforces spending today

- **Contract escrow and spend cap:** `post_bounty` moves the budget into escrow, and `committed_total` cannot exceed `spend_cap` (`ERR_SPEND_CAP`). A payout can never exceed the winning bid or the escrowed budget.
- **Function-call keys:** each agent's key can only call its own methods on the hub, cannot attach a deposit, and has a fixed NEAR gas allowance (0.1 NEAR per key). The chain refuses calls outside the role (recorded in `config/deployment.testnet.json` self-checks).

## What a real integration would need (future work)

1. A partner key in `.env.local` as `AGENT_API_DEMO_KEY`.
2. The owner creates an agent with an owner-signed `agent_create` intent and a policy (`budget`, `limits.per_transaction` for the payout asset).
3. Route the payout itself through the Agent API (for example `POST /v1/agents/{agent_id}/transfer` or `/native/near/transfer` with `X-Grant-Token` and `Idempotency-Key`), so the API's refusal (`spend_budget_exceeded`, `policy_transaction_limit_exceeded`) actually blocks the money. A read-only pre-check alone would be advisory.
4. Accept that this means mainnet assets, per the API's own risk notice.
