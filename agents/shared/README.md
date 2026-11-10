# @hivefund/shared

The shared library for every HiveFund agent, the tests and the web app. Stream B owns it.

- **`@hivefund/shared`** runs in both the browser and Node, so the web app can use it. It contains types, `canonicalize`/`hashJson`, bid signing, mint math and spec validators.
- **`@hivefund/shared/node`** is Node only. It contains the hub clients (real and mock), the content-addressed store, the LLM helper, config and env loading, and the agent contract.

All TS packages run under `tsx` with no build step. Import with `.ts` paths inside this package; other packages import `@hivefund/shared` and `@hivefund/shared/node`.

---

## Isomorphic API (`@hivefund/shared`)

| Export | Signature |
|---|---|
| types | `Bounty`, `Bid`, `WorkerInfo`, `WorkerView`, `ActivityEntry`, `SupplyPoint`, `Treasury`, `PendingMint`, `HubConfig`, `BountySpec`, `Deliverable`, `VerificationReport`, `CheckResult`, `SelectionRationale`, `StrategyChange`, `DeploymentConfig`, … (`types.ts`) |
| constants | `HUB_ERRORS`, `BID_REJECT_REASONS`, `INVALID_SIGNATURE_REASON`, `AGENT_METHODS`, `DEFAULT_SELECTION_WEIGHTS` |
| `canonicalize(v)` / `hashJson(v)` / `sha256Hex(s)` / `isHash(s)` | canonical JSON + sha256 content address |
| `bidPayload(input)` / `signBid(payload, bidKey)` / `verifyBid(payload, sig, pk)` / `bidPublicKey(bidKey)` / `newBidKey()` | bid commitments |
| `bidUnits(price)` / `mintAmount(price, score, rate)` / `formatHive` / `formatNear` / `parseNear` | mint math (BigInt), same as the contract |
| `validateSpec(spec)` / `validateDeliverable(d)` / `validateReport(r)` | return `string[]` of problems (empty = ok) |
| `scoreBids(...)` | the coordinator's selection formula; see `selection.ts` |

## Node API (`@hivefund/shared/node`)

### Hub client

```ts
interface HubClient {
  readonly accountId: string;   // who signs (agent sub-account)
  readonly contractId: string;  // which contract this client talks to (hub or token)
  view<T>(method: string, args?: object): Promise<T>;
  call<T = unknown>(method: string, args: object,
    opts?: { gasTGas?: number; depositYocto?: string }): Promise<{ txHash: string; result: T }>;
}
```
- A failed call **throws an `Error` whose message contains the contract's `ERR_*` code**. Match it with `err.message.includes("ERR_NOT_WORKER")`; `hubErrorCode(err)` returns the code.
- **`NearHubClient`** (the main path, testnet): `new NearHubClient({ accountId, privateKey, contractId, rpcUrl?, fallbackRpcUrls?, explorer?, onTx?, retries? })`.
  - Uses near-api-js 7.4 with the agent's function-call key; default gas 100 TGas; `txHash` = `transaction_outcome.id`.
  - RPC failover: fastnear → drpc. Transient errors (network, 429/5xx, nonce, expiry) are retried with backoff, and calls are serialized per key.
  - Contract panics are never retried.
  - `onTx` receives a `TxLogEntry` that includes a nearblocks link.
- **`MockChain`** (unit tests and offline dev only): an in-memory port of bounty-hub + hive-token. It has the same method names, args and `ERR_*` strings, the same non-panicking bid rejections, and the same treasury math, mint math, activity log and supply history.
  ```ts
  const chain = new MockChain({ owner, hub, token, spendCapYocto, mintRate, nowMs? });
  chain.client(accountId, onTx?)        // HubClient on the hub as that account
  chain.tokenClient(accountId)          // HubClient on the token (ft_balance_of, ft_total_supply, ft_metadata, mint -> ERR_NOT_MINTER)
  chain.setNow(ms) / chain.advance(ms)  // controllable clock
  chain.nearBalance(account)            // NEAR received from payouts (bigint)
  chain.failNextMints = 1               // simulate a failed mint callback (-> MintFailed, retry_mint)
  ```
  Mock tx hashes are `mock-<n>`. Any failed call rolls back the whole state, like a failed NEAR tx.
