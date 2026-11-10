// One full market run: post bounties, then step all agents until every posted bounty is terminal.
// Used by demo.ts (testnet by default), the sample generator (mock) and the e2e tests.
import type { Bounty } from "@hivefund/shared";
import type { Market } from "@hivefund/shared/node";
import { Coordinator, type CoordinatorOptions, type CoordinatorReport } from "./coordinator.ts";
import { Forger, type ForgedBid } from "./forger.ts";
import { loadVerifier, loadWorkers, type TickableAgent } from "./agents.ts";

export interface RunOptions {
  /** max agent steps (default 10) */
  maxSteps?: number;
  /** include the forger agent (default true) */
  forger?: boolean;
  /** pause between steps on testnet, ms (default 1500; ignored in mock) */
  pauseMs?: number;
  /** simulated time per step in mock mode (default 2 min) */
  mockStepMs?: number;
  coordinator?: CoordinatorOptions;
  /** post fixtures from /bounties first (default true) */
  post?: boolean;
  /** custom agents (tests); default loads the Stream C packages */
  workers?: TickableAgent[];
  verifier?: TickableAgent;
  log?: (line: string) => void;
}

export interface StepRecord {
  step: number;
  coordinator: CoordinatorReport;
  forged: ForgedBid[];
  statuses: { id: number; status: Bounty["status"]; round: number; attempts: number }[];
}

export interface RunResult {
  postedIds: number[];
  steps: StepRecord[];
  finalBounties: Bounty[];
  allTerminal: boolean;
  startedAt: number;
  finishedAt: number;
}

const TERMINAL = new Set<Bounty["status"]>(["Completed", "Cancelled"]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runMarket(market: Market, o: RunOptions = {}): Promise<RunResult> {
  const log = o.log ?? ((l: string) => console.log(l));
  const startedAt = Date.now();
  const coordinator = new Coordinator(market.coordinator, { minBids: 3, ...o.coordinator });
  const workers = o.workers ?? (await loadWorkers(market));
  const verifier = o.verifier ?? (await loadVerifier(market));
  const forger = o.forger === false ? null : new Forger(market.forger);
  const pause = market.mode === "testnet" ? (o.pauseMs ?? 1500) : 0;
  const advance = () => market.chain?.advance(o.mockStepMs ?? 120_000);

  let postedIds: number[] = [];
  if (o.post !== false) {
    const rep = await coordinator.postBounties();
    postedIds = rep.posted.map((p) => p.bounty_id);
    for (const e of rep.errors) log(`! post: ${e.message}`);
  }
  const tracked = async (): Promise<Bounty[]> => {
    const all = await market.coordinator.hub.view<Bounty[]>("get_bounties", { from_index: 0, limit: 100 });
    return postedIds.length ? all.filter((b) => postedIds.includes(b.id)) : all.filter((b) => !TERMINAL.has(b.status));
  };
  if (!postedIds.length) log("no new bounties posted; driving the bounties that are still open on-chain");
  const scope = await tracked();
  const scopeIds = scope.map((b) => b.id);

  const tickAll = async (agents: TickableAgent[], label: string) => {
    for (const a of agents) {
      try {
        await a.tick();
      } catch (e) {
        log(`! ${a.name} ${label}: ${(e as Error).message}`);
      }
    }
  };

  const steps: StepRecord[] = [];
  const maxSteps = o.maxSteps ?? 10;
  let finalBounties: Bounty[] = scope;
  for (let step = 1; step <= maxSteps; step++) {
    log(`\n=== step ${step} ===`);
    await tickAll(workers, "bid/submit");                  // bid on open bounties / submit won work
    const forged = forger ? await forger.tick().catch((e) => (log(`! forger: ${e.message}`), [])) : [];
    if (pause) await sleep(pause);
    const coord = await coordinator.tick({ force: true }); // signatures checked, forgeries rejected, winner selected
    advance();
    if (pause) await sleep(pause);
    await tickAll(workers, "submit");                      // winners deliver
    if (pause) await sleep(pause);
    await tickAll([verifier], "verify");                   // automated checks -> rubric -> verify_bounty
    advance();
    if (pause) await sleep(pause);

    const all = await market.coordinator.hub.view<Bounty[]>("get_bounties", { from_index: 0, limit: 100 });
    finalBounties = all.filter((b) => scopeIds.includes(b.id));
    steps.push({
      step,
      coordinator: coord,
      forged,
      statuses: finalBounties.map((b) => ({ id: b.id, status: b.status, round: b.round, attempts: b.attempts })),
    });
    log(finalBounties.map((b) => `bounty ${b.id}: ${b.status} (round ${b.round}, attempts ${b.attempts})`).join("\n"));
    if (finalBounties.every((b) => TERMINAL.has(b.status))) break;
  }
  // one more worker tick so every worker (esp. adaptive) learns the final outcomes
  await tickAll(workers, "learn");
  return {
    postedIds,
    steps,
    finalBounties,
    allTerminal: finalBounties.length > 0 && finalBounties.every((b) => TERMINAL.has(b.status)),
    startedAt,
    finishedAt: Date.now(),
  };
}
