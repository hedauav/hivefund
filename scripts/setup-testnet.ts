// HiveFund testnet setup (Stream A). Idempotent: every step checks chain state first and is
// skipped when already done, so it is safe to re-run after a partial failure.
//
//   npx tsx scripts/setup-testnet.ts --dry-run     # print the plan + read-only chain checks, send nothing
//   npx tsx scripts/setup-testnet.ts --offline --dry-run   # plan only, no RPC at all
//   npx tsx scripts/setup-testnet.ts               # REAL run (testnet): needs the human's approval
//   npx tsx scripts/setup-testnet.ts --check       # post-deploy self-check only
//   npx tsx scripts/setup-testnet.ts --redeploy    # also redeploy code if the local wasm changed
//
// Reads ROOT_ACCOUNT / ROOT_PRIVATE_KEY from .env.local (or the process env). Writes agent keys
// to .env.local (never printed) and public info + tx hashes to config/deployment.testnet.json.
import { PublicKey, actions, teraToGas } from "near-api-js";
import {
  Net,
  codeStorageNear,
  env,
  envNear,
  errMsg,
  findWasm,
  fmtNear,
  newKey,
  nearToYoctoExact,
  publicKeyOf,
  readDeployment,
  step,
  txUrl,
  upsertEnv,
  writeDeployment,
  type WasmInfo,
} from "./near-ops.ts";

const ARGS = new Set(process.argv.slice(2));
const DRY = ARGS.has("--dry-run");
const OFFLINE = ARGS.has("--offline");
const CHECK_ONLY = ARGS.has("--check");
const REDEPLOY = ARGS.has("--redeploy");

// ------------------------------------------------------------------ configuration

type Role = "coordinator" | "verifier" | "worker";
interface AgentSpec {
  key: string; // short name / sub-account prefix
  role: Role;
  envKey: string; // FC key env var
  bidEnvKey?: string; // bid-signing key env var (workers)
  tier?: number;
}

const AGENTS: AgentSpec[] = [
  { key: "coordinator", role: "coordinator", envKey: "COORDINATOR_KEY" },
  { key: "verifier", role: "verifier", envKey: "VERIFIER_KEY" },
  { key: "cheap", role: "worker", envKey: "WORKER_CHEAP_KEY", bidEnvKey: "WORKER_CHEAP_BID_KEY", tier: 1 },
  { key: "quality", role: "worker", envKey: "WORKER_QUALITY_KEY", bidEnvKey: "WORKER_QUALITY_BID_KEY", tier: 3 },
  { key: "adaptive", role: "worker", envKey: "WORKER_ADAPTIVE_KEY", bidEnvKey: "WORKER_ADAPTIVE_BID_KEY", tier: 2 },
  // Adversarial demo worker: registered with its own bid key, signs bids with a wrong key at runtime.
  { key: "forger", role: "worker", envKey: "WORKER_FORGER_KEY", bidEnvKey: "WORKER_FORGER_BID_KEY", tier: 1 },
];

const METHODS: Record<Role, string[]> = {
  coordinator: ["post_bounty", "select_winner", "reject_bid", "cancel_bounty"],
  verifier: ["verify_bounty"],
  worker: ["place_bid", "submit_work"],
};

const ROOT = env("ROOT_ACCOUNT");
const ROOT_KEY = env("ROOT_PRIVATE_KEY");
if (!ROOT || !ROOT_KEY) {
  console.error("ROOT_ACCOUNT / ROOT_PRIVATE_KEY missing (expected in .env.local).");
  process.exit(1);
}
if (!ROOT.endsWith(".testnet")) {
  console.error(`Refusing to run: ROOT_ACCOUNT ${ROOT} is not a .testnet account.`);
  process.exit(1);
}
const ROOT_PK = publicKeyOf(ROOT_KEY);

const HUB = `${env("HUB_PREFIX", "hub")}.${ROOT}`;
const TOKEN = `${env("TOKEN_PREFIX", "hive")}.${ROOT}`;
const agentId = (a: AgentSpec) => `${a.key}.${ROOT}`;

