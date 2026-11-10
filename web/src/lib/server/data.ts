// Server-only file access for API routes: deployment config, the off-chain
// content-addressed store, strategy logs and the tx log.
//
// Live mode (a deployment exists) reads the real agent output:
//   $HIVEFUND_DATA_DIR (default <repo>/data), then web/public/offchain (exported snapshot).
// Sample mode (no deployment) reads <repo>/data/sample, then web/fixtures.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { canonicalize, hashJson, isHash, type DeploymentConfig, type StrategyChange } from "@hivefund/shared";
import type { ChainSnapshot, OffchainIndexEntry, TxLogEntry, WebConfig } from "../snapshot";

// Runtime-resolved paths: excluded from Turbopack's static file tracing
// (next.config.ts lists the data folders explicitly via outputFileTracingIncludes).
const p = (...parts: string[]) => path.join(/*turbopackIgnore: true*/ ...parts);
const resolve = (...parts: string[]) => path.resolve(/*turbopackIgnore: true*/ ...parts);
const cwd = process.cwd();
/** Repo root whether Next runs from /web (normal) or from the repo root. */
export const REPO_ROOT = existsSync(p(cwd, "web", "package.json")) ? cwd : resolve(cwd, "..");
const WEB_ROOT = p(REPO_ROOT, "web");

// chain-state.json is Stream B's readChainState() export (agents/shared/src/node/snapshot.ts).
const SNAPSHOT_NAMES = ["chain-state.json", "chain-snapshot.json", "snapshot.json", "chain.json"];

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as T];
      } catch {
        return [];
      }
    });
}

export function loadDeployment(): DeploymentConfig | null {
  const network = process.env.NEXT_PUBLIC_NETWORK === "mainnet" ? "mainnet" : "testnet";
  const dep = readJson<DeploymentConfig>(p(REPO_ROOT, "config", `deployment.${network}.json`));
  return dep && dep.hub ? dep : null;
}

