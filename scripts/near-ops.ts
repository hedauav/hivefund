// Shared helpers for scripts/setup-testnet.ts and scripts/topup.ts (Stream A).
// near-api-js 7.4.0. Never prints private keys.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Account,
  JsonRpcProvider,
  KeyPair,
  baseEncode,
  type KeyPairString,
} from "near-api-js";

export const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const ENV_LOCAL = resolve(ROOT_DIR, ".env.local");
export const DEPLOYMENT_JSON = resolve(ROOT_DIR, "config", "deployment.testnet.json");
export const EXPLORER = "https://testnet.nearblocks.io";
export const DEFAULT_RPCS = ["https://test.rpc.fastnear.com", "https://near-testnet.drpc.org"];

// ------------------------------------------------------------------ env (.env.local)

export function loadEnvFile(path = ENV_LOCAL): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[line.slice(0, eq).trim()] = v;
  }
  return out;
}

/** process.env wins over .env.local. */
export function env(name: string, fallback?: string): string | undefined {
  const fromProcess = process.env[name];
  if (fromProcess !== undefined && fromProcess !== "") return fromProcess;
  const v = loadEnvFile()[name];
  return v !== undefined && v !== "" ? v : fallback;
}

/** Insert or replace KEY=value lines in .env.local, keeping everything else untouched. */
export function upsertEnv(values: Record<string, string>, path = ENV_LOCAL): void {
  const lines = existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/) : [];
  const pending = new Map(Object.entries(values));
  const out = lines.map((line) => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && pending.has(m[1])) {
      const v = pending.get(m[1])!;
      pending.delete(m[1]);
      return `${m[1]}=${v}`;
    }
    return line;
  });
  while (out.length && out[out.length - 1] === "") out.pop();
  for (const [k, v] of pending) out.push(`${k}=${v}`);
  writeFileSync(path, out.join("\n") + "\n", { encoding: "utf8" });
}

// ------------------------------------------------------------------ amounts

const YOCTO_DIGITS = 24;

/** "0.1" -> 100000000000000000000000n (exact decimal, no float). */
export function nearToYoctoExact(near: string | number): bigint {
  const s = String(near).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`invalid NEAR amount: ${s}`);
  const [int, frac = ""] = s.split(".");
  if (frac.length > YOCTO_DIGITS) throw new Error(`too many decimals: ${s}`);
  return BigInt(int) * 10n ** 24n + BigInt(frac.padEnd(YOCTO_DIGITS, "0") || "0");
}

export function fmtNear(yocto: bigint, digits = 4): string {
  const neg = yocto < 0n;
  const v = neg ? -yocto : yocto;
  const int = v / 10n ** 24n;
  const frac = (v % 10n ** 24n).toString().padStart(24, "0").slice(0, digits);
  return `${neg ? "-" : ""}${int}.${frac} NEAR`;
}

export function envNear(name: string, fallback: string): bigint {
  return nearToYoctoExact(env(name, fallback)!);
}

// ------------------------------------------------------------------ wasm

export interface WasmInfo {
  path: string;
  bytes: number;
  sha256Hex: string;
  /** base58(sha256) == account view `code_hash` */
  codeHash: string;
  code: Uint8Array;
}

export function findWasm(crate: "bounty_hub" | "hive_token"): WasmInfo | null {
  const candidates = [
    resolve(ROOT_DIR, "contracts", "target", "near", crate, `${crate}.wasm`),
    resolve(ROOT_DIR, "contracts", "target", "near", `${crate}.wasm`),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      const code = new Uint8Array(readFileSync(p));
      const digest = createHash("sha256").update(code).digest();
      return {
        path: p,
        bytes: code.length,
        sha256Hex: digest.toString("hex"),
        codeHash: baseEncode(new Uint8Array(digest)),
        code,
      };
    }
  }
  return null;
}