const hubWasm = findWasm("bounty_hub");
const tokenWasm = findWasm("hive_token");
if (!CHECK_ONLY && (!hubWasm || !tokenWasm)) {
  console.error("Missing wasm. Build first: powershell -File scripts/build-contracts.ps1 (or bash scripts/build-contracts.sh)");
  process.exit(1);
}

const BUFFER = envNear("CONTRACT_STATE_BUFFER_NEAR", "0.2");
const contractFund = (name: string, w: WasmInfo | null) =>
  env(name) ? nearToYoctoExact(env(name)!) : (w ? codeStorageNear(w.bytes) : 0n) + BUFFER;
const HUB_FUND = contractFund("HUB_FUND_NEAR", hubWasm);
const TOKEN_FUND = contractFund("HIVE_FUND_NEAR", tokenWasm);
const AGENT_FUND = envNear("AGENT_FUND_NEAR", "0.1");
const FC_ALLOWANCE = envNear("FC_ALLOWANCE_NEAR", "0.05");
const TREASURY_FUND = envNear("TREASURY_FUND_NEAR", "0.5");
const TREASURY_CAP = envNear("TREASURY_CAP_NEAR", "1");
const MINT_RATE = env("MINT_RATE", "10000000000000000")!; // 1e16
const GAS_MARGIN = envNear("GAS_MARGIN_NEAR", "0.3");
// "root": the agent account also holds ROOT's public key as a recovery key held by the human
// (the agent process itself only ever gets its function-call key). Enables scripts/topup.ts rekey.
// "none": agents hold ONLY their function-call key (no recovery; exhausted allowance = new account).
const RECOVERY = (env("AGENT_RECOVERY_KEY", "root") ?? "root").toLowerCase();

const net = new Net();
const txs: Record<string, string> = {};
const log = (s: string) => console.log(s);

// ------------------------------------------------------------------ plan / dry run

async function printPlan(): Promise<boolean> {
  log(`HiveFund testnet setup — ${DRY ? "DRY RUN (nothing is sent)" : CHECK_ONLY ? "SELF-CHECK" : "REAL RUN"}`);
  log(`root      ${ROOT} (pk ${ROOT_PK})`);
  log(`rpc       ${net.urls.join("  ->  ")}`);
  log(`hub       ${HUB}  wasm ${hubWasm?.bytes ?? "?"} B sha256 ${hubWasm?.sha256Hex.slice(0, 16) ?? "?"}…  fund ${fmtNear(HUB_FUND)} (ceil(bytes/100KB) NEAR + buffer ${fmtNear(BUFFER)})`);
  log(`token     ${TOKEN}  wasm ${tokenWasm?.bytes ?? "?"} B sha256 ${tokenWasm?.sha256Hex.slice(0, 16) ?? "?"}…  fund ${fmtNear(TOKEN_FUND)}`);
  for (const a of AGENTS) {
    log(`agent     ${agentId(a).padEnd(36)} ${a.role.padEnd(11)} fund ${fmtNear(AGENT_FUND)}  FC key -> ${HUB} [${METHODS[a.role].join(", ")}] allowance ${fmtNear(FC_ALLOWANCE)}${a.tier ? `  tier ${a.tier}` : ""}`);
  }
  log(`treasury  fund_treasury ${fmtNear(TREASURY_FUND)}   spend cap ${fmtNear(TREASURY_CAP)}   mint_rate ${MINT_RATE}`);
  log(`recovery  agent recovery key: ${RECOVERY === "none" ? "none (FC key only)" : "ROOT public key (human custody)"}`);

  let needed = HUB_FUND + TOKEN_FUND + AGENT_FUND * BigInt(AGENTS.length) + TREASURY_FUND + GAS_MARGIN;
  if (OFFLINE) {
    log(`total     up to ${fmtNear(needed)} (incl. gas margin ${fmtNear(GAS_MARGIN)}); offline: no chain checks`);
    return true;
  }

  log("\nread-only chain checks:");
  const root = await net.viewAccount(ROOT!);
  if (!root) {
    log(`  x root account ${ROOT} does not exist`);
    return false;
  }
  const rootKey = await net.accessKey(ROOT!, ROOT_PK);
  log(`  root balance ${fmtNear(BigInt(root.amount))}; key ${rootKey ? (rootKey.permission === "FullAccess" ? "FullAccess ✓" : "NOT full access ✗") : "NOT FOUND ✗"}`);
  needed = GAS_MARGIN;
  for (const [id, fund, w] of [
    [HUB, HUB_FUND, hubWasm],
    [TOKEN, TOKEN_FUND, tokenWasm],
  ] as const) {
    const v = await net.viewAccount(id);
    if (!v) {
      needed += fund;
      log(`  - ${id}: will be created (${fmtNear(fund)}) and deployed`);
    } else {
      const same = w && v.code_hash === w.codeHash;
      log(`  = ${id}: exists, balance ${fmtNear(BigInt(v.amount))}, code ${v.code_hash === "11111111111111111111111111111111" ? "none -> will deploy" : same ? "up to date" : REDEPLOY ? "differs -> will redeploy" : "differs (use --redeploy)"}`);
    }
  }
  for (const a of AGENTS) {
    const v = await net.viewAccount(agentId(a));
    if (!v) needed += AGENT_FUND;
    log(`  ${v ? "=" : "-"} ${agentId(a)}: ${v ? `exists, balance ${fmtNear(BigInt(v.amount))}` : `will be created (${fmtNear(AGENT_FUND)})`}`);
  }
  const t = await net.tryView<{ funded_total: string }>(HUB, "get_treasury");
  const funded = t ? BigInt(t.funded_total) : 0n;
  if (funded < TREASURY_FUND) needed += TREASURY_FUND - funded;
  log(`  treasury funded so far: ${fmtNear(funded)}`);
  const ok = BigInt(root.amount) >= needed;
  log(`  root needs ~${fmtNear(needed)} for remaining steps -> ${ok ? "OK" : "INSUFFICIENT (top up the root account)"}`);
  return ok && !!rootKey && rootKey.permission === "FullAccess";
}

