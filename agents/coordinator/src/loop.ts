// npm run agent -- <coordinator|cheap|quality|adaptive|verifier|forger> [--interval 5000] [--post] [--mode testnet|mock]
// Runs ONE agent as its own long-lived process, polling the hub every --interval ms (default 5 s).
// This is the multi-process variant of the demo: start each agent in its own terminal on testnet.
import { createTestnetMarket, loadEnv, type Market } from "@hivefund/shared/node";
import { Coordinator } from "./coordinator.ts";
import { Forger } from "./forger.ts";
import { loadVerifier, loadWorkers } from "./agents.ts";

const NAMES = ["coordinator", "cheap", "quality", "adaptive", "verifier", "forger"] as const;
type Name = (typeof NAMES)[number];

async function main() {
  loadEnv();
  const argv = process.argv.slice(2);
  const name = argv[0] as Name;
  if (!NAMES.includes(name)) throw new Error(`usage: npm run agent -- <${NAMES.join("|")}> [--interval ms] [--post]`);
  const i = argv.indexOf("--interval");
  const interval = i >= 0 ? Number(argv[i + 1]) : 5000;
  const market: Market = createTestnetMarket();
  let tick: () => Promise<unknown>;
  if (name === "coordinator") {
    const c = new Coordinator(market.coordinator);
    if (argv.includes("--post")) await c.postBounties();
    tick = () => c.tick();
  } else if (name === "forger") {
    const f = new Forger(market.forger);
    tick = () => f.tick();
  } else if (name === "verifier") {
    const v = await loadVerifier(market);
    tick = () => v.tick();
  } else {
    const w = (await loadWorkers(market)).find((x) => x.name === name)!;
    tick = () => w.tick();
  }
  console.log(`[${name}] polling ${market.hubId} every ${interval} ms (Ctrl+C to stop)`);
  for (;;) {
    try {
      await tick();
    } catch (e) {
      console.error(`[${name}] tick failed: ${(e as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
