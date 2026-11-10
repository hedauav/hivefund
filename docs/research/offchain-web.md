# HiveFund — Off-chain & Web Research (verified 2026-11-10)

Scope: TypeScript agents on Node 22 (a coordinator, 3 workers and a verifier, each with its own sub-account and function-call key on testnet), a Next.js dashboard with wallet login, and LLM rubric scoring via NEAR AI Cloud.
Everything below comes from current official docs, package source or live endpoints, fetched on 2026-11-10. Source URLs are inline. Where something is inferred rather than documented, it says so.

---

## 0. Version snapshot (npm registry, today)

| Package | Latest | Notes |
|---|---|---|
| `near-api-js` | **7.4.0** | `engines: node >=22.22.2`. Subpath exports: `.`, `./nep413`, `./tokens`, `./rpc-errors`, `./seed-phrase`, `./tokens/mainnet`, `./tokens/testnet`. ESM + CJS builds. |
| `near-kit` | **0.20.2** | Optional peer: `@hot-labs/near-connect >=0.11.0`. Uses zod, @noble/*, and `@napi-rs/keyring` (a native module). |
| `@hot-labs/near-connect` | **0.12.0** | `engines: node ^22.22.2 \|\| ^24.15.0 \|\| >=26`. The official template still pins `^0.11.4`. |
| `function-call-key-plugin` | 2.2.0 | Optional plugin for near-connect. |
| `create-near-app` | 10.0.0 | `engines: node >=22.0.0`. The generated Next app requires `^22.22.2 \|\| >=24`. |
| `openai` | 7.54.0 | Used for NEAR AI Cloud. |

**Node requirement:** the docs say "Use **Node.js 22.22.2 or newer**" (https://docs.near.org/tools/near-api.md). Pin `"engines": {"node": ">=22.22.2"}` and an `.nvmrc` with `22.22.2` or later. Older Node 22 minors only produce an npm engine warning, but don't rely on that.

---

## 1. near-api-js v7 from Node (agents)

Docs: https://docs.near.org/tools/near-api.md · README: https://github.com/near/near-api-js · Examples: https://github.com/near-examples/near-api-examples/tree/main/near-api-js

### 1.1 Provider, signer and Account

```ts
import { Account, JsonRpcProvider, FailoverRpcProvider, KeyPair, KeyPairSigner,
         teraToGas, nearToYocto, yoctoToNear, type KeyPairString } from "near-api-js";

// The testnet RPC used throughout the official docs
const provider = new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" });
// Optional failover (README "Failover RPC Provider")
const rpc = new FailoverRpcProvider([
  new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" }),
  new JsonRpcProvider({ url: "https://near-testnet.drpc.org" }),
]);

// The third ctor arg accepts a Signer or a raw "ed25519:..." string
// (source: src/accounts/account.ts)
const worker = new Account(
  process.env.WORKER1_ACCOUNT_ID!,                 // e.g. worker-1.hivefund.testnet
  provider,
  process.env.WORKER1_PRIVATE_KEY! as KeyPairString // "ed25519:..."
);

// Equivalent explicit signer:
const signer = KeyPairSigner.fromSecretKey(process.env.WORKER1_PRIVATE_KEY! as KeyPairString);
const worker2 = new Account("worker-2.hivefund.testnet", provider, signer);
```

- `JsonRpcProvider(connectionInfo, options?)` takes `connectionInfo = { url, headers? }` and `options = { retries=12, wait=500ms, backoff=1.5 }`. Add an RPC API key with `headers: { Authorization: "Bearer <key>" }` (source: `src/providers/json-rpc-provider.ts`, `fetch_json.ts`).
- The `Account` constructor also accepts a URL string as the provider.

### 1.2 Change methods (function call)

The README and docs snippet are verbatim:
```ts
await account.callFunction({
  contractId: 'guestbook.near-examples.testnet',
  methodName: "add_message",
  args: { text: "Hello!" },
  gas: teraToGas('30'),
  deposit: nearToYocto('0.1'),
});
```
Signature from source (`CallFunctionArgs`): `{ contractId, methodName, args?: object|Uint8Array, deposit?: bigint|string|number (default 0), gas?: (default 30 Tgas), waitUntil?: TxExecutionStatus (default 'EXECUTED_OPTIMISTIC') }`.

- `account.callFunction<T>()` returns the **decoded return value** (base64 `SuccessValue`, then JSON.parse, falling back to a string) via `getTransactionLastResult`.
- `account.callFunctionRaw()` returns the **full RPC tx response**. Use it when you need the tx hash and logs:

```ts
const res = await worker.callFunctionRaw({
  contractId: "hivefund.testnet", methodName: "submit_work",
  args: { task_id: 7, result_hash: "..." }, gas: teraToGas("50"),
});
const txHash = res.transaction_outcome.id;            // == res.transaction.hash
const logs = res.receipts_outcome.flatMap(r => r.outcome.logs); // NEP-297 "EVENT_JSON:..." lines
import { getTransactionLastResult } from "near-api-js";
const ret = getTransactionLastResult(res);
console.log(`https://testnet.nearblocks.io/txns/${txHash}`);
```

Batch or low-level form (docs "Batch Actions"):
```ts
import { actions } from "near-api-js";
await account.signAndSendTransaction({
  receiverId: "counter.near-examples.testnet",
  actions: [
    actions.functionCall("increment", {}, teraToGas("30"), 0n),
    actions.transfer(nearToYocto("0.001")),
  ],
  // waitUntil?: 'NONE'|'INCLUDED'|'EXECUTED_OPTIMISTIC'|'INCLUDED_FINAL'|'EXECUTED'|'FINAL'
  // throwOnFailure?: boolean (default true)
});
```
**Gotcha:** `actions.functionCall(method, args, gas = 0n, deposit = 0n)` defaults gas to **0**, so always pass gas. Only `account.callFunction` defaults to 30 Tgas.

### 1.3 View calls

```ts
const msgs = await provider.callFunction<{ text: string }[]>({
  contractId: "guestbook.near-examples.testnet",
  method: "get_messages",            // NOTE: `method`, not `methodName` (provider vs account differ)
  args: {},
  // blockQuery?: { finality: 'optimistic' | 'final' } | { blockId }  (default optimistic)
});
```
Other reads: `provider.viewAccount({ accountId })`, `provider.viewAccessKey({ accountId, publicKey })`, `provider.viewAccessKeyList(...)`, `account.getBalance()` (bigint yocto), and `account.getState()`.

### 1.4 Error parsing (contract panics)

From `src/accounts/account.ts`: `signAndSendTransaction` with `throwOnFailure=true` (the default) throws `parseTransactionExecutionError(status.Failure, txHash, blockHash, result)`. The relevant classes live in `near-api-js/rpc-errors`:

- `ContractExecutionError` (base) has `.message`, `.blockHash`, `.blockHeight`, and `.transactionResult?` (the full RPC response on submitted txs, undefined on view calls).
- A near-sdk-rs panic such as `env::panic_str` or `require!` arrives as `FunctionCallError.ExecutionError` and becomes `new ContractExecutionError(error.ExecutionError, ...)`. The message is the node string, typically `"Smart contract panicked: <msg>"`.
- `HostGuestPanicError` has `.panicMessage` and is used for the HostError GuestPanic variant.
- `WasmTrapError`, `ContractMethodNotFoundError`, and `ContractCodeDoesNotExistError`.
- `TransactionExecutionError` (base for action errors) has `.txHash`, `.blockHash` and `.transactionResult`. Relevant subclasses for us: `AccessKeyMethodNameMismatchActionError`, `AccessKeyReceiverMismatchActionError`, `AccessKeyNotEnoughAllowanceActionError`, `AccessKeyDepositWithFunctionCallActionError`, `AccountAlreadyExistsActionError`, and `LackBalanceForStateActionError`.
- `InvalidNonceError` is retried automatically (up to `retries=10`) after the nonce cache is invalidated.

```ts
import { ContractExecutionError, HostGuestPanicError, TransactionExecutionError }
  from "near-api-js/rpc-errors";
try {
  await worker.callFunction({ contractId, methodName: "claim_task", args, gas: teraToGas("30") });
} catch (e) {
  if (e instanceof HostGuestPanicError) console.error("panic:", e.panicMessage);
  else if (e instanceof ContractExecutionError) {
    const msg = e.message.replace(/^Smart contract panicked: /, "");
    const txHash = e.transactionResult?.transaction_outcome.id;
    console.error("contract error:", msg, txHash);
  } else if (e instanceof TransactionExecutionError) console.error("action error:", e.constructor.name, e.txHash);
  else throw e;
}
```
View-call failures, per the RPC docs at https://docs.near.org/api/rpc/contracts.md, come back as **HTTP 200 with `result.error`**, for example `"wasm execution failed with error: MethodResolveError(MethodNotFound)"`. near-api-js turns these into typed errors through `parseRpcErrorMessage`. With raw fetch you must check `result.error` yourself.

### 1.5 Concurrency

- Each access key has its own nonce. near-api-js has a per-Account `NonceManager` and retries on `InvalidNonceError`.
- Our design (one sub-account and one key per agent) avoids cross-agent nonce contention. Inside one agent, **serialize** txs, or add several keys and use `MultiKeySigner` (docs "Simultaneous Transactions").
- Each agent process should create one `Account` instance and reuse it.

### 1.6 near-kit comparison (npm `near-kit`, docs https://kit.near.tools/llms.txt)

```ts
import { Near } from "near-kit";
const near = new Near({ network: "testnet", privateKey: "ed25519:...", defaultSignerId: "worker-1.hivefund.testnet" });
// rpcUrl / headers options available (kit.near.tools/reference/configuration.md)
const v = await near.view("hivefund.testnet", "get_task", { id: 7 });
const out = await near.call("hivefund.testnet", "submit_work", { id: 7 }, { gas: "50 Tgas", attachedDeposit: "0 NEAR" });
console.log(out.transaction.hash); // call() returns FinalExecutionOutcome
```
- Strengths: human-readable units (`"30 Tgas"`, `"0.1 NEAR"`), a fluent `near.transaction(id).createAccount().transfer().addKey(...).send()`, typed errors (`FunctionCallError` with `.panic` and `.logs`, `InvalidNonceError`, `TimeoutError`), `RotatingKeyStore`, a built-in `Sandbox`, `verifyNep413Signature`, and `fromHotConnect(connector)` for frontends.
- **Gotcha (verified in source `packages/near-kit/src/core/near.ts`):** `near.call<T = FinalExecutionOutcome>()` returns the raw outcome. The generic `T` is a **type cast only** and is not decoded. You must base64-decode `status.SuccessValue` yourself. The docs.near.org tip ("type the return of Near.call<T>") is misleading.
- Pre-1.0 (0.20.x) and has a native dep (`@napi-rs/keyring`), which can be friction on Windows or CI.

**Recommendation for HiveFund agents: near-api-js 7.4.0.** Reasons:
- It is the official library.
- `callFunction` returns the decoded value, `callFunctionRaw` gives the hash and logs, and typed `rpc-errors` exist.
- There are no native deps, and it is the same package the official Next template uses, so there is one library for both agents and web.
- The API is already short (about 3 lines per call).

near-kit is a fine alternative if the team prefers unit strings or the fluent builder. Don't mix the two.

---

## 2. Signing arbitrary payloads (agent attestations)

From `near-api-js` source (`src/crypto/key_pair_ed25519.ts`, `public_key.ts`), backed by `@noble/curves/ed25519`:
```ts
import { KeyPair, PublicKey, type KeyPairString } from "near-api-js";
import { createHash } from "node:crypto";

const kp = KeyPair.fromString(process.env.WORKER1_PRIVATE_KEY! as KeyPairString);
const payload = new TextEncoder().encode(JSON.stringify({ task_id: 7, score: 82, nonce: "..." })); // canonicalize!
const digest = createHash("sha256").update(payload).digest();        // optional: sign a hash
const { signature, publicKey } = kp.sign(new Uint8Array(digest));    // signature: Uint8Array(64)

const sigB64 = Buffer.from(signature).toString("base64");
const pkStr  = publicKey.toString();                                 // "ed25519:<base58>"

// Verify anywhere:
const ok = PublicKey.fromString(pkStr).verify(new Uint8Array(digest), Buffer.from(sigB64, "base64"));
// or kp.verify(msg, sig)
```
- `kp.sign(msg)` is plain ed25519 over the raw bytes (no prefixing or hashing). `PublicKey.verify(msg, sig)` dispatches on key type.
- Raw 32-byte public key: `PublicKey.fromString(pkStr).data`. This is what an on-chain `env::ed25519_verify(&sig64, &msg, &pk32)` needs. The contract side is in contracts.md.
- To bind a signature to an *account* off-chain, also check that the key is registered on that account: `provider.viewAccessKey({ accountId, publicKey: pkStr })` throws if the key is absent.
- Alternatives: `@noble/curves/ed25519` (already a transitive dep, `ed25519.sign(msg, secret32)` / `ed25519.verify(sig, msg, pub)`), `@noble/ed25519`, or `tweetnacl`. NEAR's secret string is base58 of 64 bytes (seed‖pub), and the first 32 bytes are the seed. near-api-js handles this for you, so prefer it.

### NEP-413 (is it relevant?)
- NEP-413 is for **wallet users** proving account ownership off-chain (login or auth). The dashboard can use it via near-connect `wallet.signMessage({ message, recipient, nonce })`, where `nonce` is 32 bytes.
- Server verify (verbatim from https://docs.near.org/web3-apps/backend/backend.md):
```ts
import { verifyMessage } from "near-api-js/nep413";
await verifyMessage({
  signerAccountId: walletReturn.accountId,
  signerPublicKey: walletReturn.publicKey,
  signature: new Uint8Array(Buffer.from(walletReturn.signature, 'base64')),
  payload: { message: MESSAGE, recipient: APP, nonce: CHALLENGE },
  provider
});
```
- **Gotcha (source `src/nep413/verify.ts`):** `verifyMessage` **throws unless the key has `FullAccess`** permission on the account. Agents that sign with function-call keys therefore **cannot** use NEP-413 verify. Use the raw `KeyPair.sign` / `PublicKey.verify` flow above, plus the `viewAccessKey` check.
- Signing NEP-413 from Node: `import { signMessage } from "near-api-js/nep413"; await signMessage({ signerAccount: account, payload: { message, recipient, nonce } })`. `account.signNep413Message` is deprecated.

---

## 3. Web: Next.js App Router + NEAR Connect

Docs: https://docs.near.org/web3-apps/tutorials/wallet-login.md · near-connect README: https://github.com/azbang/near-connect · Template: https://github.com/near/create-near-app/tree/master/templates/frontend/next-app

### 3.1 create-near-app (current)
- Run `npx create-near-app@latest my-web-app --frontend next-app --install`. Next.js uses **App Router**. The legacy `next-page` template is no longer supported per the README. Note that the docs quickstart page still describes the "classic" pages-router flow (`_app.tsx`); the template itself is App Router.
- Prereq: **Node 22.22.2+, 24.15+, or 26+**.
- Template `package.json` deps: `next ^16.4.3`, `react ^19.3.1`, `@hot-labs/near-connect ^0.11.4`, `function-call-key-plugin ^2.1.0`, `near-api-js ^7.4.0`, `bootstrap`, `typescript ^6.0.3`, and `eslint ^9`. `next.config.js` contains only `reactStrictMode: true`.
- Structure:
```
src/app/layout.tsx            // server component; wraps <Providers>
src/app/page.tsx
src/app/hello-near/page.tsx   // 'use client'; uses useNearWallet()
src/app/{globals.css,app.module.css}
src/components/{navigation,cards}.tsx
src/config.ts                 // NetworkId + contract per network
src/providers/index.tsx       // 'use client'; dynamic(import near-provider, { ssr:false })
src/providers/near-provider.tsx // NearConnector + FailoverRpcProvider + context
```
- The key SSR pattern (verbatim, `src/providers/index.tsx`):
```tsx
'use client';
import dynamic from 'next/dynamic';
import type { PropsWithChildren } from 'react';
import { Navigation } from '@/components/navigation';
// Wallet libraries require browser APIs. Initialize them after hydration.
const NearProvider = dynamic(
  () => import('@/providers/near-provider').then((module) => module.NearProvider),
  { ssr: false },
);
export function Providers({ children }: PropsWithChildren) {
  return <NearProvider><Navigation />{children}</NearProvider>;
}
```
```tsx
// src/app/layout.tsx
import '@/app/globals.css';
import type { ReactNode } from 'react';
import { Providers } from '@/providers';
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body><Providers>{children}</Providers></body></html>;
}
```

### 3.2 NearProvider (condensed from the template, minus the access-key plugin)
```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { FailoverRpcProvider, JsonRpcProvider, getTransactionLastResult } from 'near-api-js';
import { NearConnector, type EventMap, type NearConnectorOptions } from '@hot-labs/near-connect';

const connectorOptions: NearConnectorOptions = {
  network: 'testnet',
  providers: { mainnet: ['https://free.rpc.fastnear.com'], testnet: ['https://test.rpc.fastnear.com'] },
};

export function NearProvider({ children }: PropsWithChildren) {
  const connector = useMemo(() => new NearConnector(connectorOptions), []);
  const provider = useMemo(() => new FailoverRpcProvider(
    (connector.providers.testnet ?? []).map((url) => new JsonRpcProvider({ url }))), [connector]);
  const [wallet, setWallet] = useState<Awaited<ReturnType<NearConnector['wallet']>>>();
  const [signedAccountId, setSignedAccountId] = useState('');

  useEffect(() => {
    let cancelled = false;
    connector.getConnectedWallet().then((c) => {           // restore session
      if (!cancelled && c) { setWallet(c.wallet); setSignedAccountId(c.accounts[0]?.accountId ?? ''); }
    }).catch(() => {});
    const onIn = (p: EventMap['wallet:signIn']) => { setWallet(p.wallet); setSignedAccountId(p.accounts[0]?.accountId ?? ''); };
    const onOut = () => { setWallet(undefined); setSignedAccountId(''); };
    connector.on('wallet:signIn', onIn); connector.on('wallet:signOut', onOut);
    return () => { cancelled = true; connector.off('wallet:signIn', onIn); connector.off('wallet:signOut', onOut); };
  }, [connector]);

  const signIn = useCallback(async () => {
    const w = await connector.connect();                    // opens wallet modal
    setWallet(w); setSignedAccountId((await w.getAccounts())[0]?.accountId ?? '');
  }, [connector]);
  const signOut = useCallback(async () => { if (wallet) await connector.disconnect(wallet); setWallet(undefined); setSignedAccountId(''); }, [connector, wallet]);

  const viewFunction = useCallback(({ contractId, method, args = {} }: { contractId: string; method: string; args?: object }) =>
    provider.callFunction({ contractId, method, args }), [provider]);

  const callFunction = useCallback(async ({ contractId, method, args = {}, gas = '30000000000000', deposit = '0' }:
      { contractId: string; method: string; args?: object; gas?: string; deposit?: string }) => {
    if (!wallet) throw new Error('Wallet is not connected');
    const result = await wallet.signAndSendTransaction({
      receiverId: contractId,
      actions: [{ type: 'FunctionCall', params: { methodName: method, args, gas, deposit } }],
    });
    return getTransactionLastResult(result);  // result.transaction.hash for explorer link
  }, [wallet]);
  // ... context value / useNearWallet() hook as in template
}
```
- Actions accept the wallet-selector format above (`type:'FunctionCall'`, gas and deposit as **strings in yocto/gas units**) or near-api-js `actions.*` creators. The README calls the latter "recommended".
- `connector.connect({ signMessageParams: { message, recipient, nonce } })` signs in and signs a NEP-413 message in one step, emitting `wallet:signInAndSignMessage`.
- Wallet filtering: `new NearConnector({ network:'testnet', features: { signAndSendTransaction: true, testnet: true } })`. In the README manifest example, HOT Wallet has `"testnet": false`, so some wallets cannot do testnet. Filter with `testnet: true` or tell demo users to use, for example, Meteor, MyNearWallet or Intear. Which wallets support testnet is not documented, so verify in the modal.
- `wallet.signAndSendTransactions({ transactions: [...] })` signs several transactions from a single prompt.

### 3.3 Read-only view via raw JSON-RPC (no library)
Verified live today against testnet. The response has `Access-Control-Allow-Origin: *`, so it works from the browser.
```ts
const RPC = "https://test.rpc.fastnear.com";
export async function view<T>(contractId: string, method: string, args: object = {}): Promise<T> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: "hivefund", method: "query",
      params: {
        request_type: "call_function", finality: "optimistic",  // or "final"
        account_id: contractId, method_name: method,
        args_base64: btoa(JSON.stringify(args)),                 // Node: Buffer.from(...).toString("base64")
      },
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${json.error.name}/${json.error.cause?.name}: ${json.error.data ?? json.error.message}`);
  if (json.result.error) throw new Error(json.result.error);   // contract-level failure (HTTP 200!)
  const bytes = new Uint8Array(json.result.result as number[]);  // result is a byte ARRAY, not base64
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}
```
- The view result is `result.result: number[]` (UTF-8 bytes). Transaction return values are instead **base64** in `status.SuccessValue` (https://docs.near.org/api/rpc/contracts.md).
- `btoa` only handles Latin-1. For non-ASCII args use `btoa(String.fromCharCode(...new TextEncoder().encode(s)))` or `Buffer`.
- nearcore **rejects JSON-RPC batch arrays** (HTTP 400, -32700). Send one request per POST.
- Handler errors look like `error.name = "HANDLER_ERROR"` with `error.cause.name` in `UNKNOWN_ACCOUNT`, `NO_CONTRACT_CODE`, and so on.

---

## 4. Testnet RPC endpoints, rate limits and explorer

Source: https://docs.near.org/api/rpc/providers.md

| Provider | Testnet endpoint | Free-tier limit |
|---|---|---|
| FASTNEAR (default in all docs) | `https://test.rpc.fastnear.com` | "Not published" |
| NEAR (archival) | `https://archival-rpc.testnet.near.org` | "Severely rate limited" |
| dRPC | `https://near-testnet.drpc.org` | ~2,100 CU/s |
| Intear | `https://testnet-rpc.intea.rs` | Not published |

- FastNear API key: get one at https://dashboard.fastnear.com. Send `Authorization: Bearer $FASTNEAR_API_KEY` (preferred) or `?apiKey=`. For the browser, use a domain-restricted "browser key" and never ship a server key (https://docs.fastnear.com/auth.md). Pass it in near-api-js via `new JsonRpcProvider({ url, headers: { Authorization: 'Bearer …' } })`.
- The hackathon rules say "Public RPC free" (Q-009).
- Practical approach (inferred, not documented): agents poll views every 2–5 s, not in tight loops, and use `FailoverRpcProvider` with fastnear plus drpc. The dashboard should poll or refresh at a similar rate. near-api-js already retries 12× with backoff.
- Explorer (NearBlocks testnet; formats used in docs.near.org):
  - Tx: `https://testnet.nearblocks.io/txns/<txHash>`
  - Account/contract: `https://testnet.nearblocks.io/address/<accountId>`
- Testnet NEAR is free: the near-cli faucet or near-faucet.io (HACKATHON.md Q-008), and https://docs.near.org/getting-started/faucet.md.

---

## 5. NEAR AI Cloud (LLM for verifier rubric scoring)

Docs: https://docs.near.ai/llms.txt · quickstart https://docs.near.ai/cloud/quickstart.md · OpenAI compat https://docs.near.ai/cloud/guides/openai-compatibility.md

- **Base URL:** `https://cloud-api.near.ai/v1`. The API is OpenAI-compatible and supports Chat Completions (with tools, **structured outputs** and reasoning), Completions, Models, Embeddings, Images, Audio, and stateless Responses (`store:false`).
- **Key:** sign up at https://cloud.near.ai, buy credits under "Credits" (crypto or card), then generate a key under "API Keys" (dashboard: https://cloud.near.ai/dashboard/organizations). New keys can take up to about 10 s to activate.
- **Hackathon credits (HACKATHON.md Q-000):** "claim $10 by joining NEAR Builders (https://nearbuilders.org/join): the credits are claimed in the NEAR Builders dashboard (https://nearbuilders.org/dashboard). You get a **separate API key with a $10 balance**. It is not applied to your cloud.near.ai account, so the credits won't appear in that dashboard."
- Env-var form: `OPENAI_BASE_URL=https://cloud-api.near.ai/v1`, `OPENAI_API_KEY=<near-ai-key>`.

```ts
import OpenAI from "openai";
const ai = new OpenAI({ baseURL: "https://cloud-api.near.ai/v1", apiKey: process.env.NEARAI_API_KEY! });

const rubricSchema = {
  type: "object", additionalProperties: false,
  required: ["score", "criteria", "verdict", "rationale"],
  properties: {
    score: { type: "integer", minimum: 0, maximum: 100 },
    criteria: { type: "array", items: { type: "object", additionalProperties: false,
      required: ["name", "points", "max"], properties: {
        name: { type: "string" }, points: { type: "integer" }, max: { type: "integer" } } } },
    verdict: { type: "string", enum: ["accept", "reject"] },
    rationale: { type: "string" },
  },
};

const r = await ai.chat.completions.create({
  model: "z-ai/glm-5.3-flash",          // supports structured_outputs + json_mode (per /v1/models)
  temperature: 0,
  messages: [
    { role: "system", content: "You are a strict grader. Return only JSON matching the schema." },
    { role: "user", content: `Rubric:\n${rubric}\n\nSubmission:\n${work}` },
  ],
  response_format: { type: "json_schema", json_schema: { name: "rubric_score", strict: true, schema: rubricSchema } },
  // GLM-5.3 Flash reasons by default (8192-token budget); cap it to save credits/latency:
  // @ts-expect-error non-OpenAI extension
  thinking_token_budget: 256,
});
const scored = JSON.parse(r.choices[0].message.content!);   // still validate with zod; retry on parse failure
```
- `response_format` with `json_schema` is the standard OpenAI shape. The docs say only "structured outputs" are supported and don't give an example. Per-model support is reported in `/v1/models` as `supported_features` (`structured_outputs`, `json_mode`). Verify with one test call, and fall back to `{ type: "json_object" }` plus a schema in the prompt if needed.
- Reasoning models return the chain of thought in `message.reasoning_content` and the answer in `content`. Parse only `content`. Reasoning tokens are billed (https://docs.near.ai/cloud/reasoning-models.md). Controls:
  - GLM-5.3 Flash: `thinking_token_budget` or `reasoning_effort`. `enable_thinking:false` only moves the reasoning into `content`, so it doesn't save anything.
  - Qwen3.6: `chat_template_kwargs: { enable_thinking: false }`.
  - Kimi: `chat_template_kwargs: { thinking: false }`.
- **Live model list today** (`GET https://cloud-api.near.ai/v1/models`, public, no auth; 64 models). Good picks for a cheap JSON grader are below. Prices are USD per 1M tokens, input/output.

| model id | owner/tier | $ in/out | features |
|---|---|---|---|
| `z-ai/glm-5.3-flash` | nearai (TEE) | 0.08 / 0.50 | tools, structured_outputs, reasoning, json_mode, 1M ctx |
| `Qwen/Qwen3.8-27B` | nearai (TEE) | 0.04 / 1.35 | tools, structured_outputs, reasoning |
| `Qwen/Qwen3.6-35B-A3B-FP8` | nearai (TEE) | 0.17 / 1.10 | tools, json_mode, structured_outputs, reasoning |
| `deepseek/deepseek-v4.1-flash` | deepseek | 0.30 / 1.20 | tools, json_mode, reasoning |
| `openai/gpt-5.4-mini`, `anthropic/claude-*`, `google/gemini-*` | Incognito (gateway TEE, provider outside TEE) | higher | — |

- TEE-hosted ("Confidential TEE", owner `nearai`) models support attestation and response signatures (`/v1/attestation/report`, `/v1/signature/{chat_id}`). This is a good story for a "verifiable verifier" (https://docs.near.ai/cloud/verification). Incognito models (OpenAI, Anthropic, Gemini) don't carry TEE guarantees upstream.
- **Gotcha:** the docs' example model `zai-org/GLM-5.1-FP8` (and `z-ai/glm-5.2` in the Responses example) is **not in today's public `/v1/models` list**. Deprecated models reportedly route to a successor, but pick IDs from `/v1/models` at build time and keep the model name in env (`NEARAI_MODEL`).

---

## 6. Sub-accounts and function-call keys in code (instead of the CLI)

Note: `account.createSubAccount()` adds a **full-access** key (source: `createAccount + transfer + addFullAccessKey`). For agents that should hold only a function-call key, build the tx yourself. Signer = the parent account with a full-access key (e.g. `hivefund.testnet`):
```ts
import { Account, JsonRpcProvider, KeyPair, actions, nearToYocto, type KeyPairString } from "near-api-js";

const provider = new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" });
const parent = new Account("hivefund.testnet", provider, process.env.PARENT_PRIVATE_KEY! as KeyPairString);
const CONTRACT = "hivefund.testnet";           // or core.hivefund.testnet — whatever contracts.md decides

for (const name of ["coordinator", "worker-1", "worker-2", "worker-3", "verifier"]) {
  const kp = KeyPair.fromRandom("ed25519");
  const newId = `${name}.hivefund.testnet`;    // must end with parent id; total ≤ 64 chars
  const res = await parent.signAndSendTransaction({
    receiverId: newId,
    actions: [
      actions.createAccount(),
      actions.transfer(nearToYocto("1")),      // gas budget lives in the account balance
      actions.addFunctionCallAccessKey(
        kp.getPublicKey(), CONTRACT,
        [],                                    // [] = all methods; or e.g. ["submit_work","claim_task"]
        undefined,                             // allowance: undefined = unlimited (see pitfalls)
      ),
    ],
  });
  console.log(newId, kp.toString(), `https://testnet.nearblocks.io/txns/${res.transaction_outcome.id}`);
  // write kp.toString() to .env (gitignored) as e.g. WORKER1_PRIVATE_KEY
}
```
- To add an fn-call key to an **existing** account (signed by that account's full-access key), the docs snippet is verbatim:
```ts
await account.addFunctionCallAccessKey({
  publicKey: fnKeyPair.getPublicKey(),
  contractId: "example-contract.testnet",
  methodNames: ["example_method"],
  allowance: NEAR.toUnits("0.25")   // NEAR from "near-api-js/tokens"; library DEFAULT is 0.25 NEAR if omitted
});
```
- Other key operations: `account.addFullAccessKey(pk)`, `account.deleteKey(pk)`, `account.getAccessKeyList()`.
- Top-level `.testnet` accounts: `account.createAccount({ newAccountId, publicKey, nearToTransfer })` calls `create_account` on `testnet` (docs "Create Named Account").
- Parent accounts have **no control** over sub-accounts after creation (docs). Deleting the parent doesn't delete subs.

---

## 7. Hackathon prompts and organizer emphasis

Repo: https://github.com/nearai/near-hackathon-prompt-examples (files: `tracks/05-swarms.md`, `tracks/11-memecoins.md`, `tracks/12-social.md`). Rules: https://nearhackathon.com/HACKATHON.md

**Global (README / SUBMITTING / HACKATHON.md):**
- Dates: submissions close **Nov 14, 2026 23:59 UTC**. Judging is Nov 16–18. Each track pays $10K/$3K/$2K, plus a $55K grand prize.
- **Claude Code and Codex screen every repo**: reproducibility check, feature verification, and a preliminary score. Humans decide (Q-017). The README must be written for a machine reader: what it is, the problem, and numbered **"do X, see Y"** steps. No marketing.
- Submission requirements:
  - A public repo with a LICENSE.
  - An X post (tags @NEARProtocol #NEARHackathon) with a video. Screenshots alone are not enough for local-only demos (Q-012).
  - A mainnet payout account.
  - No secrets in git history.
  - One submission per team, and it can't be edited.
- Testnet-only projects are eligible for all tracks (Q-010). No integration is mandatory (Q-011). A hosted demo is a plus; keep it up until Nov 18, ideally Nov 25.
- The setup prompt says to look up endpoints and versions in the docs and never guess them, to build on testnet first, and to keep keys in `.env`.

**05 AI Swarms (`swarms`)**, "Many agents, one economy". Lean on multi-agent systems, NEAR Intents and **sub-accounts**. The prompt asks for:
- **each agent its own sub-account under one parent** (`buyer-1.swarm.testnet`…) "so every action on chain traces back to a specific agent";
- a coordinator contract or service that opens rounds, collects sealed bids, reveals and picks a winner, with **rules written in RULES.md before code**;
- a **simulation mode with scripted strategies that runs without any LLM calls** (20 buyers / 5 sellers);
- a **live page** showing rounds, bids, clearing price and who got what;
- start with a text sequence diagram.

HiveFund's per-agent sub-accounts with fn-call keys match this directly. Add a no-LLM sim mode, a RULES.md and the live dashboard. Note that Intents has no testnet (Q-007), so intent settlement would have to happen on mainnet with tiny amounts; it is optional.

**11 Memecoins With Mechanics (`memecoins`)**, "The joke needs rules". Judges **score the mechanic, not the price chart**. Requirements:
- NEP-141 with the **mechanic enforced in the contract, not a backend that could be switched off**;
- all parameters set at launch, publicly readable, with **no admin key** that can change them;
- demo-grade sybil resistance, with its limits stated in the README;
- a page with live state and a log of every mint and burn;
- **simulate first** (60 days, several scenarios) before picking parameters.

Partner: meme.cooking.

**12 Social Money (`social`)**, "Coordinate value together". Build on **Sputnik DAO / Trezu**: "Leave the multisig alone and build what communities do with it." Requirements:
- use the existing DAO or Trezu treasury for custody and approvals;
- reputation tied to **named accounts**, with every point traceable to a finished bounty;
- tiered approvals (auto / one council member / full DAO proposal);
- a public board.

Read the Sputnik and Trezu docs first. Gotcha: near.social writes always show as failed (CodeDoesNotExist) but still land. Confirm via `GET https://api2.near.social/v1/tx/{tx_hash}`.

**Cross-cutting emphasis:**
- On-chain traceability per agent and account.
- Rules are explicit and immutable, enforced in the contract.
- Simulations or LLM-free deterministic modes for reproducibility.
- A live public dashboard.
- A judge-runnable README.

---

## Known pitfalls

1. **Function-call keys cannot attach a deposit.** Any non-zero `deposit` fails with `AccessKeyDepositWithFunctionCallActionError`. Agent-callable methods must be non-payable. If a worker must stake or bond NEAR, it needs a full-access key, or the parent or coordinator funds it via the contract.
2. **Fn-call keys only call one `receiver_id`**, and only the listed `method_names` (an empty list means all). Calls to another contract fail with `AccessKeyReceiverMismatch`. They also can't transfer NEAR, add keys or delete the account. A sub-account with only an fn-call key is **permanently locked** to that contract unless the contract provides key management (docs, access-keys).
3. **Allowance exhaustion is permanent per key.** The allowance cannot be changed, and topping up the balance doesn't help. `addFunctionCallAccessKey()` defaults to **0.25 NEAR**. The allowance is charged at gas *buy* price (above the final cost). Use `undefined` (unlimited) in the raw `actions.addFunctionCallAccessKey` for demo agents, or keep a parent full-access key to rotate keys. An `allowance` of `0` in an AddKey action means *zero*, not unlimited.
4. **Gas is paid from the sub-account's balance**, not the parent's. Fund each agent (about 1 NEAR on testnet is plenty).
5. `account.createSubAccount()` always adds a **full-access** key. Use a manual `createAccount + transfer + addFunctionCallAccessKey` batch for fn-call-only agents.
6. `actions.functionCall()` defaults **gas to 0n**. Always pass `teraToGas("30")` or more.
7. Provider view uses `method`, account call uses `methodName`. It's easy to swap them.
8. `near-kit`'s `near.call<T>()` does **not** decode the return value. It's a cast over `FinalExecutionOutcome`.
9. Raw RPC view results are a **byte array** (`result.result: number[]`), while tx results are **base64** (`status.SuccessValue`). Contract errors in views come back as **HTTP 200 + `result.error`**. JSON-RPC batch arrays are rejected.
10. NEP-413 `verifyMessage` requires a **FullAccess** key. It won't verify agent fn-call-key signatures; use `KeyPair.sign` / `PublicKey.verify` plus a `viewAccessKey` check. NEP-413 nonce must be 32 bytes.
11. **Canonicalize** before signing arbitrary JSON (stable key order, e.g. a sorted-keys stringify, or sign a sha256 of a deterministic encoding). Otherwise off-chain and on-chain verifications disagree.
12. **Next.js SSR:** near-connect needs browser APIs. Load the provider with `dynamic(..., { ssr: false })` from a `'use client'` module, as the official template does. Never import it into server components.
13. **Wallet testnet support varies.** HOT's manifest shows `"testnet": false`. Use `features: { testnet: true }` and test the login flow with a testnet-capable wallet before demo day.
14. `waitUntil: 'INCLUDED'`/`'NONE'` returns before execution: no return value, and failures are not thrown. The default `EXECUTED_OPTIMISTIC` is right for agents. Use `'FINAL'` only where irreversibility matters.
15. Nonce races: a single key shared by concurrent tasks inside one agent can hit `InvalidNonceError`. near-api-js retries up to 10×, but serialize per agent or use `MultiKeySigner`.
16. Public RPC limits are unpublished (fastnear) or "severely rate limited" (`archival-rpc.testnet.near.org`). Use a FastNear key (Bearer header, server-side only; a domain-restricted browser key for the dashboard) plus `FailoverRpcProvider`, and avoid tight polling loops.
17. **NEAR AI model IDs drift.** The docs examples (`zai-org/GLM-5.1-FP8`) aren't in today's `/v1/models`. Read `/v1/models` and keep the model in env. Reasoning models put thinking in `reasoning_content`, so parse `content`, cap `thinking_token_budget`, and validate JSON with zod, retrying on failure.
18. The NEAR Builders $10 credit is a **separate API key**. It won't show in the cloud.near.ai dashboard. Keep it out of git (the hackathon checks history for secrets).
19. Node: near-api-js 7.4 and near-connect declare **>=22.22.2**. Pin it in `engines`/`.nvmrc` so judges reproducing the README don't hit odd failures.
20. NEAR Intents has **no testnet** (Q-007). If the Swarms "intent settlement" angle is used, it's mainnet with tiny amounts and `dry: true` quotes; otherwise keep settlement in our own testnet contract.