// ------------------------------------------------------------------ steps

async function exists(id: string) {
  return (await net.viewAccount(id)) !== null;
}

async function sendRoot(label: string, receiverId: string, acts: Parameters<Net["send"]>[3]) {
  const r = await net.send(ROOT!, ROOT_KEY!, receiverId, acts);
  txs[label] = r.txHash;
  if (!r.ok) throw new Error(`${label}: tx ${r.txHash} failed: ${r.failure}`);
  log(`      tx ${txUrl(r.txHash)}`);
  return r;
}

async function createContractAccount(id: string, fund: bigint, label: string) {
  await step(`create ${id} (${fmtNear(fund)})`, () => exists(id), () =>
    sendRoot(label, id, [
      actions.createAccount(),
      actions.transfer(fund),
      // Root's key controls the contract accounts (upgrades); no agent ever holds it.
      actions.addFullAccessKey(PublicKey.fromString(ROOT_PK)),
    ]),
  );
}

async function deployContract(id: string, w: WasmInfo, initMethod: string, initArgs: object, label: string, initView: () => Promise<unknown>) {
  const v = await net.viewAccount(id);
  if (!v) throw new Error(`${id} missing`);
  const empty = v.code_hash === "11111111111111111111111111111111";
  const initialized = !empty && (await initView()) !== null;
  if (!empty && v.code_hash !== w.codeHash) {
    if (!REDEPLOY) {
      log(`  ! ${id}: on-chain code differs from local wasm; keeping it (pass --redeploy to upgrade)`);
    } else {
      await step(`redeploy code on ${id}`, async () => (await net.viewAccount(id))?.code_hash === w.codeHash, () =>
        net.send(id, ROOT_KEY!, id, [actions.deployContract(w.code)]).then((r) => {
          txs[`${label}Redeploy`] = r.txHash;
          if (!r.ok) throw new Error(`redeploy failed: ${r.failure}`);
          log(`      tx ${txUrl(r.txHash)}`);
        }),
      );
    }
  }
  if (empty) {
    await step(`deploy + ${initMethod} on ${id}`, async () => (await net.viewAccount(id))?.code_hash === w.codeHash && (await initView()) !== null, () =>
      net.send(id, ROOT_KEY!, id, [
        actions.deployContract(w.code),
        actions.functionCall(initMethod, initArgs, teraToGas(100), 0n),
      ]).then((r) => {
        txs[label] = r.txHash;
        if (!r.ok) throw new Error(`deploy failed: ${r.failure}`);
        log(`      tx ${txUrl(r.txHash)}`);
      }),
    );
  } else if (!initialized) {
    await step(`${initMethod} on ${id}`, async () => (await initView()) !== null, () =>
      net.send(id, ROOT_KEY!, id, [actions.functionCall(initMethod, initArgs, teraToGas(100), 0n)]).then((r) => {
        txs[`${label}Init`] = r.txHash;
        if (!r.ok) throw new Error(`init failed: ${r.failure}`);
        log(`      tx ${txUrl(r.txHash)}`);
      }),
    );
  } else {
    log(`  = ${id}: deployed and initialized`);
  }
}

