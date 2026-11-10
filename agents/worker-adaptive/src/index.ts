// Adaptive worker: starts at margin 0.20 / medium quality. Keeps its last 5 outcomes; raises margin after
// a win, lowers it after a loss (bounded to [0.05, 0.50]) and raises quality after a failed verification.
// Every change is appended to the off-chain strategy log with its reason. Registered on-chain as tier 2.
import { Worker, nearAiFromEnv, type WorkerOptions, type WorkerProfile } from "@hivefund/worker-core";

export const PROFILE: WorkerProfile = {
  name: "adaptive",
  tier: 2,
  margin: 0.2,
  speed: 1.0,
  quality: "medium",
  adaptive: { minMargin: 0.05, maxMargin: 0.5 },
};

export type CreateOptions = Omit<WorkerOptions, "profile"> & { profile?: Partial<WorkerProfile> };

export function createAdaptiveWorker(o: CreateOptions): Worker {
  const repoRoot = (o as { repoRoot?: unknown }).repoRoot;
  return new Worker({
    ...o,
    bountiesDir: o.bountiesDir ?? (typeof repoRoot === "string" ? `${repoRoot}/bounties` : undefined),
    llm: o.llm === undefined ? nearAiFromEnv({ model: process.env.WORKER_ADAPTIVE_MODEL || process.env.NEARAI_MODEL || "z-ai/glm-5.3-flash", enableThinking: false }) : o.llm,
    profile: { ...PROFILE, ...o.profile },
  });
}

export { Worker };
