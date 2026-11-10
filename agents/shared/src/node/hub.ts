// HubClient: one interface, two implementations.
//  - NearHubClient (primary): real testnet/mainnet calls via near-api-js 7.4, one function-call key per agent.
//  - MockHubClient (via MockChain in mock-chain.ts): in-memory port for unit tests / offline dev only.
import { Account, JsonRpcProvider, getTransactionLastResult, teraToGas } from "near-api-js";
import type { KeyPairString } from "near-api-js";
import type { AccountId, HubError } from "../types.ts";
import { HUB_ERRORS } from "../types.ts";

export interface CallOpts {
  /** Gas in TGas (default 100). */
  gasTGas?: number;
  /** Attached deposit in yoctoNEAR (decimal string). Function-call keys cannot attach deposits. */
  depositYocto?: string;
}

export interface CallResult<T = unknown> {
  txHash: string;
  result: T;
}

export interface HubClient {
  /** The signer (agent sub-account). */
  readonly accountId: AccountId;
  /** The contract this client talks to (hub or token). */
  readonly contractId: AccountId;
  view<T>(method: string, args?: Record<string, unknown>): Promise<T>;
  call<T = unknown>(method: string, args: Record<string, unknown>, opts?: CallOpts): Promise<CallResult<T>>;
}

/** Error thrown by HubClient.call/view. `message` contains the contract's ERR_* code when there is one. */
export class HubCallError extends Error {
  readonly code: string | null;
  readonly txHash: string | null;
  constructor(message: string, txHash: string | null = null) {
    super(message);
    this.name = "HubCallError";
    this.code = extractErrCode(message);
    this.txHash = txHash;
  }
}

const ALL_CODES: readonly string[] = [...HUB_ERRORS, "ERR_NOT_MINTER"];

export function extractErrCode(message: string): string | null {
  const m = message.match(/ERR_[A-Z_]+/g);
  if (!m) return null;
  return m.find((c) => ALL_CODES.includes(c)) ?? m[0];
}

/** The ERR_* code of an error thrown by a HubClient, or null. */
export function hubErrorCode(err: unknown): HubError | "ERR_NOT_MINTER" | string | null {
  if (err instanceof HubCallError) return err.code;
  if (err instanceof Error) return extractErrCode(err.message);
  return null;
}

// ------------------------------------------------------------------------------------------
// NearHubClient — the primary path (real testnet / mainnet)
// ------------------------------------------------------------------------------------------

export interface TxLogEntry {
  ts: number;
  actor: AccountId;
  contract: AccountId;
  method: string;
  args: Record<string, unknown>;
  txHash: string | null;
  ok: boolean;
  error?: string;
  explorer?: string;
}

export interface NearHubClientOpts {
  accountId: AccountId;
  /** "ed25519:..." secret (function-call or full-access key). Omit for a read-only client. */
  privateKey?: string;
  contractId: AccountId;
  /** Primary RPC (default fastnear testnet). */
  rpcUrl?: string;
  /** Fallback RPCs tried in order when the primary fails (default drpc testnet). */
  fallbackRpcUrls?: string[];
  /** Explorer base for tx links (default https://testnet.nearblocks.io). */
  explorer?: string;
  /** Called after every call (success or failure); wire it to OffchainStore.appendTx. */
  onTx?: (e: TxLogEntry) => void;
  /** Transient-failure retries per call (default 3). */
  retries?: number;
}

export const DEFAULT_TESTNET_RPC = "https://test.rpc.fastnear.com";
export const DEFAULT_TESTNET_FALLBACK_RPCS = ["https://near-testnet.drpc.org"];
export const DEFAULT_TESTNET_EXPLORER = "https://testnet.nearblocks.io";

export function txUrl(txHash: string, explorer = DEFAULT_TESTNET_EXPLORER): string {
  return `${explorer}/txns/${txHash}`;
}

/**
 * Real NEAR client. Each agent gets its own instance with its own function-call key.
 * - views and calls fail over across RPC endpoints (primary -> fallbacks);
 * - transient errors (network, timeouts, 429/5xx, InvalidNonce, expired tx) are retried with backoff;
 * - calls from one client are serialized, so one access key never races on its nonce;
 * - contract panics are NOT retried: they throw HubCallError carrying the ERR_* code and tx hash.
 */
export class NearHubClient implements HubClient {
  readonly accountId: AccountId;
  readonly contractId: AccountId;
  readonly explorer: string;
  readonly rpcUrls: string[];
  private readonly providers: JsonRpcProvider[];
  private readonly accounts: (Account | null)[];
  private readonly onTx?: (e: TxLogEntry) => void;
  private readonly retries: number;
  private active = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(opts: NearHubClientOpts) {
    this.accountId = opts.accountId;
    this.contractId = opts.contractId;
    this.explorer = opts.explorer ?? DEFAULT_TESTNET_EXPLORER;
    this.rpcUrls = [opts.rpcUrl ?? DEFAULT_TESTNET_RPC, ...(opts.fallbackRpcUrls ?? DEFAULT_TESTNET_FALLBACK_RPCS)].filter(
      (u, i, a) => a.indexOf(u) === i,
    );
    this.providers = this.rpcUrls.map((url) => new JsonRpcProvider({ url }, { retries: 2, wait: 400, backoff: 1.6 }));
    this.accounts = this.providers.map((p) =>
      opts.privateKey ? new Account(opts.accountId, p, opts.privateKey as KeyPairString) : null,
    );
    this.onTx = opts.onTx;
    this.retries = opts.retries ?? 3;
  }

