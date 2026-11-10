// Fallback (no-LLM) generator for the "hivefund:slugify-v2" bounty. Each quality level is a real,
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
  // Full spec: transliteration table, NFKD + mark stripping, apostrophes, options, word-boundary truncation.
  high: `const TRANSLIT = { "\u00df": "ss", "\u1e9e": "ss", "\u00e6": "ae", "\u00c6": "ae", "\u00f8": "o", "\u00d8": "o", "\u0153": "oe", "\u0152": "oe", "\u0111": "d", "\u0110": "d", "\u0142": "l", "\u0141": "l", "\u00fe": "th", "\u00de": "th", "\u00f0": "d", "\u00d0": "d" };
const SEPARATORS = new Set(["-", "_", "."]);
function slugify(input, options = {}) {
  if (typeof input !== "string") throw new TypeError("slugify expects a string");
  const separator = options.separator ?? "-";
  const maxLength = options.maxLength ?? Infinity;
  if (!SEPARATORS.has(separator)) throw new RangeError("separator must be one of - _ .");
  if (maxLength !== Infinity && (!Number.isInteger(maxLength) || maxLength < 1)) throw new RangeError("maxLength must be a positive integer");
  const words = input
    .replace(/[\u00df\u1e9e\u00e6\u00c6\u00f8\u00d8\u0153\u0152\u0111\u0110\u0142\u0141\u00fe\u00de\u00f0\u00d0]/g, (c) => TRANSLIT[c])
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['\u2019]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  let out = "";
  for (const w of words) {
    const next = out ? out + separator + w : w;
    if (next.length > maxLength) {
      if (!out) out = w.slice(0, maxLength);
      break;
    }
    out = next;
  }
  return out;
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
      "1) Transliterate letters NFKD cannot decompose using a fixed table (ß/ẞ -> ss, æ -> ae, ø -> o, œ -> oe, đ/ð -> d, ł -> l, þ -> th) before normalizing. 2) Apply unicode NFKD decomposition, which also expands compatibility forms (ligature ﬁ -> fi, Ⅻ -> XII, ① -> 1). 3) Diacritic stripping: remove combining marks U+0300-U+036F. 4) Remove apostrophes (' and ’) without a separator. 5) Lowercase conversion. 6) Split into words on every run of characters outside [a-z0-9] and join with the separator option (default '-'), so separators never repeat or lead/trail. 7) maxLength: add whole words while they fit; if the first word alone is too long, cut it to maxLength.",
    edge_cases:
      "Empty or whitespace-only input returns an empty string; separator-only input (---) returns empty; repeated separators (a--b__c) collapse; leading or trailing punctuation is trimmed; german sharp s (both cases) becomes ss; diacritics are stripped (Crème -> creme); ligatures, roman numerals and circled digits are expanded by NFKD; non-latin characters such as 東京 are dropped; apostrophes join words (Don't -> dont); a first word longer than maxLength is hard-cut; output never ends with a separator; the function is idempotent for the same options; non-string input throws TypeError and an invalid separator or maxLength throws RangeError.",
  },
};

const EXAMPLE_INPUTS = ["Hello World", "Héllo Wörld", "  Multiple   spaces  ", "Straße", "Rust & NEAR!", "Don't Stop Me Now", "Æsir Œuvre"];

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
