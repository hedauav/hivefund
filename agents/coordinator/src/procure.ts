// npm run procure -- --budget <USD> --task "<text>" [--need "<comma list>"] [--min-context N]
//                    [--input-mtok N] [--output-mtok N] [--reward <NEAR>] [--mode testnet|mock] [--dry-run]
//
// "Type your own request": turns a budget + plain-language task + hard requirements into a procurement
// BountySpec (catalog: NEAR AI Cloud's live model list), posts it through the coordinator and runs the market
// for just that bounty: workers bid -> coordinator selects -> the winner proposes a real model -> the verifier
// re-fetches the live catalog (price, budget, every requirement), makes one real call to the pick, scores
// it with the rubric and calls verify_bounty. Default mode is TESTNET; --mode mock is an offline simulation.
// Honest scope: agents recommend + verify (+ one tiny real call); nobody checks out with a vendor.
import fs from "node:fs";
import path from "node:path";
import {
  bidPublicKey,
  compliantOptions,
  formatHive,
  formatNear,
  liveCatalog,
  parseCatalog,
  parseNear,
  validateSpec,
  type Bounty,
  type BountySpec,
  type CatalogSource,
  type Deliverable,
  type ProcurementRequirements,
  type SelectionRationale,
  type VerificationReport,
} from "@hivefund/shared";
import {
  createMockMarket,
  createTestnetMarket,
  loadDeployment,
  loadEnv,
  openStore,
  readChainState,
  repoRoot,
  type Market,
} from "@hivefund/shared/node";
import { recordedCatalog } from "./agents.ts";
import { runMarket } from "./run.ts";

export const CATALOG_URL = "https://cloud-api.near.ai/v1/models";

/** --need tokens -> catalog fields. Anything else is rejected (never silently ignored). */
const NEED_MAP: Record<string, { field: "supported_features" | "input_modalities" | "output_modalities"; value: string }> = {
  tools: { field: "supported_features", value: "tools" },
  "tool-calling": { field: "supported_features", value: "tools" },
  "function-calling": { field: "supported_features", value: "tools" },
  "structured-outputs": { field: "supported_features", value: "structured_outputs" },
  structured_outputs: { field: "supported_features", value: "structured_outputs" },
  "json-schema": { field: "supported_features", value: "structured_outputs" },
  json: { field: "supported_features", value: "json_mode" },
  "json-mode": { field: "supported_features", value: "json_mode" },
  json_mode: { field: "supported_features", value: "json_mode" },
  reasoning: { field: "supported_features", value: "reasoning" },
  logprobs: { field: "supported_features", value: "logprobs" },
  vision: { field: "input_modalities", value: "image" },
  "image-input": { field: "input_modalities", value: "image" },
  "audio-input": { field: "input_modalities", value: "audio" },
  "image-output": { field: "output_modalities", value: "image" },
};
export const SUPPORTED_NEEDS = Object.keys(NEED_MAP);

export interface ProcureArgs {
  budgetUsd: number;
  task: string;
  needs: string[];
  minContext: number | null;
  inputMtok: number;
  outputMtok: number;
  rewardNear: string;
  mode: "testnet" | "mock";
  dryRun: boolean;
  steps: number;
}

const USAGE =
  'usage: npm run procure -- --budget <USD> --task "<what the model is for>" [--need "tools,structured-outputs"] ' +
  "[--min-context 128000] [--input-mtok 3] [--output-mtok 1] [--reward 0.03] [--mode testnet|mock] [--dry-run]";

export function parseProcureArgs(argv: string[]): ProcureArgs {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    if (i < 0) return undefined;
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value\n${USAGE}`);
    return v;
  };
  const posNum = (flag: string, v: string | undefined, dflt: number | null) => {
    if (v === undefined) return dflt;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${flag} must be a positive number, got "${v}"`);
    return n;
  };
  const budget = posNum("--budget", get("--budget"), null);
  if (budget === null) throw new Error(`--budget is required\n${USAGE}`);
  const task = (get("--task") ?? "").trim();
  if (task.length < 10) throw new Error(`--task is required (describe what the model is for, >= 10 chars)\n${USAGE}`);
  const needs = (get("--need") ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const unknown = needs.filter((n) => !(n in NEED_MAP));
  if (unknown.length)
    throw new Error(`unsupported --need value(s): ${unknown.join(", ")}. Supported: ${SUPPORTED_NEEDS.join(", ")} (use --min-context for context length)`);
  const minCtx = posNum("--min-context", get("--min-context"), null);
  const modeArg = get("--mode") ?? "testnet";
  if (modeArg !== "testnet" && modeArg !== "mock") throw new Error(`--mode must be testnet or mock, got ${modeArg}`);
  const reward = get("--reward") ?? "0.03";
  posNum("--reward", reward, null);
  return {
    budgetUsd: budget,
    task,
    needs,
    minContext: minCtx === null ? null : Math.floor(minCtx),
    inputMtok: posNum("--input-mtok", get("--input-mtok"), 3)!,
    outputMtok: posNum("--output-mtok", get("--output-mtok"), 1)!,
    rewardNear: reward,
    mode: modeArg,
    dryRun: argv.includes("--dry-run"),
    steps: Number(get("--steps") ?? 8),
  };
}

