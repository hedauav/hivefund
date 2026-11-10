// Loads the worker and verifier agents (Stream C packages) and adapts them to one tick() shape.
// Factories receive one merged options object (WorkerOptions-style keys + AgentContext keys) and the
// returned agent is ticked as tick(hub, store) — agents that take no args simply ignore them.
import type { AgentContext, Market, WorkerContext, WorkerName } from "@hivefund/shared/node";

export interface TickableAgent {
  name: string;
  accountId: string;
  tick(): Promise<unknown>;
}

type Factory = (o: Record<string, unknown>) => unknown;

const WORKER_PACKAGES: Record<WorkerName, { pkg: string; factory: string }> = {
  cheap: { pkg: "@hivefund/worker-cheap", factory: "createCheapWorker" },
  quality: { pkg: "@hivefund/worker-quality", factory: "createQualityWorker" },
  adaptive: { pkg: "@hivefund/worker-adaptive", factory: "createAdaptiveWorker" },
};

function pickFactory(mod: Record<string, unknown>, preferred: string[]): Factory | null {
  for (const n of preferred) if (typeof mod[n] === "function") return mod[n] as Factory;
  const any = Object.entries(mod).find(([k, v]) => /^create/.test(k) && typeof v === "function");
  return any ? (any[1] as Factory) : null;
}

function optionsFor(ctx: AgentContext | WorkerContext, mode: Market["mode"]): Record<string, unknown> {
  return {
    ...ctx,
    contract: ctx.contractId,
    // Simulation mode (mock) never calls an LLM. On testnet the agents use NEAR AI when NEARAI_API_KEY is set.
    ...(mode === "mock" ? { llm: null } : {}),
  };
}

function wrap(name: string, ctx: AgentContext, agent: unknown): TickableAgent {
  const a = agent as { tick?: (...args: unknown[]) => Promise<unknown> };
  if (!a || typeof a.tick !== "function") throw new Error(`${name}: factory did not return an object with tick()`);
  return { name, accountId: ctx.accountId, tick: () => a.tick!.call(a, ctx.hub, ctx.store) };
}

export async function loadWorkers(market: Market): Promise<TickableAgent[]> {
  const out: TickableAgent[] = [];
  for (const name of Object.keys(WORKER_PACKAGES) as WorkerName[]) {
    const { pkg, factory } = WORKER_PACKAGES[name];
    const ctx = market.workers[name];
    let mod: Record<string, unknown>;
    try {
      mod = (await import(pkg)) as Record<string, unknown>;
    } catch (e) {
      throw new Error(`cannot load ${pkg} (Stream C): ${(e as Error).message}`);
    }
    const f = pickFactory(mod, [factory, "createWorker"]);
    if (!f) throw new Error(`${pkg} exports no worker factory`);
    out.push(wrap(name, ctx, f(optionsFor(ctx, market.mode))));
  }
  return out;
}

export async function loadVerifier(market: Market): Promise<TickableAgent> {
  let mod: Record<string, unknown>;
  try {
    mod = (await import("@hivefund/verifier")) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`cannot load @hivefund/verifier (Stream C): ${(e as Error).message}`);
  }
  const ctx = market.verifier;
  const f = pickFactory(mod, ["createVerifier"]);
  if (f) return wrap("verifier", ctx, f(optionsFor(ctx, market.mode)));
  const Cls = mod.Verifier as (new (o: Record<string, unknown>) => unknown) | undefined;
  if (typeof Cls === "function") return wrap("verifier", ctx, new Cls(optionsFor(ctx, market.mode)));
  throw new Error("@hivefund/verifier exports neither createVerifier nor Verifier");
}