/** Code storage: 1 NEAR per 100 KB (storage_byte_cost 1e19 yocto/byte), rounded up to whole NEAR. */
export function codeStorageNear(bytes: number): bigint {
  return BigInt(Math.ceil(bytes / 100_000)) * 10n ** 24n;
}

// ------------------------------------------------------------------ RPC with fallback + retries

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function errMsg(e: unknown): string {
  if (e instanceof Error) {
    const extra = (e as { panicMessage?: string }).panicMessage;
    return extra && !e.message.includes(extra) ? `${e.message} (${extra})` : e.message;
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

const TRANSIENT = [
  /fetch failed/i,
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR/,
  /socket hang up/i,
  /time(d)?[ -]?out/i,
  /\b429\b|too many requests|rate limit/i,
  /\b50[0234]\b|service unavailable|server error|bad gateway/i,
  /InvalidNonce|nonce/i,
  /Expired/i,
  /UNKNOWN_BLOCK|UNKNOWN_CHUNK|Unknown block/i,
  /network/i,
];
const FINAL = /Smart contract panicked|ERR_[A-Z_]+|MethodNotFound|CodeDoesNotExist|MethodNameMismatch|ReceiverMismatch|NotEnoughAllowance|NotEnoughBalance|LackBalance|AccessKey|does not exist|UNKNOWN_ACCOUNT/i;

export function isTransient(e: unknown): boolean {
  const m = errMsg(e);
  if (FINAL.test(m)) return false;
  return TRANSIENT.some((r) => r.test(m));
}

export function isMissingAccount(e: unknown): boolean {
  return /does not exist|UNKNOWN_ACCOUNT|AccountDoesNotExist/i.test(errMsg(e));
}

export class Net {
  readonly urls: string[];
  readonly providers: JsonRpcProvider[];
  private active = 0;

  constructor(urls: string[] = [env("RPC_URL", DEFAULT_RPCS[0])!, env("RPC_FALLBACK_URL", DEFAULT_RPCS[1])!]) {
    this.urls = urls.filter((u, i, a) => !!u && a.indexOf(u) === i);
    this.providers = this.urls.map((url) => new JsonRpcProvider({ url }));
  }

  /** Read-only call with failover across RPCs and exponential backoff on transient errors. */
  async read<T>(label: string, fn: (p: JsonRpcProvider) => Promise<T>, retries = 5): Promise<T> {
    let last: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const idx = (this.active + attempt) % this.providers.length;
      try {
        const r = await fn(this.providers[idx]);
        this.active = idx;
        return r;
      } catch (e) {
        last = e;
        if (!isTransient(e)) throw e;
        await sleep(Math.min(8000, 500 * 2 ** attempt));
      }
    }
    throw new Error(`${label}: RPC failed after retries: ${errMsg(last)}`);
  }

  account(accountId: string, privateKey: string): Account {
    return new Account(accountId, this.providers[this.active], privateKey as KeyPairString);
  }

  /** null when the account does not exist. */
  async viewAccount(accountId: string) {
    try {
      return await this.read(`viewAccount ${accountId}`, (p) => p.viewAccount({ accountId, finality: "final" } as never));
    } catch (e) {
      if (isMissingAccount(e)) return null;
      throw e;
    }
  }

  async view<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
    return this.read(`view ${contractId}.${method}`, async (p) => (await p.callFunction({ contractId, method, args })) as T);
  }

  /** View that returns null when the contract is missing / not initialized / panics. */
  async tryView<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T | null> {
    try {
      return await this.view<T>(contractId, method, args);
    } catch (e) {
      if (isTransient(e)) throw e;
      return null;
    }
  }

  /** Access-key permission, or null if the key is not on the account. */
  async accessKey(accountId: string, publicKey: string) {
    try {
      return await this.read(`viewAccessKey ${accountId}`, (p) =>
        p.viewAccessKey({ accountId, publicKey, finality: "final" } as never),
      );
    } catch (e) {
      if (/does not exist|UNKNOWN_ACCESS_KEY|AccessKeyDoesNotExist|UNKNOWN_ACCOUNT/i.test(errMsg(e))) return null;
      throw e;
    }
  }

  /**
   * Sign + send one transaction. Never resends a tx that may have landed: if the send itself fails
   * transiently, the caller's idempotent `step` re-checks chain state before trying again.
   * Returns the tx hash and, for failed executions, the failure message.
   */
  async send(
    signerId: string,
    privateKey: string,
    receiverId: string,
    txActions: Parameters<Account["signAndSendTransaction"]>[0]["actions"],
  ): Promise<{ txHash: string; ok: boolean; failure: string | null; result: unknown }> {
    const account = this.account(signerId, privateKey);
    const res = await account.signAndSendTransaction({
      receiverId,
      actions: txActions,
      throwOnFailure: false,
      waitUntil: "EXECUTED_OPTIMISTIC",
    });
    const txHash = res.transaction_outcome.id;
    const failure = findFailure(res);
    let result: unknown = undefined;
    const sv = (res.status as { SuccessValue?: string })?.SuccessValue;
    if (sv) {
      try {
        result = JSON.parse(Buffer.from(sv, "base64").toString("utf8"));
      } catch {
        result = sv;
      }
    }
    return { txHash, ok: failure === null, failure, result };
  }
}