interface HubConfig {
  owner: string;
  coordinator: string | null;
  verifier: string | null;
  hive_token: string;
  mint_rate: string;
}
interface WorkerView {
  account_id: string;
  tier: number;
  signing_pk: string;
  active: boolean;
}

/** Ensures the agent account exists with exactly the expected FC key; returns its secret. */
async function ensureAgent(a: AgentSpec): Promise<void> {
  const id = agentId(a);
  let secret = env(a.envKey);
  if (!secret) {
    secret = newKey().toString();
    upsertEnv({ [a.envKey]: secret }); // persist BEFORE any tx so a crash never loses the key
    log(`  * generated FC key for ${id} -> .env.local ${a.envKey}`);
  }
  const pk = publicKeyOf(secret);
  const fcKey = actions.addFunctionCallAccessKey(PublicKey.fromString(pk), HUB, METHODS[a.role], FC_ALLOWANCE);

  if (!(await exists(id))) {
    const acts = [actions.createAccount(), actions.transfer(AGENT_FUND), fcKey];
    if (RECOVERY !== "none") acts.push(actions.addFullAccessKey(PublicKey.fromString(ROOT_PK)));
    await step(`create ${id} with FC key`, () => exists(id), () => sendRoot(`create_${a.key}`, id, acts));
    return;
  }
  const onChain = await net.accessKey(id, pk);
  if (onChain) {
    log(`  = ${id}: FC key present`);
    return;
  }
  // Account exists but the local key is not on it: re-key with the recovery key if we have one.
  const rootOnAgent = await net.accessKey(id, ROOT_PK);
  if (!rootOnAgent) {
    throw new Error(`${id} exists but ${a.envKey} is not one of its keys and there is no recovery key. Restore the key in .env.local or choose another ROOT/prefix.`);
  }
  await step(`add FC key to existing ${id}`, async () => (await net.accessKey(id, pk)) !== null, () =>
    net.send(id, ROOT_KEY!, id, [fcKey]).then((r) => {
      txs[`rekey_${a.key}`] = r.txHash;
      if (!r.ok) throw new Error(`add key failed: ${r.failure}`);
      log(`      tx ${txUrl(r.txHash)}`);
    }),
  );
}

async function ensureRoles() {
  const cfg = () => net.view<HubConfig>(HUB, "get_config");
  await step(`set_coordinator ${agentId(AGENTS[0])}`, async () => (await cfg()).coordinator === agentId(AGENTS[0]), () =>
    sendRoot("setCoordinator", HUB, [actions.functionCall("set_coordinator", { account_id: agentId(AGENTS[0]) }, teraToGas(30), 0n)]),
  );
  await step(`set_verifier ${agentId(AGENTS[1])}`, async () => (await cfg()).verifier === agentId(AGENTS[1]), () =>
    sendRoot("setVerifier", HUB, [actions.functionCall("set_verifier", { account_id: agentId(AGENTS[1]) }, teraToGas(30), 0n)]),
  );
}

