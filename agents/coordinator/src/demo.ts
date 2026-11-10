// npm run demo [-- --mode testnet|mock] [--steps N] [--no-forger] [--export-dir DIR] [--no-export]
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
  };
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

  const run = await runMarket(market, { maxSteps: args.steps, forger: args.forger });
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