/** First failure in the tx outcome or any receipt outcome (cross-contract failures included). */
export function findFailure(res: unknown): string | null {
  const r = res as {
    status?: { Failure?: unknown };
    transaction_outcome?: { outcome?: { status?: { Failure?: unknown } } };
    receipts_outcome?: { outcome?: { status?: { Failure?: unknown } } }[];
  };
  const fails: unknown[] = [];
  if (r.status && "Failure" in (r.status as object)) fails.push(r.status.Failure);
  const t = r.transaction_outcome?.outcome?.status;
  if (t && "Failure" in (t as object)) fails.push(t.Failure);
  for (const ro of r.receipts_outcome ?? []) {
    const s = ro.outcome?.status;
    if (s && "Failure" in (s as object)) fails.push(s.Failure);
  }
  return fails.length ? JSON.stringify(fails[0]) : null;
}

export function txUrl(hash: string): string {
  return `${EXPLORER}/txns/${hash}`;
}

/**
 * Idempotent step runner: `done()` checks chain state; `run()` performs the change. On any error
 * the state is re-checked (the tx may have landed despite a client-side timeout) before retrying.
 */
export async function step<T>(
  label: string,
  done: () => Promise<boolean>,
  run: () => Promise<T>,
  opts: { retries?: number; log?: (s: string) => void } = {},
): Promise<{ skipped: boolean; value?: T }> {
  const log = opts.log ?? ((s: string) => console.log(s));
  if (await done()) {
    log(`  = ${label}: already done`);
    return { skipped: true };
  }
  const retries = opts.retries ?? 3;
  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const value = await run();
      log(`  + ${label}`);
      return { skipped: false, value };
    } catch (e) {
      last = e;
      await sleep(1500 * (attempt + 1));
      if (await done().catch(() => false)) {
        log(`  + ${label} (landed despite client error)`);
        return { skipped: false };
      }
      if (!isTransient(e)) break;
      log(`  ! ${label}: transient error, retrying (${errMsg(e).slice(0, 120)})`);
    }
  }
  throw new Error(`${label} failed: ${errMsg(last)}`);
}

export function newKey(): KeyPair {
  return KeyPair.fromRandom("ed25519");
}

export function publicKeyOf(secret: string): string {
  return KeyPair.fromString(secret as KeyPairString).getPublicKey().toString();
}

export function readDeployment(): Record<string, unknown> {
  if (!existsSync(DEPLOYMENT_JSON)) return {};
  try {
    return JSON.parse(readFileSync(DEPLOYMENT_JSON, "utf8"));
  } catch {
    return {};
  }
}

export function writeDeployment(obj: Record<string, unknown>): void {
  writeFileSync(DEPLOYMENT_JSON, JSON.stringify(obj, null, 2) + "\n", "utf8");
}
