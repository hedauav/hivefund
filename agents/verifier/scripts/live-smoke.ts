// Live smoke test against NEAR AI Cloud (needs NEARAI_API_KEY in .env.local). Generates the slugify
// deliverable with the cheap and quality worker LLM settings, then verifies both with the LLM rubric.
// Usage: node --env-file=.env.local --import tsx agents/verifier/scripts/live-smoke.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BountySpec } from "@hivefund/shared";
import { generateDeliverable, nearAiFromEnv } from "@hivefund/worker-core";
import { verify } from "../src/index.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const spec = JSON.parse(readFileSync(path.join(root, "bounties/slugify.json"), "utf8")) as BountySpec;
if (!process.env.NEARAI_API_KEY) throw new Error("NEARAI_API_KEY not set");

const grader = nearAiFromEnv({ enableThinking: false })!;
const workers = {
  cheap: { llm: nearAiFromEnv({ model: process.env.WORKER_CHEAP_MODEL || "z-ai/glm-5.3-flash", enableThinking: false })!, quality: "low" as const },
  quality: {
    llm: nearAiFromEnv({ model: process.env.WORKER_QUALITY_MODEL || "deepseek/deepseek-v3.2", enableThinking: false, timeoutMs: 240_000 })!,
    quality: "high" as const,
  },
};
const only = process.argv[2];
for (const [name, w] of Object.entries(workers)) {
  if (only && name !== only) continue;
  const t0 = Date.now();
  const g = await generateDeliverable(spec, { bountyId: 0, round: 0, worker: `${name}.smoke`, quality: w.quality, llm: w.llm });
  const r = await verify(spec, g.deliverable, { verifier: "verifier.smoke", llm: grader });
  console.log(
    JSON.stringify({
      worker: name,
      gen_mode: g.mode,
      gen_model: g.model,
      gen_note: g.note ?? null,
      checks: r.checks.map((c) => `${c.id}:${c.skipped ? "skip" : c.passed ? "pass" : "FAIL"}`),
      test_details: r.checks.find((c) => c.id === "test")?.details.slice(0, 200),
      rubric: r.rubric && { mode: r.rubric.mode, model: r.rubric.model, total: r.rubric.total },
      passed: r.passed,
      score: r.score,
      secs: Math.round((Date.now() - t0) / 1000),
    }),
  );
}