- **Markets**: wired agent contexts for the whole swarm.
  - **`createTestnetMarket()`** (main path) reads `config/deployment.testnet.json`, plus the agent keys and bid keys from `.env.local`. Every tx goes to `data/tx.jsonl`.
  - **`createMockMarket({ store })`** sets up a MockChain the same way the setup script does on testnet:
    - roles are set;
    - workers are registered (cheap 1, adaptive 2, quality 3, forger 1);
    - the treasury is funded with 0.5 NEAR against a 1 NEAR cap.
  - Both return a `Market` with `{ mode, hubId, tokenId, store, coordinator, verifier, workers{cheap,quality,adaptive}, forger, owner, token, chain, now }`.
- **`readChainState(hub, token, source)`** returns every view as one JSON object, which becomes `chain-state.json`.

### Off-chain store

```ts
const store = new OffchainStore(dataDir);  // default: openStore() -> $HIVEFUND_DATA_DIR or <repo>/data
store.put(obj, { kind: "spec" | "deliverable" | "report" | "selection", bounty_id?, round?, actor }): string  // -> hash
store.get<T>(hash): T            // re-hashes, throws on mismatch / missing
store.has(hash): boolean
store.appendStrategy(worker, change: StrategyChange)  /  store.readStrategy(worker) / store.strategyWorkers()
store.appendTx(entry)  /  store.readTx()
store.readIndex()                // [{hash, kind, bounty_id, round, actor, ts}]
store.writeJson(name, obj)       // e.g. chain-state.json
store.exportSnapshot(dir)        // copies offchain/, strategy/, *.jsonl, *.json into dir (web/public/offchain)
```
All writes are synchronous (`fs.*Sync`), so agents running in one process never race.

### LLM (NEAR AI Cloud, OpenAI-compatible)

```ts
llmAvailable(): boolean          // NEARAI_API_KEY set and HIVEFUND_MODE !== "mock"
chat(messages, { json?, schema?, schemaName?, model?, temperature?, maxTokens?, thinkingTokenBudget? })
  : Promise<{ content, model, usage } | null>      // null => caller uses its deterministic fallback
chatJsonFull<T>(messages, opts): Promise<{ data: T, content, model, usage } | null>
chatJson<T>(messages, opts): Promise<T | null>
llmModel(): string               // NEARAI_MODEL || "z-ai/glm-5.3-flash"
```
- **Reasoning:** GLM thinking is disabled by default (`chat_template_kwargs.enable_thinking=false`), because otherwise the reasoning uses up `max_tokens` and the content comes back empty. Pass `thinkingTokenBudget` to allow some reasoning.
- **Structured output:** strict `json_schema` is tried first, then `json_object`.
- **Security:** the key is never logged.

### Config / env

```ts
repoRoot(): string
loadEnv(): void                         // .env.local then .env into process.env (does not override existing vars)
getMode(): "mock" | "testnet"           // HIVEFUND_MODE, default "testnet"
dataDir(): string
loadDeployment(path?): DeploymentConfig | null   // config/deployment.testnet.json
requireEnv(name): string
```

### Agents (as built by Stream C, loaded by `agents/coordinator/src/agents.ts`)

- **Workers:** `createCheapWorker` / `createQualityWorker` / `createAdaptiveWorker` take `{ accountId, contract, bidKey, now, log, llm? }` and return a `Worker`, whose method is `tick(hub, store)`.
- **Verifier:** `new Verifier({ accountId, now, log, llm? })`, then `.tick(hub, store)`.
- **Context:** an `AgentContext` (`hub`, `store`, `contractId`, `accountId`, `now`, `log`, `mode`, `repoRoot`) is merged into the factory options. In mock mode the loader passes `llm: null`, which is simulation mode with no LLM calls.