export function requirementsFromArgs(a: Pick<ProcureArgs, "needs" | "minContext">): ProcurementRequirements {
  const req: ProcurementRequirements = { input_modalities: ["text"], output_modalities: ["text"] };
  const add = (field: keyof ProcurementRequirements, value: string) => {
    const list = ((req[field] as string[] | undefined) ?? []).slice();
    if (!list.includes(value)) list.push(value);
    (req as Record<string, unknown>)[field] = list;
  };
  for (const n of a.needs) add(NEED_MAP[n].field, NEED_MAP[n].value);
  if (a.minContext !== null) req.min_context_length = a.minContext;
  return req;
}

function describeRequirements(r: ProcurementRequirements): string {
  const parts: string[] = [];
  if (r.supported_features?.length) parts.push(`supports ${r.supported_features.join(" and ")}`);
  if (r.min_context_length) parts.push(`context length >= ${r.min_context_length} tokens`);
  if (r.input_modalities?.length) parts.push(`${r.input_modalities.join("+")} in`);
  if (r.output_modalities?.length) parts.push(`${r.output_modalities.join("+")} out`);
  return parts.join(", ");
}

/** Build a procurement BountySpec from the user's request, reusing the schema of the reference fixture. */
export function buildProcurementSpec(a: ProcureArgs, root = repoRoot()): BountySpec {
  const template = JSON.parse(
    fs.readFileSync(path.join(root, "bounties", "procurement", "llm-for-support-agent.json"), "utf8"),
  ) as BountySpec;
  const requirements = requirementsFromArgs(a);
  const wl = `${a.inputMtok}M input + ${a.outputMtok}M output tokens`;
  const title = `Procure: ${a.task.length > 80 ? a.task.slice(0, 79) + "…" : a.task}`.slice(0, 120);
  const spec: BountySpec = {
    version: 1,
    title,
    description:
      `User request: ${a.task}. Recommend ONE real model from the NEAR AI Cloud catalog (${CATALOG_URL}) for an expected ` +
      `workload of ${wl}. Hard requirements: ${describeRequirements(requirements)}, and the workload must cost <= ` +
      `${a.budgetUsd.toFixed(2)} USD at the catalog's live prices. Quote the catalog prices exactly (USD per 1M tokens), ` +
      `compare against the alternatives you considered, and justify the value for money for this task. ` +
      `This is a recommendation: nobody checks out or pays the vendor.`,
    deliverable_schema: template.deliverable_schema,
    required_sections: template.required_sections,
    test: null,
    rubric: {
      criteria: [
        {
          id: "value",
          description:
            "Value for money: compared with the live compliant options under budget, the pick offers strong capability for its workload cost; a much pricier pick needs a convincing capability argument.",
          weight: 0.5,
        },
        { id: "fit", description: `Fit for the stated task ("${a.task}") beyond the hard requirements.`, weight: 0.3 },
        {
          id: "justification",
          description:
            "Clear, grounded comparison: quotes real catalog prices and costs, names concrete alternatives, and explains the trade-off without unsupported claims.",
          weight: 0.2,
        },
      ],
      pass_threshold: 70,
    },
    budget_yocto: parseNear(a.rewardNear).toString(),
    min_tier: 1,
    deadline_minutes: 60,
    procurement: {
      catalog: "nearai-models",
      catalog_url: CATALOG_URL,
      currency: "USD",
      product_budget_usd: a.budgetUsd,
      workload: { input_mtok: a.inputMtok, output_mtok: a.outputMtok },
      requirements,
      price_tolerance_pct: 1,
      delivery_check: true,
    },
  };
  const problems = validateSpec(spec);
  if (problems.length) throw new Error(`generated spec is invalid: ${problems.join("; ")}`);
  return spec;
}

