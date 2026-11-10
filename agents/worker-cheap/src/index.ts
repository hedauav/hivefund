// Cheap worker: lowest margin, slowest delivery, low-effort deliverables (short LLM budget, does not
// read the acceptance test; template fallback skips edge cases). Registered on-chain as tier 1.
import { Worker, nearAiFromEnv, type WorkerOptions, type WorkerProfile } from "@hivefund/worker-core";

export const PROFILE: WorkerProfile = { name: "cheap", tier: 1, margin: 0.05, speed: 1.6, quality: "low" };

export type CreateOptions = Omit<WorkerOptions, "profile"> & { profile?: Partial<WorkerProfile> };

export function createCheapWorker(o: CreateOptions): Worker {
  const repoRoot = (o as { repoRoot?: unknown }).repoRoot;
  return new Worker({
    ...o,
    bountiesDir: o.bountiesDir ?? (typeof repoRoot === "string" ? `${repoRoot}/bounties` : undefined),
    llm: o.llm === undefined ? nearAiFromEnv({ model: process.env.WORKER_CHEAP_MODEL || process.env.NEARAI_MODEL || "z-ai/glm-5.3-flash", enableThinking: false }) : o.llm,
    profile: { ...PROFILE, ...o.profile },
  });
}

export { Worker };