async function ensureWorker(a: AgentSpec) {
  const id = agentId(a);
  let bidSecret = env(a.bidEnvKey!);
  if (!bidSecret) {
    bidSecret = newKey().toString();
    upsertEnv({ [a.bidEnvKey!]: bidSecret });
    log(`  * generated bid-signing key for ${id} -> .env.local ${a.bidEnvKey}`);
  }
  const signingPk = publicKeyOf(bidSecret);
  const current = async () => (await net.view<WorkerView[]>(HUB, "get_reputation", { account_id: id }))[0];
  await step(`add_worker ${id} tier ${a.tier}`, async () => {
    const w = await current();
    return !!w && w.active && w.tier === a.tier && w.signing_pk === signingPk;
  }, () =>
    sendRoot(`addWorker_${a.key}`, HUB, [
      actions.functionCall("add_worker", { account_id: id, tier: a.tier, signing_pk: signingPk }, teraToGas(30), 0n),
    ]),
  );
}

async function ensureTreasury() {
  const funded = async () => BigInt((await net.view<{ funded_total: string }>(HUB, "get_treasury")).funded_total);
  const have = await funded();
  if (have >= TREASURY_FUND) {
    log(`  = treasury funded (${fmtNear(have)})`);
    return;
  }
  const delta = TREASURY_FUND - have;
  await step(`fund_treasury ${fmtNear(delta)}`, async () => (await funded()) >= TREASURY_FUND, () =>
    sendRoot("fundTreasury", HUB, [actions.functionCall("fund_treasury", {}, teraToGas(30), delta)]),
  );
}

// ------------------------------------------------------------------ self-check

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

async function expectAccessKeyRejection(name: string, signerId: string, secret: string, method: string, args: object): Promise<CheckResult> {
  try {
    const r = await net.send(signerId, secret, HUB, [actions.functionCall(method, args, teraToGas(30), 0n)]);
    // Landing at all means the FC key allowed the method: that is a security failure.
    return { name, ok: false, detail: `UNEXPECTED: tx landed (${r.txHash}) ok=${r.ok}` };
  } catch (e) {
    const m = errMsg(e);
    const ok = /MethodNameMismatch|ReceiverMismatch|AccessKey|not allowed|permission/i.test(m);
    return { name, ok, detail: ok ? `rejected by access key: ${m.slice(0, 140)}` : `unexpected error: ${m.slice(0, 200)}` };
  }
}

