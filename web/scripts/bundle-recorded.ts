// Packs the committed REAL testnet run (data/testnet-run/) and the deployment config
// into web/src/generated/recorded-run.json, which the API routes import statically.
//
// Why a generated module and not fs at runtime: on serverless hosts (Vercel) files outside
// the function bundle are not guaranteed to exist, and public/ is served from the CDN, not the
// function filesystem. A static import is always bundled, so the recorded run is readable
// everywhere. Runs automatically as `prebuild`; every object is re-hashed before it is packed.
//
//   npm -w web run bundle:recorded
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { hashJson } from "@hivefund/shared";

const WEB = path.join(import.meta.dirname, "..");
const ROOT = path.join(WEB, "..");
const RUN = path.join(ROOT, "data", "testnet-run");
const OUT = path.join(WEB, "src", "generated", "recorded-run.json");

const json = (f: string) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null);
const jsonl = (f: string) =>
  existsSync(f)
    ? readFileSync(f, "utf8")
        .split(/\r?\n/)
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l))
    : [];

const offchain: Record<string, unknown> = {};
let rejected = 0;
const odir = path.join(RUN, "offchain");
if (existsSync(odir)) {
  for (const f of readdirSync(odir)) {
    if (!f.endsWith(".json")) continue;
    const hash = f.slice(0, -5);
    const obj = json(path.join(odir, f));
    if (hashJson(obj) === hash) offchain[hash] = obj;
    else rejected++;
  }
}

const strategy: Record<string, unknown[]> = {};
const sdir = path.join(RUN, "strategy");
if (existsSync(sdir)) {
  for (const f of readdirSync(sdir)) if (f.endsWith(".jsonl")) strategy[f.slice(0, -6)] = jsonl(path.join(sdir, f));
}

const manifest = json(path.join(RUN, "manifest.json"));
const bundle = {
  available: !!manifest,
  manifest,
  deployment: json(path.join(ROOT, "config", "deployment.testnet.json")),
  index: jsonl(path.join(RUN, "index.jsonl")),
  strategy,
  tx: jsonl(path.join(RUN, "tx.jsonl")),
  offchain,
};

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(bundle));
console.log(
  `recorded-run: ${manifest ? "found" : "MISSING"} · ${Object.keys(offchain).length} objects (${rejected} hash mismatches dropped) · ${bundle.tx.length} txs · ${bundle.index.length} index rows -> ${path.relative(ROOT, OUT)}`,
);
