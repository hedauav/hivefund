// Deliverable generation. With an LLM (NEAR AI Cloud) the worker really writes the deliverable; how much
// effort it spends depends on its quality level (token budget, whether it reads the acceptance test,
// instructions). If the LLM fails, the worker submits an honest failed deliverable (never canned code).
// Only when no LLM is configured at all (simulation mode) does it use the built-in template for the spec's $id.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BountySpec, Deliverable } from "@hivefund/shared";
import type { LlmClient } from "./ports.ts";
import type { Quality } from "./pricing.ts";
import { templateFor, type TemplateOutput } from "./templates/index.ts";

export const DEFAULT_BOUNTIES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../bounties");

export type GenerationMode = "llm" | "template" | "failed";

export interface GenerateContext {
  bountyId: number;
  round: number;
  worker: string;
  quality: Quality;
  llm: LlmClient | null;
  bountiesDir?: string;
}

/** Deliverable plus provenance: which generator produced it (hashed with the deliverable, ignored by grading). */
export type GeneratedDeliverable = Deliverable & { generator: { mode: GenerationMode; model: string | null } };

export interface GenerateResult {
  deliverable: GeneratedDeliverable;
  mode: GenerationMode;
  model: string | null;
  /** why the LLM path was not used / failed, if applicable */
  note?: string;
}

/** Effort per quality level: genuine differences in budget and in what the worker reads. */
export const EFFORT: Record<Quality, { maxTokens: number; readsTest: boolean; style: string }> = {
  low: {
    maxTokens: 900,
    readsTest: false,
    style: "You are a budget freelancer. Work fast: skim the spec, keep everything short, do not over-think edge cases.",
  },
  medium: {
    maxTokens: 2500,
    readsTest: false,
    style: "You are a competent freelancer. Meet the stated requirements with reasonable care.",
  },
  high: {
    maxTokens: 6000,
    readsTest: true,
    style:
      "You are a senior engineer who is paid for quality. Read the acceptance test carefully, handle every edge case, and explain your reasoning precisely.",
  },
};

const FILE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,63}$/;
const LLM_ATTEMPTS = 2;
/** Code shorter than this, or made only of dots/whitespace, is treated as an elided placeholder. */
const MIN_CODE_CHARS = 40;

export function canProduce(spec: BountySpec, llm: LlmClient | null): boolean {
  return llm !== null || templateFor(spec.deliverable_schema["$id"]) !== null;
}

