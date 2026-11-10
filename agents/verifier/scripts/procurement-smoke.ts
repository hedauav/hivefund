// Live smoke test for the procurement bounty: each worker profile reads the LIVE NEAR AI catalog and proposes a
// model with its real LLM; the verifier re-fetches the live catalog, makes the delivery call and grades with NEAR AI.
// Usage: node --env-file=.env.local --import tsx agents/verifier/scripts/procurement-smoke.ts [cheap|adaptive|quality]
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BountySpec } from "@hivefund/shared";
import { generateDeliverable, nearAiFromEnv } from "@hivefund/worker-core";
import { nearAiDeliveryProbeFromEnv, verify } from "../src/index.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const spec = JSON.parse(readFileSync(path.join(root, "bounties/procurement/llm-for-support-agent.json"), "utf8")) as BountySpec;
if (!process.env.NEARAI_API_KEY) throw new Error("NEARAI_API_KEY not set");

const grader = nearAiFromEnv({ enableThinking: false })!;
const workers = {
  cheap: { model: process.env.WORKER_CHEAP_MODEL || "z-ai/glm-5.3-flash", quality: "low" as const },
  adaptive: { model: process.env.WORKER_ADAPTIVE_MODEL || "z-ai/glm-5.3-flash", quality: "medium" as const },
  quality: { model: process.env.WORKER_QUALITY_MODEL || "deepseek/deepseek-v3.2", quality: "high" as const },
};
const only = process.argv[2];
for (const [name, w] of Object.entries(workers)) {
  if (only && name !== only) continue;
  const t0 = Date.now();
  const llm = nearAiFromEnv({ model: w.model, enableThinking: false, timeoutMs: 240_000 })!;
  const g = await generateDeliverable(spec, { bountyId: 0, round: 0, worker: `${name}.smoke`, quality: w.quality, llm });
  const r = await verify(spec, g.deliverable, { verifier: "verifier.smoke", llm: grader, delivery: nearAiDeliveryProbeFromEnv() });
  const d = g.deliverable.data as { item_id?: string; quoted_workload_cost_usd?: number; considered_count?: number } | null;
  console.log(
    JSON.stringify({
      worker: name,
      gen: `${g.mode} ${g.model}`,
      note: g.note ?? null,
      pick: d?.item_id ?? null,
      quoted_cost: d?.quoted_workload_cost_usd ?? null,
      scanned: d?.considered_count ?? null,
      checks: r.checks.map((c) => `${c.id}:${c.skipped ? "skip" : c.passed ? "pass" : "FAIL"}`),
      catalog: r.checks.find((c) => c.id === "catalog")?.details.slice(0, 220),
      delivery: r.procurement?.delivery ?? null,
      cheapest: r.procurement?.cheapest_compliant ?? null,
      rubric: r.rubric && { mode: r.rubric.mode, total: r.rubric.total, scores: r.rubric.scores.map((s) => `${s.criterion}=${s.score}`) },
      passed: r.passed,
      secs: Math.round((Date.now() - t0) / 1000),
    }),
  );
}