export async function shortlist(spec: BountySpec, catalog: CatalogSource) {
  const items = parseCatalog(await catalog(spec.procurement!.catalog_url));
  return { size: items.length, options: compliantOptions(items, spec.procurement!) };
}

async function viewAllowanceYocto(rpcUrl: string, accountId: string, secret: string): Promise<bigint | null | "full"> {
  const publicKey = bidPublicKey(secret);
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "hf",
      method: "query",
      params: { request_type: "view_access_key", finality: "final", account_id: accountId, public_key: publicKey },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await res.json()) as { result?: { permission?: unknown }; error?: unknown };
  const perm = j.result?.permission;
  if (!perm) return null;
  if (perm === "FullAccess") return "full";
  const fc = (perm as { FunctionCall?: { allowance: string | null } }).FunctionCall;
  return fc?.allowance ? BigInt(fc.allowance) : "full";
}

/** Treasury + allowance pre-flight. Throws with a clear, actionable message. */
export async function preflight(market: Market, rewardYocto: string): Promise<string[]> {
  const notes: string[] = [];
  const t = await market.coordinator.hub.view<{ available: string; spend_cap: string; committed_total: string }>("get_treasury", {});
  if (BigInt(t.available) < BigInt(rewardYocto))
    throw new Error(
      `treasury has only ${formatNear(t.available, 4)} NEAR available, the reward is ${formatNear(rewardYocto, 4)} NEAR. ` +
        `Fund it: npx tsx scripts/topup.ts treasury <NEAR>  (or lower --reward)`,
    );
  notes.push(`treasury available ${formatNear(t.available, 4)} NEAR >= reward ${formatNear(rewardYocto, 4)} NEAR`);
  if (market.mode !== "testnet") return notes;
  const dep = loadDeployment()!;
  // NEAR charges the allowance pessimistically (~0.031 NEAR per 30 TGas, ~0.062 per 60 TGas verify).
  const need: [string, string, string, bigint][] = [
    ["coordinator", dep.coordinator, "COORDINATOR_KEY", parseNearBig("0.035")],
    ["verifier", dep.verifier, "VERIFIER_KEY", parseNearBig("0.065")],
    ["cheap", dep.workers.cheap, "WORKER_CHEAP_KEY", parseNearBig("0.035")],
    ["quality", dep.workers.quality, "WORKER_QUALITY_KEY", parseNearBig("0.035")],
    ["adaptive", dep.workers.adaptive, "WORKER_ADAPTIVE_KEY", parseNearBig("0.035")],
  ];
  const low: string[] = [];
  for (const [name, acct, envKey, min] of need) {
    const secret = process.env[envKey];
    if (!secret) throw new Error(`${envKey} missing in .env.local (run npm run setup:testnet)`);
    const a = await viewAllowanceYocto(dep.rpcUrl, acct, secret);
    if (a === null) throw new Error(`${name}'s function-call key is not on chain (rekey: npx tsx scripts/topup.ts rekey ${name} 0.1)`);
    if (a !== "full" && a < min) low.push(`${name} (${formatNear(a.toString(), 4)} NEAR left)`);
    else notes.push(`${name} allowance ${a === "full" ? "unlimited" : formatNear(a.toString(), 4) + " NEAR"}`);
  }
  if (low.length)
    throw new Error(
      `function-call allowance too low for: ${low.join(", ")}. NEAR reserves ~0.031 NEAR per 30 TGas call. ` +
        `Rekey: npx tsx scripts/topup.ts rekey <agent> 0.1`,
    );
  return notes;
}

function parseNearBig(n: string): bigint {
  return parseNear(n);
}

function usd(n: number | null | undefined): string {
  return n === null || n === undefined ? "?" : `$${n.toFixed(n < 0.01 ? 6 : 2)}`;
}