export function getWebConfig(): WebConfig {
  const dep = loadDeployment();
  const network = process.env.NEXT_PUBLIC_NETWORK === "mainnet" ? "mainnet" : (dep?.network ?? "testnet");
  // HIVEFUND_FORCE_SAMPLE=1 is a local design/testing switch: it still shows the SAMPLE DATA banner.
  const forceSample = process.env.HIVEFUND_FORCE_SAMPLE === "1";
  const hub = forceSample ? null : process.env.NEXT_PUBLIC_HUB_CONTRACT || dep?.hub || null;
  const token = forceSample ? null : process.env.NEXT_PUBLIC_TOKEN_CONTRACT || dep?.token || null;
  const rpcUrl =
    process.env.NEXT_PUBLIC_RPC_URL ||
    dep?.rpcUrl ||
    (network === "mainnet" ? "https://free.rpc.fastnear.com" : "https://test.rpc.fastnear.com");
  const explorer = dep?.explorer || (network === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io");
  const mode = hub ? "live" : "mock";
  return {
    mode,
    network,
    rpcUrl,
    hub,
    token,
    explorer,
    dataSource: mode === "live" ? `testnet contract ${hub}` : sampleDir().label,
  };
}

/** Directories searched for off-chain data, in priority order. */
export function dataDirs(): string[] {
  if (getWebConfig().mode === "live") {
    const env = process.env.HIVEFUND_DATA_DIR;
    const dataDir = env ? resolve(REPO_ROOT, env) : p(REPO_ROOT, "data");
    return [dataDir, p(WEB_ROOT, "public", "offchain")];
  }
  return [sampleDir().dir];
}

function sampleDir(): { dir: string; label: string } {
  const sample = p(REPO_ROOT, "data", "sample");
  if (SNAPSHOT_NAMES.some((n) => existsSync(p(sample, n)))) {
    return { dir: sample, label: "data/sample (mock agent run)" };
  }
  return { dir: p(WEB_ROOT, "fixtures"), label: "web/fixtures (generated sample)" };
}

export function loadSampleSnapshot(): ChainSnapshot | null {
  const { dir } = sampleDir();
  for (const n of SNAPSHOT_NAMES) {
    const raw = readJson<Record<string, unknown>>(p(dir, n));
    if (raw) return normalizeSnapshot(raw, dir.endsWith("fixtures") ? "fixture" : "sample");
  }
  return null;
}

/** Accepts both the web ChainSnapshot and Stream B's ChainState ({bids: Record, supply_history, captured_at}). */
function normalizeSnapshot(raw: Record<string, unknown>, source: ChainSnapshot["source"]): ChainSnapshot {
  const r = raw as Partial<ChainSnapshot> & {
    bids?: ChainSnapshot["bids"] | Record<string, ChainSnapshot["bids"]>;
    supply_history?: ChainSnapshot["supply"];
    captured_at?: string;
  };
  const bids: ChainSnapshot["bids"] = Array.isArray(r.bids) ? r.bids : Object.values((r.bids ?? {}) as Record<string, ChainSnapshot["bids"]>).flat();
  return {
    source,
    generated_ms: r.generated_ms ?? (r.captured_at ? Date.parse(r.captured_at) : Date.now()),
    config: r.config!,
    bounties: r.bounties ?? [],
    bids: [...bids].sort((a, b) => a.id - b.id),
    treasury: r.treasury!,
    reputation: r.reputation ?? [],
    activity: r.activity ?? [],
    supply: r.supply ?? r.supply_history ?? [],
  };
}

export type OffchainLookup =
  | { status: "ok"; hash: string; object: unknown; verified: true; file: string }
  | { status: "mismatch"; hash: string; recomputed: string; file: string }
  | { status: "missing"; hash: string };

/** Reads <dir>/offchain/<hash>.json (or <dir>/<hash>.json) and re-hashes it. */
export function readOffchain(hash: string): OffchainLookup {
  if (!isHash(hash)) return { status: "missing", hash };
  for (const dir of dataDirs()) {
    for (const file of [p(dir, "offchain", `${hash}.json`), p(dir, `${hash}.json`)]) {
      if (!existsSync(file)) continue;
      const obj = readJson<unknown>(file);
      if (obj === null) continue;
      const recomputed = hashJson(obj);
      if (recomputed !== hash) return { status: "mismatch", hash, recomputed, file };
      return { status: "ok", hash, object: obj, verified: true, file };
    }
  }
  return { status: "missing", hash };
}

export function readIndex(): OffchainIndexEntry[] {
  const seen = new Set<string>();
  const out: OffchainIndexEntry[] = [];
  for (const dir of dataDirs()) {
    for (const e of readJsonl<OffchainIndexEntry>(p(dir, "index.jsonl"))) {
      if (!e?.hash || seen.has(e.hash)) continue;
      seen.add(e.hash);
      out.push(e);
    }
  }
  return out;
}

export function readStrategy(worker?: string): Record<string, StrategyChange[]> {
  const out: Record<string, StrategyChange[]> = {};
  for (const dir of dataDirs()) {
    const sdir = p(dir, "strategy");
    if (!existsSync(sdir)) continue;
    for (const f of readdirSync(sdir)) {
      if (!f.endsWith(".jsonl")) continue;
      const name = f.slice(0, -".jsonl".length);
      if (worker && name !== worker) continue;
      if (out[name]) continue;
      out[name] = readJsonl<StrategyChange>(p(sdir, f)).sort((a, b) => a.ts_ms - b.ts_ms);
    }
  }
  return out;
}

export function readTxLog(): TxLogEntry[] {
  for (const dir of dataDirs()) {
    const rows = readJsonl<TxLogEntry>(p(dir, "tx.jsonl"));
    if (rows.length) return rows;
  }
  return [];
}

/** Re-serialise canonically (used to show exactly the hashed bytes). */
export { canonicalize };
