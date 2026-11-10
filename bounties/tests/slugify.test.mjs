// Acceptance test for the "slugify" bounty. Run by the HiveFund verifier as:
//   node bounties/tests/slugify.test.mjs <dir-containing-slugify.mjs>
// Exit code 0 = pass, anything else = fail. Prints one line per failing case.
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

const cases = [
  ["Hello World", "hello-world"],
  ["  Multiple   spaces  ", "multiple-spaces"],
  ["Rust & NEAR!", "rust-near"],
  ["already-slugged", "already-slugged"],
  ["a--b__c", "a-b-c"],
  ["", ""],
  ["---", ""],
  ["Héllo Wörld", "hello-world"],
  ["Crème Brûlée", "creme-brulee"],
  ["Ünïcödé", "unicode"],
  ["Straße", "strasse"],
  ["東京 Tokyo", "tokyo"],
  ["NEAR v2.0 Launch", "near-v2-0-launch"],
  ["...Leading and trailing...", "leading-and-trailing"],
];

let failed = 0;
for (const [input, expected] of cases) {
  let out;
  try {
    out = mod.slugify(input);
  } catch (e) {
    out = `<threw ${e?.name ?? "error"}>`;
  }
  if (out !== expected) {
    failed++;
    console.error(`FAIL slugify(${JSON.stringify(input)}) = ${JSON.stringify(out)}, expected ${JSON.stringify(expected)}`);
  }
}
console.log(`${cases.length - failed}/${cases.length} cases passed`);
process.exit(failed === 0 ? 0 : 1);