/** Human summary of one procurement bounty after the run. */
export function renderProcureSummary(market: Market, spec: BountySpec, bounty: Bounty | undefined, state: Awaited<ReturnType<typeof readChainState>>): string {
  const out: string[] = [];
  const p = spec.procurement!;
  const ex = market.explorer;
  const link = (h: string | null | undefined) => (h && ex && market.mode === "testnet" ? `${ex}/txns/${h}` : h ?? "-");
  out.push(`\n================ Procurement result (${market.mode}${market.mode === "mock" ? " — simulation, not on-chain" : ""}) ================`);
  out.push(`Request : ${spec.title.replace(/^Procure: /, "")}`);
  out.push(`Budget  : ${usd(p.product_budget_usd)} for ${p.workload.input_mtok}M in + ${p.workload.output_mtok}M out tokens · reward ${formatNear(spec.budget_yocto, 4)} NEAR`);
  out.push(`Needs   : ${describeRequirements(p.requirements)}`);
  if (!bounty) {
    out.push("bounty not found on-chain");
    return out.join("\n");
  }
  out.push(`Bounty  : #${bounty.id} — ${bounty.status} (round ${bounty.round}, attempts ${bounty.attempts})`);

  const idx = market.store.readIndex().filter((e) => e.bounty_id === bounty.id);
  const get = <T,>(kind: string) => idx.filter((e) => e.kind === kind).map((e) => market.store.get<T>(e.hash));
  const short = (a: string) => a.split(".")[0];

  const bids = state.bids[String(bounty.id)] ?? [];
  const rationales = get<SelectionRationale>("selection");
  const scoreOf = (bidId: number) => rationales.flatMap((r) => r.candidates).find((c) => c.bid_id === bidId)?.score;
  out.push("\nBids (each worker decides independently; coordinator score = weighted price/ETA/reputation)");
  for (const b of bids) {
    const s = scoreOf(b.id);
    out.push(
      `  #${b.id} r${b.round} ${short(b.worker).padEnd(9)} ${formatNear(b.price_yocto, 5).padStart(8)} NEAR  ` +
        `score ${s === undefined ? "  -   " : s.toFixed(4)}  ${b.status}${b.reject_reason ? ` (${b.reject_reason})` : ""}`,
    );
  }

  const deliverables = get<Deliverable>("deliverable");
  const reports = get<VerificationReport>("report");
  for (const d of deliverables) {
    const data = d.data as { item_id?: string; quoted_pricing?: { input: number; output: number }; quoted_workload_cost_usd?: number; considered_count?: number };
    out.push(
      `\nRound ${d.round} proposal by ${short(d.worker)}: ${data.item_id ?? "?"} — quoted $${data.quoted_pricing?.input ?? "?"}/$${data.quoted_pricing?.output ?? "?"} per 1M in/out, ` +
        `workload ${usd(data.quoted_workload_cost_usd)} (scanned ${data.considered_count ?? "?"} catalog entries; generator ${d.generator?.mode ?? "?"}${d.generator?.model ? ` ${d.generator.model}` : ""})`,
    );
    const r = reports.find((x) => x.round === d.round && x.worker === d.worker);
    if (!r) continue;
    const e = r.procurement;
    if (e) {
      out.push(`  live catalog: ${e.catalog_size} items fetched ${new Date(e.fetched_at_ms).toISOString()}; item found ${e.found ? "✓" : "✗"}`);
      out.push(
        `  price: quoted ${e.quoted_pricing ? `$${e.quoted_pricing.input}/$${e.quoted_pricing.output}` : "?"} vs live ${e.live_pricing ? `$${e.live_pricing.input}/$${e.live_pricing.output}` : "?"} ${e.price_match ? "✓" : "✗"}` +
          ` · live workload ${usd(e.live_workload_cost_usd)} vs budget ${usd(e.budget_usd)} ${e.within_budget ? "✓" : "✗"}`,
      );
      for (const c of e.requirement_checks) out.push(`  ${c.passed ? "✓" : "✗"} ${c.requirement}: expected ${c.expected}; actual ${c.actual}`);
      out.push(`  compliant live options under budget: ${e.compliant_count}${e.cheapest_compliant ? ` (cheapest ${e.cheapest_compliant.id} at ${usd(e.cheapest_compliant.workload_cost_usd)})` : ""}`);
      if (e.delivery) out.push(`  delivery call: ${e.delivery.ok ? "✓" : "✗"} HTTP ${e.delivery.http_status ?? "-"}, ${e.delivery.prompt_tokens ?? "?"}+${e.delivery.completion_tokens ?? "?"} tokens, cost ${usd(e.delivery.cost_usd)}`);
    }
    for (const c of r.checks) if (!["catalog", "delivery"].includes(c.id)) out.push(`  ${c.skipped ? "–" : c.passed ? "✓" : "✗"} ${c.id}${c.skipped ? " (skipped)" : ""}`);
    if (r.rubric) out.push(`  rubric (${r.rubric.mode}${r.rubric.model ? ` ${r.rubric.model}` : ""}): ${r.rubric.total} / threshold ${r.rubric.threshold}`);
    out.push(`  VERDICT: ${r.passed ? "PASS" : "FAIL"} (score ${r.score})`);
  }
  if (!deliverables.length) out.push("\n(no proposal was delivered)");

  const mint = state.supply_history.find((s) => s.bounty_id === bounty.id);
  const win = bounty.winner_bid_id == null ? null : bids.find((b) => b.id === bounty.winner_bid_id);
  out.push(
    `\nOutcome: ${bounty.status}` +
      (bounty.status === "Completed" && win ? ` — ${short(win.worker)} paid ${formatNear(win.price_yocto, 5)} NEAR, ${formatHive(bounty.hive_minted)} HIVE minted` : "") +
      (mint ? ` (mint: ${mint.bid_units} units × ${mint.score}/100 × rate)` : ""),
  );

  if (market.mode === "testnet") {
    const txs = market.store.readTx().filter((t) => {
      const a = t.args as Record<string, unknown> | undefined;
      return a && (a.bounty_id === bounty.id || (t.method === "post_bounty" && (t as { bounty_id?: number }).bounty_id === bounty.id));
    });
    out.push("\nTransactions");
    for (const t of txs) out.push(`  ${t.method.padEnd(14)} ${short(t.actor).padEnd(11)} ${t.ok === false ? "FAILED " : ""}${link(t.txHash)}`);
  }
  return out.join("\n");
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  loadEnv();
  const args = parseProcureArgs(argv);
  const spec = buildProcurementSpec(args);
  const catalog: CatalogSource = args.mode === "mock" ? recordedCatalog(repoRoot()) : liveCatalog;

  console.log(`HiveFund procurement request (${args.mode}${args.mode === "mock" ? ": offline simulation, recorded catalog" : ": live catalog + testnet"})`);
  console.log(`  task   : ${args.task}`);
  console.log(`  budget : $${args.budgetUsd} for ${args.inputMtok}M in + ${args.outputMtok}M out tokens`);
  console.log(`  needs  : ${describeRequirements(spec.procurement!.requirements)}`);
  console.log(`  reward : ${args.rewardNear} NEAR (paid from the treasury only if the pick passes verification)`);

  const sl = await shortlist(spec, catalog);
  console.log(`\nCatalog ${spec.procurement!.catalog_url}: ${sl.size} priced items, ${sl.options.length} meet every requirement under budget`);
  for (const o of sl.options.slice(0, 10))
    console.log(`  ${usd(o.workload_cost_usd).padStart(8)}  ${o.item.id}  (ctx ${o.item.context_length ?? "?"}; $${o.item.pricing.input}/$${o.item.pricing.output} per 1M)`);
  if (sl.options.length > 10) console.log(`  … ${sl.options.length - 10} more`);

  if (args.dryRun) {
    console.log("\n--dry-run: generated spec (nothing posted):");
    console.log(JSON.stringify(spec, null, 2));
    return 0;
  }
  if (!sl.options.length) {
    console.error("\nNo catalog item meets these requirements under this budget — not posting a bounty nobody can pass. Raise --budget or relax --need.");
    return 3;
  }

  let market: Market;
  if (args.mode === "testnet") {
    market = createTestnetMarket();
  } else {
    const dir = path.join(repoRoot(), "data", "mock-procure");
    fs.rmSync(dir, { recursive: true, force: true });
    market = await createMockMarket({ store: openStore(dir) });
  }
  for (const n of await preflight(market, spec.budget_yocto)) console.log(`  pre-flight ✓ ${n}`);

  // The coordinator posts from spec files; keep the generated request in the (gitignored) data dir.
  const reqDir = path.join(market.store.dir, "requests");
  fs.mkdirSync(reqDir, { recursive: true });
  const specFile = path.join(reqDir, `procure-${Date.now()}.json`);
  fs.writeFileSync(specFile, JSON.stringify(spec, null, 2));

  const run = await runMarket(market, { maxSteps: args.steps, forger: false, coordinator: { specFiles: [specFile] } });
  const state = await readChainState(market.coordinator.hub, market.token, market.mode);
  market.store.writeJson("chain-state.json", state);
  const id = run.postedIds[0];
  console.log(renderProcureSummary(market, spec, state.bounties.find((b) => b.id === id), state));
  return run.allTerminal ? 0 : 2;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).replace(/\.ts$/, "") === path.resolve(import.meta.filename ?? "").replace(/\.ts$/, "");
if (isMain) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(`procure failed: ${(e as Error).message}`);
      process.exit(1);
    },
  );
}