export async function generateDeliverable(spec: BountySpec, ctx: GenerateContext): Promise<GenerateResult> {
  const base = { bounty_id: ctx.bountyId, round: ctx.round, worker: ctx.worker };
  let note: string | undefined;
  if (ctx.llm) {
    // One retry: hosted models occasionally return placeholder/elided output ("...").
    const errors: string[] = [];
    for (let attempt = 1; attempt <= LLM_ATTEMPTS; attempt++) {
      try {
        const out = await generateWithLlm(spec, ctx, ctx.llm);
        return {
          deliverable: toDeliverable(base, out, "llm", ctx.llm.model),
          mode: "llm",
          model: ctx.llm.model,
          ...(errors.length ? { note: `succeeded on attempt ${attempt} after: ${errors.join("; ")}` } : {}),
        };
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    // An LLM was configured and the worker could not produce valid work with it. Submitting canned template
    // code here would misrepresent the worker's output, so it hands in an honest failed deliverable instead
    // (it fails verification and the bounty reopens). Templates are only used in no-LLM simulation mode.
    return {
      deliverable: { ...base, sections: {}, data: null, generator: { mode: "failed", model: ctx.llm.model } },
      mode: "failed",
      model: ctx.llm.model,
      note: `LLM generation failed (${LLM_ATTEMPTS} attempts): ${errors.join("; ")}`,
    };
  } else {
    note = "no NEARAI_API_KEY configured";
  }
  const tpl = templateFor(spec.deliverable_schema["$id"]);
  if (tpl) return { deliverable: toDeliverable(base, tpl(ctx.quality), "template", null), mode: "template", model: null, note };
  // Nothing could be produced: submit an honest empty deliverable (it will fail verification).
  return {
    deliverable: { ...base, sections: {}, data: null, generator: { mode: "failed", model: null } },
    mode: "failed",
    model: null,
    note,
  };
}

function toDeliverable(
  base: { bounty_id: number; round: number; worker: string },
  out: TemplateOutput,
  mode: GenerationMode,
  model: string | null,
): GeneratedDeliverable {
  const d: GeneratedDeliverable = { ...base, sections: out.sections, data: out.data, generator: { mode, model } };
  if (out.code && Object.keys(out.code).length > 0) d.code = out.code;
  return d;
}

async function generateWithLlm(spec: BountySpec, ctx: GenerateContext, llm: LlmClient): Promise<TemplateOutput> {
  const effort = EFFORT[ctx.quality];
  const { $id: _ignored, ...dataSchema } = spec.deliverable_schema as Record<string, unknown>;
  const outputSchema: Record<string, unknown> = {
    type: "object",
    required: ["sections", "data"],
    properties: {
      sections: {
        type: "object",
        description: `Markdown text for each required section: ${spec.required_sections.join(", ")}`,
        additionalProperties: { type: "string" },
      },
      data: dataSchema,
      ...(spec.test
        ? {
            code: codeSchema(spec),
          }
        : {}),
    },
  };

  let testInfo = "";
  if (spec.test) {
    testInfo = `\nAcceptance test: the verifier writes your \`code\` files into an empty directory and runs \`node ${spec.test.file} <dir>\`; exit code 0 means pass.`;
    if (effort.readsTest) {
      const src = await readBountyFile(spec.test.file, ctx.bountiesDir ?? DEFAULT_BOUNTIES_DIR);
      testInfo += `\nThe acceptance test source is:\n\`\`\`js\n${src}\n\`\`\``;
    }
  }

  const user = [
    `Bounty: ${spec.title}`,
    `Description: ${spec.description}`,
    `Required sections (non-empty): ${spec.required_sections.join(", ")}`,
    `The "data" field must validate against this JSON Schema: ${JSON.stringify(dataSchema)}`,
    `Subjective grading rubric: ${spec.rubric.criteria.map((c) => `${c.id} (weight ${c.weight}): ${c.description}`).join(" | ")}`,
    testInfo,
    `Return one JSON object with keys "sections", "data"${spec.test ? ', and "code"' : ""}. ` +
      "Fill every field with your real, complete work: full section text and full source code. " +
      'Never write "..." or any placeholder, outline or abbreviation.',
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await llm.chat(
    [
      { role: "system", content: `${effort.style} You are an AI worker agent in the HiveFund bounty market. Respond with JSON only.` },
      { role: "user", content: user },
    ],
    {
      schema: { name: "deliverable", schema: outputSchema, strict: false },
      maxTokens: effort.maxTokens,
      temperature: 0.2,
    },
  );
  return validateLlmOutput(raw, Boolean(spec.test));
}

function validateLlmOutput(raw: unknown, needsCode: boolean): TemplateOutput {
  if (!raw || typeof raw !== "object") throw new Error("LLM output is not an object");
  const o = raw as Record<string, unknown>;
  const sections: Record<string, string> = {};
  if (!o.sections || typeof o.sections !== "object") throw new Error("LLM output has no sections object");
  for (const [k, v] of Object.entries(o.sections as Record<string, unknown>)) {
    if (typeof v === "string") sections[k] = v;
    else if (Array.isArray(v)) sections[k] = v.map(String).join("\n");
  }
  if (!("data" in o)) throw new Error("LLM output has no data field");
  const out: TemplateOutput = { sections, data: o.data ?? null };
  if (o.code && typeof o.code === "object") {
    const code: Record<string, string> = {};
    for (const [name, src] of Object.entries(o.code as Record<string, unknown>)) {
      if (FILE_NAME.test(name) && typeof src === "string") {
        if (src.trim().length < MIN_CODE_CHARS || /^[.\s…]*$/.test(src)) throw new Error(`placeholder code in ${name}`);
        code[name] = src;
      }
    }
    if (Object.keys(code).length > 0) out.code = code;
  }
  if (needsCode && !out.code) throw new Error("LLM output has no usable code files");
  return out;
}

/**
 * Schema for the `code` object. When the spec pins the entry file name (data.file is a const), name it as a
 * required property: some models handle explicit properties far better than free-form additionalProperties.
 */
function codeSchema(spec: BountySpec): Record<string, unknown> {
  const props = (spec.deliverable_schema as { properties?: Record<string, { const?: unknown }> }).properties;
  const file = props?.file?.const;
  const fileDesc = "The complete, runnable file content (never a placeholder or abbreviation).";
  if (typeof file === "string" && FILE_NAME.test(file)) {
    return {
      type: "object",
      description: `Source files keyed by file name. ${fileDesc}`,
      required: [file],
      properties: { [file]: { type: "string", description: fileDesc } },
    };
  }
  return { type: "object", description: `Source files keyed by file name. ${fileDesc}`, additionalProperties: { type: "string" } };
}

/** Read a file strictly inside the bounties directory (no traversal). */
export async function readBountyFile(rel: string, bountiesDir: string): Promise<string> {
  const root = path.resolve(bountiesDir);
  const p = path.resolve(root, rel);
  const relative = path.relative(root, p);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`refusing to read outside bounties dir: ${rel}`);
  }
  return readFile(p, "utf8");
}
