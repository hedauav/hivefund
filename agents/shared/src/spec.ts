// Light structural validators for the off-chain objects (isomorphic). Each returns a list of problems.
import type { BountySpec, Deliverable, VerificationReport } from "./types.ts";
import { isHash } from "./canonical.ts";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function validateSpec(s: unknown): string[] {
  const p: string[] = [];
  if (!isObj(s)) return ["spec must be an object"];
  const x = s as Partial<BountySpec>;
  if (x.version !== 1) p.push("version must be 1");
  if (typeof x.title !== "string" || !x.title || x.title.length > 120) p.push("title must be 1..120 chars");
  if (typeof x.description !== "string") p.push("description must be a string");
  if (!isObj(x.deliverable_schema)) p.push("deliverable_schema must be a JSON Schema object");
  if (!Array.isArray(x.required_sections) || x.required_sections.some((r) => typeof r !== "string"))
    p.push("required_sections must be string[]");
  if (x.test !== null) {
    if (!isObj(x.test)) p.push("test must be null or {runner,file,timeout_ms}");
    else {
      if (x.test.runner !== "node") p.push('test.runner must be "node"');
      if (typeof x.test.file !== "string" || x.test.file.includes("..") || /^([a-zA-Z]:|[\\/])/.test(x.test.file))
        p.push("test.file must be a relative path under /bounties");
      if (typeof x.test.timeout_ms !== "number" || x.test.timeout_ms <= 0) p.push("test.timeout_ms must be > 0");
    }
  }
  if (!isObj(x.rubric) || !Array.isArray(x.rubric.criteria)) p.push("rubric.criteria must be an array");
  else {
    if (typeof x.rubric.pass_threshold !== "number" || x.rubric.pass_threshold < 0 || x.rubric.pass_threshold > 100)
      p.push("rubric.pass_threshold must be 0..100");
    for (const c of x.rubric.criteria) {
      if (!isObj(c) || typeof c.id !== "string" || typeof c.description !== "string" || typeof c.weight !== "number")
        p.push("each rubric criterion needs id, description, weight");
    }
  }
  if (typeof x.budget_yocto !== "string" || !/^\d+$/.test(x.budget_yocto) || x.budget_yocto === "0")
    p.push("budget_yocto must be a positive decimal string");
  if (![1, 2, 3].includes(x.min_tier as number)) p.push("min_tier must be 1, 2 or 3");
  if (typeof x.deadline_minutes !== "number" || x.deadline_minutes <= 0) p.push("deadline_minutes must be > 0");
  return p;
}

export function validateDeliverable(d: unknown): string[] {
  const p: string[] = [];
  if (!isObj(d)) return ["deliverable must be an object"];
  const x = d as Partial<Deliverable>;
  if (typeof x.bounty_id !== "number") p.push("bounty_id must be a number");
  if (typeof x.round !== "number") p.push("round must be a number");
  if (typeof x.worker !== "string") p.push("worker must be a string");
  if (!isObj(x.sections) || Object.values(x.sections).some((v) => typeof v !== "string"))
    p.push("sections must be Record<string,string>");
  if (!("data" in x)) p.push("data is required");
  if (x.code !== undefined && (!isObj(x.code) || Object.values(x.code).some((v) => typeof v !== "string")))
    p.push("code must be Record<string,string>");
  return p;
}

export function validateReport(r: unknown): string[] {
  const p: string[] = [];
  if (!isObj(r)) return ["report must be an object"];
  const x = r as Partial<VerificationReport>;
  if (typeof x.bounty_id !== "number") p.push("bounty_id must be a number");
  if (typeof x.spec_hash !== "string" || !isHash(x.spec_hash)) p.push("spec_hash must be a sha256 hex");
  if (typeof x.deliverable_hash !== "string" || !isHash(x.deliverable_hash)) p.push("deliverable_hash must be a sha256 hex");
  if (!Array.isArray(x.checks)) p.push("checks must be an array");
  if (typeof x.passed !== "boolean") p.push("passed must be boolean");
  if (typeof x.score !== "number" || x.score < 0 || x.score > 100) p.push("score must be 0..100");
  if (x.rubric !== null && x.rubric !== undefined && !["llm", "fallback"].includes(x.rubric.mode))
    p.push('rubric.mode must be "llm" or "fallback"');
  return p;
}
