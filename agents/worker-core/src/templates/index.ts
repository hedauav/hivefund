import type { Quality } from "../pricing.ts";
import { checklistTemplate } from "./checklist.ts";
import { slugifyTemplate } from "./slugify.ts";
import { glossaryTemplate } from "./glossary.ts";

export interface TemplateOutput {
  sections: Record<string, string>;
  data: unknown;
  code?: Record<string, string>;
}

/** Built-in fallback generators keyed by the spec's deliverable_schema.$id. */
export const TEMPLATES: Record<string, (q: Quality) => TemplateOutput> = {
  "hivefund:slugify-v2": slugifyTemplate,
  "hivefund:subaccount-checklist-v1": checklistTemplate,
  "hivefund:near-glossary-v1": glossaryTemplate,
};

export function templateFor(schemaId: unknown): ((q: Quality) => TemplateOutput) | null {
  return typeof schemaId === "string" && Object.hasOwn(TEMPLATES, schemaId) ? TEMPLATES[schemaId]! : null;
}
