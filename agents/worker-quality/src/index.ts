// Quality worker: higher margin, faster delivery, high-effort deliverables: a stronger model
// (WORKER_QUALITY_MODEL, default deepseek/deepseek-v3.2) a large token budget, and it reads the
// acceptance test source. Registered on-chain as tier 3.
import { Worker, nearAiFromEnv, type WorkerOptions, type WorkerProfile } from "@hivefund/worker-core";

export const PROFILE: WorkerProfile = { name: "quality", tier: 3, margin: 0.35, speed: 0.7, quality: "high" };

export type CreateOptions = Omit<WorkerOptions, "profile"> & { profile?: Partial<WorkerProfile> };

export function createQualityWorker(o: CreateOptions): Worker {
  const repoRoot = (o as { repoRoot?: unknown }).repoRoot;
  return new Worker({
    ...o,
    bountiesDir: o.bountiesDir ?? (typeof repoRoot === "string" ? `${repoRoot}/bounties` : undefined),
    llm: o.llm === undefined ? nearAiFromEnv({ model: process.env.WORKER_QUALITY_MODEL || "deepseek/deepseek-v3.2", enableThinking: false, timeoutMs: 240_000 }) : o.llm,
    profile: { ...PROFILE, ...o.profile },
  });
}

export { Worker };
