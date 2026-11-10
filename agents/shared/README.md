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
- **`NearHubClient`**: `new NearHubClient({ accountId, privateKey, contractId, rpcUrl? })`. Uses near-api-js 7.4 with a function-call key. Default gas is 100 TGas. `txHash` = `transaction_outcome.id`.
- **`MockChain`**: an in-memory port of the bounty-hub and hive-token contracts, with the same method names, args, `ERR_*` strings, non-panicking bid rejections, treasury math, mint math, activity log and supply history.
  ```ts
  const chain = new MockChain({ owner: "owner.test", hub: "hub.test", token: "hive.test",
                                spendCapYocto: "1000000000000000000000000", mintRate: "10000000000000000" });
  const hub = chain.client("coordinator.test");          // HubClient on the hub as that account
  const tok = chain.tokenClient("anyone.test");          // HubClient on the token (ft_balance_of, ft_total_supply, ft_metadata)
  chain.setNow(ms) / chain.advance(ms)                   // controllable clock (default Date.now at construction)
  chain.nearBalance(account)                             // NEAR received from payouts (bigint)
  chain.snapshot()                                       // every view as one JSON object (used for data/sample)
  ```
  The mock tx hashes are deterministic, base58-looking strings (`mock-<n>`).
- **`createDemoMarket(opts?)`** (mock) sets up a `MockChain` the same way as `scripts/setup-testnet.ts`:
  - roles are set;
  - workers are registered (cheap 1, adaptive 2, quality 3, forger 1), each with a fresh bid key;
  - the treasury is funded with 0.5 NEAR against a 1 NEAR spend cap.

  It returns `{ chain, accounts, bidKeys, clients }`.

### Off-chain store

```ts
const store = new OffchainStore(dataDir);  // default: openStore() -> $HIVEFUND_DATA_DIR or <repo>/data
store.put(obj, { kind: "spec" | "deliverable" | "report" | "selection", bounty_id?, round?, actor }): string  // -> hash
store.get<T>(hash): T            // re-hashes, throws on mismatch / missing
store.has(hash): boolean
store.appendStrategy(worker, change: StrategyChange)  /  store.readStrategy(worker): StrategyChange[]
store.appendTx({ ts, actor, method, args, txHash })   /  store.readTx()
store.readIndex()                // [{hash, kind, bounty_id, round, actor, ts}]
store.exportSnapshot(dir)        // copies offchain/, strategy/, tx.jsonl, index.jsonl into dir (web/public/offchain)
```
All writes are sync (`fs.*Sync`) so agents in one process never race.

### LLM (NEAR AI Cloud, OpenAI-compatible)

```ts
llmAvailable(): boolean                                 // NEARAI_API_KEY set and HIVEFUND_MODE !== "mock"
chat(messages, { json?, schema?, model?, temperature?, maxTokens? }): Promise<string | null>   // null => use fallback
chatJson<T>(messages, opts): Promise<T | null>
llmModel(): string                                      // NEARAI_MODEL || "z-ai/glm-5.3-flash"
```

### Config / env

```ts
repoRoot(): string
loadEnv(): void                         // .env.local then .env into process.env (does not override existing vars)
getMode(): "mock" | "testnet"           // HIVEFUND_MODE, default "mock"
dataDir(): string
loadDeployment(path?): DeploymentConfig | null   // config/deployment.testnet.json
```

### Agent contract (what the workers and verifier packages export; Stream C)

Stream B's `demo.ts` dynamically imports `@hivefund/worker-cheap`, `@hivefund/worker-quality`, `@hivefund/worker-adaptive` and `@hivefund/verifier`. It expects:

```ts
interface AgentContext {
  hub: HubClient;            // signs as this agent
  store: OffchainStore;
  contractId: string;        // hub account id (goes into bidPayload.contract)
  accountId: string;         // this agent's account
  now: () => number;         // ms; use for eta/deadline math (mock clock in demo)
  log: (msg: string) => void;
  mode: "mock" | "testnet";
  repoRoot: string;          // to resolve /bounties
}
interface WorkerContext extends AgentContext { bidKey: string }   // ed25519 bid-signing secret

interface Agent { name: string; accountId: string; tick(): Promise<void> }

// each worker package:   export function createWorker(ctx: WorkerContext): Agent
// verifier package:      export function createVerifier(ctx: AgentContext): Agent
```
- **Worker `tick()`** bids on Open/Bidding bounties it hasn't bid on this round, and submits work for bounties it has won (status InProgress with its bid as the winner).
- **Verifier `tick()`** verifies every bounty with status Verifying.
- Both read state with `hub.view("get_bounties", {})`, `hub.view("get_bids", { bounty_id })` and so on.