async function selfCheck(): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const push = (name: string, ok: boolean, detail: string) => {
    out.push({ name, ok, detail });
    log(`  ${ok ? "✓" : "✗"} ${name}: ${detail}`);
  };

  const cfg = await net.tryView<HubConfig>(HUB, "get_config");
  push("hub get_config roles", !!cfg && cfg.owner === ROOT && cfg.coordinator === agentId(AGENTS[0]) && cfg.verifier === agentId(AGENTS[1]) && cfg.hive_token === TOKEN,
    cfg ? `owner ${cfg.owner}, coordinator ${cfg.coordinator}, verifier ${cfg.verifier}, token ${cfg.hive_token}, mint_rate ${cfg.mint_rate}` : "hub not initialized");

  const minter = await net.tryView<string>(TOKEN, "get_minter");
  push("token minter is hub (no admin mint)", minter === HUB, `minter ${minter}`);
  const meta = await net.tryView<{ symbol: string; decimals: number }>(TOKEN, "ft_metadata");
  push("token metadata", meta?.symbol === "HIVE" && meta?.decimals === 18, meta ? `${meta.symbol}, ${meta.decimals} decimals` : "missing");

  const workers = (await net.tryView<WorkerView[]>(HUB, "get_reputation")) ?? [];
  for (const a of AGENTS.filter((x) => x.role === "worker")) {
    const w = workers.find((x) => x.account_id === agentId(a));
    const pk = env(a.bidEnvKey!) ? publicKeyOf(env(a.bidEnvKey!)!) : null;
    push(`worker ${a.key} registered`, !!w && w.active && w.tier === a.tier && w.signing_pk === pk, w ? `tier ${w.tier}, pk ${w.signing_pk.slice(0, 20)}…` : "missing");
  }

  const t = await net.tryView<{ funded_total: string; spend_cap: string; available: string }>(HUB, "get_treasury");
  push("treasury funded", !!t && BigInt(t.funded_total) >= TREASURY_FUND && BigInt(t.spend_cap) === TREASURY_CAP,
    t ? `funded ${fmtNear(BigInt(t.funded_total))}, available ${fmtNear(BigInt(t.available))}, cap ${fmtNear(BigInt(t.spend_cap))}` : "missing");

  for (const a of AGENTS) {
    const secret = env(a.envKey);
    if (!secret) {
      push(`${a.key} FC key`, false, `${a.envKey} not in .env.local`);
      continue;
    }
    const k = await net.accessKey(agentId(a), publicKeyOf(secret));
    const perm = k?.permission as { FunctionCall?: { receiver_id: string; method_names: string[]; allowance: string | null } } | string | undefined;
    const fc = typeof perm === "object" ? perm.FunctionCall : undefined;
    const ok = !!fc && fc.receiver_id === HUB && [...fc.method_names].sort().join() === [...METHODS[a.role]].sort().join();
    push(`${a.key} FC key scope`, ok, fc ? `-> ${fc.receiver_id} [${fc.method_names.join(", ")}] allowance ${fc.allowance ? fmtNear(BigInt(fc.allowance)) : "unlimited"}` : `key missing or not a function-call key (${JSON.stringify(perm)})`);
  }

  // Negative checks: function-call keys cannot reach other roles' methods (rejected before execution, no gas).
  const sec = (k: string) => env(k);
  if (sec("COORDINATOR_KEY"))
    out.push(await expectAccessKeyRejection("coordinator key cannot call verify_bounty", agentId(AGENTS[0]), sec("COORDINATOR_KEY")!, "verify_bounty", { bounty_id: 0, passed: true, score: 100, check_results_hash: "0".repeat(64) }));
  if (sec("VERIFIER_KEY"))
    out.push(await expectAccessKeyRejection("verifier key cannot call select_winner", agentId(AGENTS[1]), sec("VERIFIER_KEY")!, "select_winner", { bounty_id: 0, bid_id: 0 }));
  if (sec("WORKER_CHEAP_KEY"))
    out.push(await expectAccessKeyRejection("worker key cannot call select_winner", agentId(AGENTS[2]), sec("WORKER_CHEAP_KEY")!, "select_winner", { bounty_id: 0, bid_id: 0 }));
  for (const r of out.slice(-3)) log(`  ${r.ok ? "✓" : "✗"} ${r.name}: ${r.detail}`);

  // Contract-level role check (tx lands and panics): a non-verifier account calling verify_bounty.
  try {
    const r = await net.send(ROOT!, ROOT_KEY!, HUB, [
      actions.functionCall("verify_bounty", { bounty_id: 0, passed: true, score: 100, check_results_hash: "0".repeat(64) }, teraToGas(30), 0n),
    ]);
    txs.selfCheckNotVerifier = r.txHash;
    push("owner (non-verifier) verify_bounty -> ERR_NOT_VERIFIER", !r.ok && /ERR_NOT_VERIFIER/.test(r.failure ?? ""), `tx ${txUrl(r.txHash)} ${r.ok ? "UNEXPECTEDLY SUCCEEDED" : "panicked ERR_NOT_VERIFIER"}`);
  } catch (e) {
    const m = errMsg(e);
    push("owner (non-verifier) verify_bounty -> ERR_NOT_VERIFIER", /ERR_NOT_VERIFIER/.test(m), m.slice(0, 200));
  }
  return out;
}

// ------------------------------------------------------------------ main

