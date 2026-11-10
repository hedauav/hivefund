// Acceptance test for the "slugify" bounty (spec hivefund:slugify-v2). Run by the HiveFund verifier as:
//   node bounties/tests/slugify.test.mjs <dir-containing-slugify.mjs>
// Exit code 0 = pass, anything else = fail. Prints one line per failing case.
// Every expectation below follows directly from the numbered rules in bounties/slugify.json.
import path from "node:path";
import { pathToFileURL } from "node:url";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node slugify.test.mjs <deliverable-dir>");
  process.exit(2);
}

let mod;
try {
  mod = await import(pathToFileURL(path.join(dir, "slugify.mjs")).href);
} catch (e) {
  console.error("cannot import slugify.mjs:", e?.message ?? e);
  process.exit(1);
}
if (typeof mod.slugify !== "function") {
  console.error("slugify.mjs does not export a function named slugify");
  process.exit(1);
}
const { slugify } = mod;

// [input, options | undefined, expected]
const cases = [
  // rules 4-6: lowercase, separators, collapsing, trimming
  ["Hello World", undefined, "hello-world"],
  ["  Multiple   spaces  ", undefined, "multiple-spaces"],
  ["Rust & NEAR!", undefined, "rust-near"],
  ["already-slugged", undefined, "already-slugged"],
  ["a--b__c", undefined, "a-b-c"],
  ["NEAR v2.0 Launch", undefined, "near-v2-0-launch"],
  ["...Leading and trailing...", undefined, "leading-and-trailing"],
  // rule 8: empty results
  ["", undefined, ""],
  ["   \t\n ", undefined, ""],
  ["---", undefined, ""],
  // rule 2: NFKD + combining-mark stripping (incl. compatibility forms)
  ["Héllo Wörld", undefined, "hello-world"],
  ["Crème Brûlée", undefined, "creme-brulee"],
  ["Ünïcödé", undefined, "unicode"],
  ["ﬁnancial Ⅻ", undefined, "financial-xii"],
  ["①②③ ok", undefined, "123-ok"],
  // rule 1: transliteration table
  ["Straße", undefined, "strasse"],
  ["GROSSE STRAẞE", undefined, "grosse-strasse"],
  ["Æsir Œuvre Ørsted", undefined, "aesir-oeuvre-orsted"],
  ["Łódź Đakovo", undefined, "lodz-dakovo"],
  ["Þórr Garðar", undefined, "thorr-gardar"],
  // rule 5: other non-ASCII dropped
  ["東京 Tokyo", undefined, "tokyo"],
  // rule 3: apostrophes removed without a separator
  ["Don't Stop Me Now", undefined, "dont-stop-me-now"],
  ["Rock’n’Roll", undefined, "rocknroll"],
  // rule 6: options.separator
  ["Hello World", { separator: "_" }, "hello_world"],
  ["Hello World", { separator: "." }, "hello.world"],
  ["a_b-c.d", { separator: "_" }, "a_b_c_d"],
  // rule 7: options.maxLength truncates on a word boundary
  ["The quick brown fox jumps", { maxLength: 15 }, "the-quick-brown"],
  ["The quick brown fox", { maxLength: 9 }, "the-quick"],
  ["one two", { maxLength: 7 }, "one-two"],
  ["one two", { maxLength: 6 }, "one"],
  ["Supercalifragilistic word", { maxLength: 5 }, "super"],
  ["Crème Brûlée Recipe", { separator: "_", maxLength: 12 }, "creme_brulee"],
];

let failed = 0;
const fail = (msg) => {
  failed++;
  console.error(`FAIL ${msg}`);
};
const show = (input, opts) => `slugify(${JSON.stringify(input)}${opts ? ", " + JSON.stringify(opts) : ""})`;

for (const [input, opts, expected] of cases) {
  let out;
  try {
    out = opts === undefined ? slugify(input) : slugify(input, opts);
  } catch (e) {
    out = `<threw ${e?.name ?? "error"}>`;
  }
  if (out !== expected) fail(`${show(input, opts)} = ${JSON.stringify(out)}, expected ${JSON.stringify(expected)}`);
  // rule 9: idempotency with the same options
  else if (typeof out === "string") {
    let again;
    try {
      again = opts === undefined ? slugify(out) : slugify(out, opts);
    } catch (e) {
      again = `<threw ${e?.name ?? "error"}>`;
    }
    if (again !== out) fail(`not idempotent: ${show(out, opts)} = ${JSON.stringify(again)}`);
  }
}

// rule 10: input/option validation
const throwsCases = [
  [() => slugify(42), TypeError, "slugify(42)"],
  [() => slugify(null), TypeError, "slugify(null)"],
  [() => slugify("x", { separator: "+" }), RangeError, 'slugify("x", {separator:"+"})'],
  [() => slugify("x", { maxLength: 0 }), RangeError, 'slugify("x", {maxLength:0})'],
  [() => slugify("x", { maxLength: 2.5 }), RangeError, 'slugify("x", {maxLength:2.5})'],
];
for (const [fn, Err, label] of throwsCases) {
  try {
    fn();
    fail(`${label} should throw ${Err.name}`);
  } catch (e) {
    if (!(e instanceof Err)) fail(`${label} threw ${e?.name ?? e}, expected ${Err.name}`);
  }
}

const total = cases.length + throwsCases.length;
console.log(`${total - failed}/${total} checks passed`);
process.exit(failed === 0 ? 0 : 1);
