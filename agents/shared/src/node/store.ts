// Content-addressed off-chain store. Every object is written as exactly canonicalize(obj) to
// <dir>/offchain/<sha256>.json, so anyone can re-hash a file and compare it with the on-chain hash.
import fs from "node:fs";
import path from "node:path";
import { canonicalize, sha256Hex, isHash } from "../canonical.ts";
import type { AccountId, OffchainKind, StrategyChange } from "../types.ts";
import type { TxLogEntry } from "./hub.ts";
import { dataDir } from "./config.ts";

export interface PutMeta {
  kind: OffchainKind;
  bounty_id?: number;
  round?: number;
  actor: AccountId;
}

export interface IndexEntry {
  hash: string;
  kind: OffchainKind;
  bounty_id: number | null;
  round: number | null;
  actor: AccountId;
  ts: number;
}

export class OffchainStore {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = path.resolve(dir);
    fs.mkdirSync(path.join(this.dir, "offchain"), { recursive: true });
    fs.mkdirSync(path.join(this.dir, "strategy"), { recursive: true });
  }

  /** Store obj; returns its content hash (sha256 of canonical JSON). Idempotent. */
  put(obj: unknown, meta: PutMeta): string {
    const text = canonicalize(obj);
    const hash = sha256Hex(text);
    const file = this.objPath(hash);
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, text, "utf8");
      const entry: IndexEntry = {
        hash,
        kind: meta.kind,
        bounty_id: meta.bounty_id ?? null,
        round: meta.round ?? null,
        actor: meta.actor,
        ts: Date.now(),
      };
      fs.appendFileSync(path.join(this.dir, "index.jsonl"), JSON.stringify(entry) + "\n", "utf8");
    }
    return hash;
  }

  has(hash: string): boolean {
    return isHash(hash) && fs.existsSync(this.objPath(hash));
  }

  /** Load by hash; re-hashes the file and throws on mismatch or absence. */
  get<T = unknown>(hash: string): T {
    if (!isHash(hash)) throw new Error(`store.get: not a sha256 hash: ${hash}`);
    const file = this.objPath(hash);
    if (!fs.existsSync(file)) throw new Error(`store.get: ${hash} not found in ${this.dir}`);
    const text = fs.readFileSync(file, "utf8");
    const actual = sha256Hex(text);
    if (actual !== hash) throw new Error(`store.get: hash mismatch for ${hash} (file hashes to ${actual})`);
    return JSON.parse(text) as T;
  }

  readIndex(): IndexEntry[] {
    return readJsonl<IndexEntry>(path.join(this.dir, "index.jsonl"));
  }

  appendStrategy(worker: AccountId, change: StrategyChange): void {
    fs.appendFileSync(this.strategyPath(worker), JSON.stringify(change) + "\n", "utf8");
  }

  readStrategy(worker: AccountId): StrategyChange[] {
    return readJsonl<StrategyChange>(this.strategyPath(worker));
  }

  /** Workers that have a strategy log. */
  strategyWorkers(): AccountId[] {
    const d = path.join(this.dir, "strategy");
    return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith(".jsonl")).map((f) => f.slice(0, -6)) : [];
  }

  appendTx(e: TxLogEntry | { ts: number; actor: AccountId; method: string; args: unknown; txHash: string | null; [k: string]: unknown }): void {
    fs.appendFileSync(path.join(this.dir, "tx.jsonl"), JSON.stringify(e) + "\n", "utf8");
  }

  readTx(): TxLogEntry[] {
    return readJsonl<TxLogEntry>(path.join(this.dir, "tx.jsonl"));
  }

  /** Copy offchain/, strategy/, index.jsonl, tx.jsonl (and any *.json at top level) into `dest`. */
  exportSnapshot(dest: string): void {
    const to = path.resolve(dest);
    fs.mkdirSync(to, { recursive: true });
    for (const sub of ["offchain", "strategy"]) {
      const src = path.join(this.dir, sub);
      if (fs.existsSync(src)) fs.cpSync(src, path.join(to, sub), { recursive: true });
    }
    for (const f of fs.readdirSync(this.dir)) {
      const p = path.join(this.dir, f);
      if (fs.statSync(p).isFile() && (f.endsWith(".jsonl") || f.endsWith(".json"))) fs.copyFileSync(p, path.join(to, f));
    }
  }

  /** Write an arbitrary JSON file at the store root (e.g. chain-state.json). */
  writeJson(name: string, obj: unknown): void {
    fs.writeFileSync(path.join(this.dir, name), JSON.stringify(obj, null, 2) + "\n", "utf8");
  }

  private objPath(hash: string): string {
    return path.join(this.dir, "offchain", `${hash}.json`);
  }
  private strategyPath(worker: AccountId): string {
    if (!/^[a-z0-9._-]+$/.test(worker)) throw new Error(`bad worker id ${worker}`);
    return path.join(this.dir, "strategy", `${worker}.jsonl`);
  }
}

function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);
}

/** Store at $HIVEFUND_DATA_DIR (default <repo>/data). */
export function openStore(dir?: string): OffchainStore {
  return new OffchainStore(dir ?? dataDir());
}
