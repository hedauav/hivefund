// Server-only file access for API routes: deployment config, the off-chain
// content-addressed store, strategy logs and the tx log.
//
// Live mode (a deployment exists): chain views always come from RPC in the browser. Off-chain
// records are merged by hash from, in order:
//   1. $HIVEFUND_DATA_DIR (default <repo>/data): live agent output on this machine
//   2. the recorded testnet run (data/testnet-run/, bundled into src/generated/recorded-run.json
//      at prebuild so it is readable on any host), used only when it belongs to the same hub
//   3. web/public/offchain (optional exported snapshot)
// Sample mode (no deployment anywhere) reads <repo>/data/sample, then web/fixtures.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { canonicalize, hashJson, isHash, type DeploymentConfig, type StrategyChange } from "@hivefund/shared";
import type { ChainSnapshot, OffchainIndexEntry, TxLogEntry, WebConfig } from "../snapshot";
import recordedRun from "@/generated/recorded-run.json";

interface RecordedRun {
  available: boolean;
  manifest: { label: string; hub: string; token: string; captured_at: string; network: string } | null;
  deployment: DeploymentConfig | null;
  index: (OffchainIndexEntry & { ts?: number })[];
  strategy: Record<string, StrategyChange[]>;
  tx: TxLogEntry[];
  offchain: Record<string, unknown>;
}
const RECORDED = recordedRun as unknown as RecordedRun;

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
  if (dep?.hub) return dep;
  // Hosted builds: the deployment config is bundled with the recorded run.
  const bundled = RECORDED.deployment;
  return bundled?.hub && bundled.network === network ? bundled : null;
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
  const rec = mode === "live" ? recordedFor(hub) : null;
  return {
    mode,
    network,
    rpcUrl,
    hub,
    token,
    explorer,
    dataSource: mode === "live" ? `testnet contract ${hub}` : sampleDir().label,
    recorded: rec ? { label: "recorded testnet run", captured_at: rec.manifest!.captured_at, objects: Object.keys(rec.offchain).length, txs: rec.tx.length } : null,
  };
}

/** The bundled recorded run, only if it was recorded against this hub. */
function recordedFor(hub: string | null): RecordedRun | null {
  return RECORDED.available && RECORDED.manifest?.hub === hub ? RECORDED : null;
}
const recorded = () => (getWebConfig().mode === "live" ? recordedFor(getWebConfig().hub) : null);

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
  const rec = recorded();
  if (rec && hash in rec.offchain) {
    const obj = rec.offchain[hash];
    const recomputed = hashJson(obj);
    if (recomputed !== hash) return { status: "mismatch", hash, recomputed, file: "recorded testnet run" };
    return { status: "ok", hash, object: obj, verified: true, file: "recorded testnet run" };
  }
  return { status: "missing", hash };
}

export function readIndex(): OffchainIndexEntry[] {
  const seen = new Set<string>();
  const out: OffchainIndexEntry[] = [];
  const add = (e: OffchainIndexEntry & { ts?: number }) => {
    if (!e?.hash || seen.has(e.hash)) return;
    seen.add(e.hash);
    out.push({ ...e, ts_ms: e.ts_ms ?? e.ts, bounty_id: e.bounty_id ?? undefined, round: e.round ?? undefined });
  };
  for (const dir of dataDirs()) readJsonl<OffchainIndexEntry>(p(dir, "index.jsonl")).forEach(add);
  recorded()?.index.forEach(add);
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
      out[name] = mergeStrategy(out[name], readJsonl<StrategyChange>(p(sdir, f)));
    }
  }
  for (const [name, list] of Object.entries(recorded()?.strategy ?? {})) {
    if (worker && name !== worker) continue;
    out[name] = mergeStrategy(out[name], list);
  }
  return out;
}

function mergeStrategy(a: StrategyChange[] = [], b: StrategyChange[]): StrategyChange[] {
  const key = (c: StrategyChange) => `${c.ts_ms}|${c.bounty_id}|${c.old_margin}|${c.new_margin}`;
  const m = new Map(a.map((c) => [key(c), c]));
  for (const c of b) if (!m.has(key(c))) m.set(key(c), c);
  return [...m.values()].sort((x, y) => x.ts_ms - y.ts_ms);
}

export function readTxLog(): TxLogEntry[] {
  const seen = new Set<string>();
  const out: TxLogEntry[] = [];
  const add = (r: TxLogEntry) => {
    if (!r?.txHash || seen.has(r.txHash)) return;
    seen.add(r.txHash);
    out.push(r);
  };
  for (const dir of dataDirs()) readJsonl<TxLogEntry>(p(dir, "tx.jsonl")).forEach(add);
  recorded()?.tx.forEach(add);
  return out.sort((a, b) => a.ts - b.ts);
}

/** Re-serialise canonically (used to show exactly the hashed bytes). */
export { canonicalize };
