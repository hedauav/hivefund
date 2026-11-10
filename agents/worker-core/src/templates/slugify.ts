// Fallback (no-LLM) generator for the "hivefund:slugify-v1" bounty. Each quality level is a real,
// different implementation; the example outputs are produced by actually running that implementation,
// so a sloppy worker's deliverable honestly shows its own wrong outputs and fails the acceptance test.
import type { Quality } from "../pricing.ts";
import type { TemplateOutput } from "./index.ts";

const IMPL: Record<Quality, string> = {
  // Skips normalization and separator collapsing entirely.
  low: `function slugify(input) {
  return String(input).toLowerCase().trim().split(" ").join("-");
}`,
  // Collapses separators but has no unicode handling: "Héllo" -> "h-llo".
  medium: `function slugify(input) {
  return String(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}`,
  // Transliterates sharp s, NFKD-decomposes, strips combining marks, collapses separators.
  high: `function slugify(input) {
  if (typeof input !== "string") throw new TypeError("slugify expects a string");
  return input
    .replace(/\\u00df/g, "ss")
    .replace(/\\u1e9e/g, "SS")
    .normalize("NFKD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}`,
};

const SECTIONS: Record<Quality, { approach: string; edge_cases: string }> = {
  low: {
    approach: "Lowercase the input and replace spaces with hyphens.",
    edge_cases: "Handles normal titles.",
  },
  medium: {
    approach:
      "Lowercase the input, replace every run of characters outside a-z and 0-9 with a single hyphen, then trim hyphens from both ends.",
    edge_cases:
      "Repeated separators collapse into one hyphen; leading or trailing punctuation is trimmed; empty input returns an empty string.",
  },
  high: {
    approach:
      "1) Transliterate the german sharp s (ß -> ss) since it has no unicode decomposition. 2) Apply unicode NFKD decomposition so accented letters split into base letter + combining mark. 3) Diacritic stripping: remove combining marks (U+0300-U+036F). 4) Lowercase conversion. 5) Collapse every run of non [a-z0-9] characters into a single hyphen separator and trim hyphens at both ends.",
    edge_cases:
      "Empty input returns an empty string; input of only separators (---) returns empty; repeated separators (a--b__c) collapse to one hyphen; leading or trailing punctuation is trimmed; german sharp s becomes ss; diacritics are stripped (Crème -> creme); non-latin characters such as 東京 are dropped; digits and dots (v2.0) become v2-0; non-string input throws TypeError.",
  },
};

const EXAMPLE_INPUTS = ["Hello World", "Héllo Wörld", "  Multiple   spaces  ", "Straße", "Rust & NEAR!"];

export function slugifyTemplate(quality: Quality): TemplateOutput {
  const src = IMPL[quality];
  // Run the exact code we are shipping to produce honest examples.
  const fn = new Function(`${src}\nreturn slugify;`)() as (s: string) => string;
  const examples = EXAMPLE_INPUTS.map((input) => {
    let output: string;
    try {
      output = String(fn(input));
    } catch (e) {
      output = `<throws ${(e as Error).name}>`;
    }
    return { input, output };
  });
  return {
    sections: { ...SECTIONS[quality] },
    data: { function_name: "slugify", file: "slugify.mjs", examples },
    code: { "slugify.mjs": `${src}\n\nexport { slugify };\n` },
  };
}