  async view<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const idx = (this.active + attempt) % this.providers.length;
      try {
        const r = await this.providers[idx].callFunction({ contractId: this.contractId, method, args });
        this.active = idx;
        return r as T;
      } catch (e) {
        lastErr = e;
        if (!isTransient(e)) break; // contract-level view error (panic, missing method): final
        await sleep(backoffMs(attempt));
      }
    }
    throw new HubCallError(`view ${this.contractId}.${method} failed: ${errMsg(lastErr)}`);
  }

  call<T = unknown>(method: string, args: Record<string, unknown>, opts: CallOpts = {}): Promise<CallResult<T>> {
    const run = this.queue.then(() => this.callInner<T>(method, args, opts));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async callInner<T>(method: string, args: Record<string, unknown>, opts: CallOpts): Promise<CallResult<T>> {
    if (!this.accounts[0]) throw new HubCallError(`call ${method}: client for ${this.accountId} has no private key`);
    let lastErr: unknown;
    let lastHash: string | null = null;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const idx = (this.active + attempt) % this.accounts.length;
      const account = this.accounts[idx]!;
      try {
        const res = await account.callFunctionRaw({
          contractId: this.contractId,
          methodName: method,
          args,
          gas: teraToGas(opts.gasTGas ?? 100),
          deposit: BigInt(opts.depositYocto ?? "0"),
        });
        this.active = idx;
        const txHash = res.transaction_outcome.id;
        const failure = findReceiptFailure(res);
        if (failure) {
          const err = new HubCallError(`call ${this.contractId}.${method} failed: ${failure}`, txHash);
          this.log(method, args, txHash, false, err.message);
          throw err;
        }
        let result: unknown;
        try {
          result = getTransactionLastResult(res as never);
        } catch {
          result = undefined;
        }
        this.log(method, args, txHash, true);
        return { txHash, result: result as T };
      } catch (e) {
        if (e instanceof HubCallError) throw e;
        lastErr = e;
        lastHash = errTxHash(e) ?? lastHash;
        // A tx that landed (has a hash) or a contract/access-key error is final; never resend it.
        if (lastHash || !isTransient(e)) break;
        await sleep(backoffMs(attempt));
      }
    }
    const err = new HubCallError(`call ${this.contractId}.${method} failed: ${errMsg(lastErr)}`, lastHash);
    this.log(method, args, lastHash, false, err.message);
    throw err;
  }

  private log(method: string, args: Record<string, unknown>, txHash: string | null, ok: boolean, error?: string) {
    if (!this.onTx) return;
    try {
      this.onTx({
        ts: Date.now(),
        actor: this.accountId,
        contract: this.contractId,
        method,
        args,
        txHash,
        ok,
        ...(error ? { error: error.slice(0, 500) } : {}),
        ...(txHash ? { explorer: txUrl(txHash, this.explorer) } : {}),
      });
    } catch {
      /* logging must never break a call */
    }
  }
}

const FINAL_PATTERN = /Smart contract panicked|ERR_[A-Z_]+|MethodNotFound|CodeDoesNotExist|AccessKey|NotEnoughBalance|LackBalance/i;
const TRANSIENT_PATTERNS = [
  /fetch failed/i,
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/,
  /socket hang up/i,
  /time(d)? ?out/i,
  /\b429\b|too many requests/i,
  /\b50[0234]\b|service unavailable|server error/i,
  /InvalidNonce|nonce/i,
  /Expired/i,
  /RetriesExceeded|Exceeded \d+ attempts/i,
  /UNKNOWN_BLOCK|UNKNOWN_CHUNK/i,
  /network/i,
];

export function isTransient(e: unknown): boolean {
  const msg = errMsg(e);
  if (FINAL_PATTERN.test(msg)) return false;
  return TRANSIENT_PATTERNS.some((r) => r.test(msg));
}

function errTxHash(e: unknown): string | null {
  const any = e as { transactionResult?: { transaction_outcome?: { id?: string } }; txHash?: string } | undefined;
  return any?.transactionResult?.transaction_outcome?.id ?? any?.txHash ?? null;
}

function backoffMs(attempt: number): number {
  return Math.min(4000, 500 * 2 ** attempt) + Math.floor(Math.random() * 200);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function errMsg(e: unknown): string {
  if (e instanceof Error) {
    const panic = (e as { panicMessage?: string }).panicMessage;
    return panic && !e.message.includes(panic) ? `${e.message} (${panic})` : e.message;
  }
  return String(e);
}

function findReceiptFailure(res: unknown): string | null {
  const r = res as { status?: unknown };
  if (r.status && typeof r.status === "object" && "Failure" in r.status && (r.status as { Failure?: unknown }).Failure) {
    return JSON.stringify((r.status as { Failure: unknown }).Failure);
  }
  return null;
}
