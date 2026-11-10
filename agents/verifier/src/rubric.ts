// Subjective rubric scoring. Primary path: NEAR AI Cloud (OpenAI-compatible) with a strict JSON schema
// (falls back to json_object inside the client). Resilience path: a deterministic keyword-coverage heuristic,
// used only when no NEARAI_API_KEY is configured or the LLM call fails; the report records which one ran.
import { canonicalize } from "@hivefund/shared";
import type { BountySpec, Deliverable, RubricScore } from "@hivefund/shared";
import type { LlmClient } from "@hivefund/worker-core";

export interface RubricResult {
  mode: "llm" | "fallback";
  model: string | null;
  scores: RubricScore[];
  total: number;
  threshold: number;
  /** set when the LLM was configured but failed and the fallback ran */
  llm_error?: string;
}

const STOPWORDS = new Set([
  "about", "after", "again", "their", "there", "these", "those", "which", "while", "where", "should", "would",
  "could", "other", "every", "under", "using", "items", "gives", "explains", "documents", "covers", "concrete",
  "clear", "include", "includes", "including",
]);

export function weightedTotal(spec: BountySpec, scores: RubricScore[]): number {
  let sw = 0;
  let acc = 0;
  for (const c of spec.rubric.criteria) {
    const s = scores.find((x) => x.criterion === c.id);
    acc += c.weight * (s ? s.score : 0);
    sw += c.weight;
  }
  return sw > 0 ? Math.round(acc / sw) : 0;
}

export function deliverableText(d: Deliverable): string {
  const sections = d.sections && typeof d.sections === "object" ? Object.values(d.sections).join("\n") : "";
  let data = "";
  try {
    data = d.data === undefined ? "" : canonicalize(d.data);
  } catch {
    data = "";
  }
  return `${sections}\n${data}`;
}

export function keywordsOf(description: string): string[] {
  const words = description.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 5 && !STOPWORDS.has(w));
  return [...new Set(words)];
}

/**
 * Deterministic fallback: for each criterion, extract keywords (>= 5 letters, minus stopwords) from its
 * description and measure how many appear in the deliverable (prefix match on the first 6 letters, so
 * "separators" matches "separator"). score = 75 * min(1, coverage / 0.8) + 25 * min(1, words / 200).
 */
export function fallbackRubric(spec: BountySpec, d: Deliverable): RubricResult {
  const text = deliverableText(d).toLowerCase();
  const words = text.split(/\s+/).filter(Boolean).length;
  const lengthFactor = Math.min(1, words / 200);
  const scores: RubricScore[] = spec.rubric.criteria.map((c) => {
    const kws = keywordsOf(c.description);
    const hit = kws.filter((k) => text.includes(k.length > 6 ? k.slice(0, 6) : k));
    const coverage = kws.length ? hit.length / kws.length : 1;
    const score = Math.round(100 * (0.75 * Math.min(1, coverage / 0.8) + 0.25 * lengthFactor));
    return {
      criterion: c.id,
      score: Math.max(0, Math.min(100, score)),
      rationale: `fallback heuristic: ${hit.length}/${kws.length} rubric keywords present; ${words} words`,
    };
  });
  return { mode: "fallback", model: null, scores, total: weightedTotal(spec, scores), threshold: spec.rubric.pass_threshold };
}

export async function llmRubric(spec: BountySpec, d: Deliverable, llm: LlmClient, context?: string): Promise<RubricResult> {
  const ids = spec.rubric.criteria.map((c) => c.id);
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["scores"],
    properties: {
      scores: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["criterion", "score", "rationale"],
          properties: {
            criterion: { type: "string", enum: ids },
            score: { type: "integer", minimum: 0, maximum: 100 },
            rationale: { type: "string" },
          },
        },
      },
    },
  };
  const body = deliverableText(d);
  const raw = await llm.chat(
    [
      {
        role: "system",
        content:
          "You are the HiveFund verifier, a strict and fair grader. Score the deliverable against each rubric criterion " +
          "from 0 to 100 using only the evidence in the deliverable. Automated checks (schema, tests) already passed; " +
          "judge only the subjective criteria. Give a one-sentence rationale per criterion. Respond with JSON only.",
      },
      {
        role: "user",
        content: [
          `Bounty: ${spec.title}`,
          `Description: ${spec.description}`,
          "Rubric criteria:",
          ...spec.rubric.criteria.map((c) => `- ${c.id} (weight ${c.weight}): ${c.description}`),
          ...(context ? [context] : []),
          "Deliverable (sections, then data as JSON):",
          body.length > 12_000 ? body.slice(0, 12_000) + "\n[truncated]" : body,
          `Return {"scores":[{"criterion":"<id>","score":<0-100>,"rationale":"..."}]} with exactly one entry for each of: ${ids.join(", ")}.`,
        ].join("\n"),
      },
    ],
    { schema: { name: "rubric_scores", schema, strict: true }, maxTokens: 800, temperature: 0 },
  );
  const arr = (raw as { scores?: unknown })?.scores;
  if (!Array.isArray(arr)) throw new Error("rubric response has no scores array");
  const scores: RubricScore[] = [];
  for (const id of ids) {
    const e = arr.find((x: any) => x && x.criterion === id) as any;
    const n = Number(e?.score);
    if (!e || !Number.isFinite(n)) throw new Error(`rubric response missing score for ${id}`);
    scores.push({
      criterion: id,
      score: Math.max(0, Math.min(100, Math.round(n))),
      rationale: String(e.rationale ?? "").slice(0, 300),
    });
  }
  return { mode: "llm", model: llm.model, scores, total: weightedTotal(spec, scores), threshold: spec.rubric.pass_threshold };
}

export interface RubricExtras {
  /** extra grounding shown to the LLM grader (procurement: live compliant options) */
  context?: string;
  /** deterministic per-criterion overrides for the fallback path (procurement: value score from live prices) */
  fallbackOverrides?: Record<string, { score: number; rationale: string }>;
}

function withOverrides(spec: BountySpec, r: RubricResult, o?: RubricExtras["fallbackOverrides"]): RubricResult {
  if (!o) return r;
  const scores = r.scores.map((s) => (o[s.criterion] ? { criterion: s.criterion, ...o[s.criterion]! } : s));
  return { ...r, scores, total: weightedTotal(spec, scores) };
}

export async function scoreRubric(spec: BountySpec, d: Deliverable, llm: LlmClient | null, extras: RubricExtras = {}): Promise<RubricResult> {
  if (!llm) return withOverrides(spec, fallbackRubric(spec, d), extras.fallbackOverrides);
  try {
    return await llmRubric(spec, d, llm, extras.context);
  } catch (e) {
    return { ...withOverrides(spec, fallbackRubric(spec, d), extras.fallbackOverrides), llm_error: String((e as Error).message).slice(0, 200) };
  }
}
