// npm run demo [-- --mode testnet|mock] [--steps N] [--no-forger] [--export-dir DIR] [--no-export] [--bounties procurement]
//
// Default: TESTNET. Uses config/deployment.testnet.json + agent keys from .env.local (written by
// `npm run setup:testnet`); every agent signs with its own function-call key, every tx is appended to
// data/tx.jsonl with a nearblocks link, and the final chain state + off-chain objects are exported to
// web/public/offchain for the dashboard.
// --mode mock is an offline simulation (in-memory chain, no LLM) for development only.
import path from "node:path";
import fs from "node:fs";
import {
  createMockMarket,
  createTestnetMarket,
  loadEnv,
  openStore,
  readChainState,
  repoRoot,
  type Market,
} from "@hivefund/shared/node";
import { runMarket } from "./run.ts";
import { renderSummary } from "./summary.ts";

export interface DemoArgs {
  mode: "testnet" | "mock";
  steps: number;
  forger: boolean;
  exportDir: string | null;
  dataDir: string | null;
  /** comma-separated folders or .json files under /bounties (e.g. "procurement,starter"); null => /bounties itself */
  bounties: string | null;
}

export function parseArgs(argv: string[]): DemoArgs {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const modeArg = get("--mode") ?? (argv.includes("--mock") ? "mock" : "testnet");
  if (modeArg !== "testnet" && modeArg !== "mock") throw new Error(`--mode must be testnet or mock, got ${modeArg}`);
  const mode = modeArg;
  const exportDefault = mode === "testnet" ? path.join(repoRoot(), "web", "public", "offchain") : null;
  return {
    mode,
    steps: Number(get("--steps") ?? 10),
    forger: !argv.includes("--no-forger"),
    exportDir: argv.includes("--no-export") ? null : (get("--export-dir") ?? exportDefault),
    dataDir: get("--data-dir") ?? null,
    bounties: get("--bounties") ?? null,
  };
}

/** Resolve "--bounties a,b" entries (folders or .json files) strictly inside /bounties. */
export function resolveBountyFiles(list: string): string[] {
  const root = path.join(repoRoot(), "bounties");
  const out: string[] = [];
  for (const entry of list.split(",").map((s) => s.trim()).filter(Boolean)) {
    const abs = path.resolve(root, entry);
    const rel = path.relative(root, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel) || !fs.existsSync(abs))
      throw new Error(`--bounties entries must be folders or .json files inside /bounties, got ${entry}`);
    if (fs.statSync(abs).isDirectory()) {
      out.push(...fs.readdirSync(abs).filter((f) => f.endsWith(".json")).sort().map((f) => path.join(abs, f)));
    } else if (abs.endsWith(".json")) out.push(abs);
  }
  if (!out.length) throw new Error(`--bounties ${list}: no .json fixtures found`);
  return out;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  loadEnv();
  const args = parseArgs(argv);
  let market: Market;
  if (args.mode === "testnet") {
    market = createTestnetMarket(args.dataDir ? { store: openStore(args.dataDir) } : {});
    console.log(`HiveFund demo on TESTNET — hub ${market.hubId}, token ${market.tokenId}`);
    console.log(`Explorer: ${market.explorer}/address/${market.hubId}`);
  } else {
    const dir = args.dataDir ?? path.join(repoRoot(), "data", "mock");
    fs.rmSync(dir, { recursive: true, force: true });
    market = await createMockMarket({ store: openStore(dir) });
    console.log(`HiveFund demo in MOCK mode (offline simulation, no chain, no LLM). Data: ${dir}`);
  }

  const specFiles = args.bounties ? resolveBountyFiles(args.bounties) : [];
  if (specFiles.length) console.log(`Posting bounty fixtures: ${specFiles.map((f) => path.relative(repoRoot(), f)).join(", ")}`);
  const run = await runMarket(market, { maxSteps: args.steps, forger: args.forger, ...(specFiles.length ? { coordinator: { specFiles } } : {}) });
  const state = await readChainState(market.coordinator.hub, market.token, market.mode);
  market.store.writeJson("chain-state.json", state);
  console.log(renderSummary(market, run, state, market.store.readTx()));
  if (args.exportDir) {
    market.store.exportSnapshot(args.exportDir);
    console.log(`\nExported off-chain objects + chain-state.json to ${args.exportDir}`);
  }
  return run.allTerminal ? 0 : 2;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).replace(/\.ts$/, "") === path.resolve(import.meta.filename ?? "").replace(/\.ts$/, "");
if (isMain) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(`demo failed: ${(e as Error).message}`);
      process.exit(1);
    },
  );
}