function writeConfig(checks: CheckResult[] | null) {
  const prev = readDeployment() as { sampleTxs?: Record<string, string>; txs?: Record<string, string> };
  const workers = Object.fromEntries(AGENTS.filter((a) => a.role === "worker").map((a) => [a.key, agentId(a)]));
  const allTxs = { ...(prev.txs ?? {}), ...txs };
  writeDeployment({
    network: "testnet",
    status: checks ? (checks.every((c) => c.ok) ? "deployed" : "deployed-selfcheck-failed") : "partial",
    rpcUrl: net.urls[0],
    fallbackRpcUrls: net.urls.slice(1),
    hub: HUB,
    token: TOKEN,
    owner: ROOT,
    coordinator: agentId(AGENTS[0]),
    verifier: agentId(AGENTS[1]),
    workers,
    explorer: "https://testnet.nearblocks.io",
    deployedAt: new Date().toISOString(),
    contracts: {
      hub: hubWasm ? { wasmBytes: hubWasm.bytes, sha256: hubWasm.sha256Hex, codeHash: hubWasm.codeHash } : null,
      token: tokenWasm ? { wasmBytes: tokenWasm.bytes, sha256: tokenWasm.sha256Hex, codeHash: tokenWasm.codeHash } : null,
    },
    params: {
      treasuryCapYocto: TREASURY_CAP.toString(),
      treasuryFundYocto: TREASURY_FUND.toString(),
      mintRate: MINT_RATE,
      agentFundYocto: AGENT_FUND.toString(),
      fcAllowanceYocto: FC_ALLOWANCE.toString(),
      agentRecoveryKey: RECOVERY === "none" ? "none" : "root",
    },
    agentMethods: METHODS,
    txs: allTxs,
    sampleTxs: {
      deploy: allTxs.deployHub ?? prev.sampleTxs?.deploy ?? "",
      verifyPass: prev.sampleTxs?.verifyPass ?? "",
      ...(allTxs.selfCheckNotVerifier ? { selfCheckNotVerifier: allTxs.selfCheckNotVerifier } : {}),
    },
    selfCheck: checks ? { at: new Date().toISOString(), passed: checks.every((c) => c.ok), results: checks } : undefined,
  });
  log(`\nwrote config/deployment.testnet.json`);
}

async function main() {
  const planOk = await printPlan();
  if (DRY) {
    log(`\nDry run complete — no transactions were sent.${planOk ? "" : " (plan has blocking issues above)"}`);
    return;
  }
  if (CHECK_ONLY) {
    log("\nself-check:");
    const checks = await selfCheck();
    writeConfig(checks);
    process.exit(checks.every((c) => c.ok) ? 0 : 2);
  }
  if (!planOk) throw new Error("pre-flight failed (see above)");

  log("\n1. contract accounts");
  await createContractAccount(HUB, HUB_FUND, "createHub");
  await createContractAccount(TOKEN, TOKEN_FUND, "createToken");

  log("2. deploy + init");
  await deployContract(TOKEN, tokenWasm!, "new", { owner_id: ROOT, minter_id: HUB }, "deployToken", () => net.tryView(TOKEN, "get_minter"));
  await deployContract(
    HUB,
    hubWasm!,
    "init",
    { owner: ROOT, hive_token_account: TOKEN, treasury_budget_yocto: TREASURY_CAP.toString(), mint_rate: MINT_RATE },
    "deployHub",
    () => net.tryView(HUB, "get_config"),
  );

  log("3. agent sub-accounts (function-call keys only for the agent processes)");
  for (const a of AGENTS) await ensureAgent(a);

  log("4. roles + workers");
  await ensureRoles();
  for (const a of AGENTS.filter((x) => x.role === "worker")) await ensureWorker(a);

  log("5. treasury");
  await ensureTreasury();

  writeConfig(null); // persist progress before the self-check

  log("\n6. self-check");
  const checks = await selfCheck();
  writeConfig(checks);
  const failed = checks.filter((c) => !c.ok);
  log(failed.length ? `\nSELF-CHECK FAILED (${failed.length}): ${failed.map((f) => f.name).join("; ")}` : "\nAll self-checks passed.");
  process.exit(failed.length ? 2 : 0);
}

main().catch((e) => {
  console.error(`\nsetup-testnet failed: ${errMsg(e)}`);
  if (Object.keys(txs).length) {
    try {
      writeConfig(null);
    } catch {
      /* ignore */
    }
  }
  process.exit(1);
});
