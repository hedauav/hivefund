// Add testnet funds later without re-running the whole setup (Stream A). Root signs everything.
//
//   npx tsx scripts/topup.ts fund <account|agent-name> <NEAR>   # transfer NEAR (gas balance / contract storage)
//   npx tsx scripts/topup.ts treasury <NEAR>                    # hub.fund_treasury with a deposit
//   npx tsx scripts/topup.ts rekey <agent-name> [allowanceNEAR] # fresh function-call key (new allowance);
//                                                               # needs the root recovery key on the agent
//   npx tsx scripts/topup.ts status                             # balances, FC allowances, treasury
//   add --dry-run to any command to print what would be sent.
//
// Agent names: coordinator, verifier, cheap, quality, adaptive, forger. Bare names expand to <name>.<ROOT>.
import { PublicKey, actions, teraToGas } from "near-api-js";
import {
  Net,
  env,
  errMsg,
  fmtNear,
  nearToYoctoExact,
  newKey,
  publicKeyOf,
  txUrl,
  upsertEnv,
} from "./near-ops.ts";

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry-run");
const [cmd, a1, a2] = argv.filter((x) => x !== "--dry-run");

const ROOT = env("ROOT_ACCOUNT");
const ROOT_KEY = env("ROOT_PRIVATE_KEY");
if (!ROOT || !ROOT_KEY || !ROOT.endsWith(".testnet")) {
  console.error("ROOT_ACCOUNT / ROOT_PRIVATE_KEY (testnet) missing in .env.local");
  process.exit(1);
}
const HUB = `${env("HUB_PREFIX", "hub")}.${ROOT}`;
const AGENT_ENV: Record<string, { envKey: string; methods: string[] }> = {
  coordinator: { envKey: "COORDINATOR_KEY", methods: ["post_bounty", "select_winner", "reject_bid", "cancel_bounty"] },
  verifier: { envKey: "VERIFIER_KEY", methods: ["verify_bounty"] },
  cheap: { envKey: "WORKER_CHEAP_KEY", methods: ["place_bid", "submit_work"] },
  quality: { envKey: "WORKER_QUALITY_KEY", methods: ["place_bid", "submit_work"] },
  adaptive: { envKey: "WORKER_ADAPTIVE_KEY", methods: ["place_bid", "submit_work"] },
  forger: { envKey: "WORKER_FORGER_KEY", methods: ["place_bid", "submit_work"] },
};
const expand = (x: string) => (x.includes(".") ? x : `${x}.${ROOT}`);
const net = new Net();

async function send(label: string, signer: string, receiver: string, acts: Parameters<Net["send"]>[3]) {
  if (DRY) {
    console.log(`[dry-run] ${label}: ${signer} -> ${receiver}`);
    return;
  }
  const r = await net.send(signer, ROOT_KEY!, receiver, acts);
  if (!r.ok) throw new Error(`${label} failed (${txUrl(r.txHash)}): ${r.failure}`);
  console.log(`${label}: ${txUrl(r.txHash)}`);
}

async function status() {
  const root = await net.viewAccount(ROOT!);
  console.log(`root ${ROOT}: ${root ? fmtNear(BigInt(root.amount)) : "missing"}`);
  for (const id of [HUB, `${env("TOKEN_PREFIX", "hive")}.${ROOT}`]) {
    const v = await net.viewAccount(id);
    console.log(`${id}: ${v ? `${fmtNear(BigInt(v.amount))}, storage ${v.storage_usage} B` : "missing"}`);
  }
  for (const [name, spec] of Object.entries(AGENT_ENV)) {
    const id = expand(name);
    const v = await net.viewAccount(id);
    const secret = env(spec.envKey);
    let allowance = "no local key";
    if (v && secret) {
      const k = await net.accessKey(id, publicKeyOf(secret));
      const fc = typeof k?.permission === "object" ? (k.permission as { FunctionCall?: { allowance: string | null } }).FunctionCall : undefined;
      allowance = !k ? "key not on chain" : fc ? (fc.allowance ? `allowance ${fmtNear(BigInt(fc.allowance))}` : "unlimited allowance") : "full access";
    }
    console.log(`${id}: ${v ? fmtNear(BigInt(v.amount)) : "missing"}, ${allowance}`);
  }
  const t = await net.tryView<Record<string, string>>(HUB, "get_treasury");
  if (t) console.log(`treasury: available ${fmtNear(BigInt(t.available))}, escrowed ${fmtNear(BigInt(t.escrowed))}, paid ${fmtNear(BigInt(t.paid_out))}, cap ${fmtNear(BigInt(t.spend_cap))}`);
}

async function main() {
  switch (cmd) {
    case "fund": {
      if (!a1 || !a2) throw new Error("usage: fund <account|agent> <NEAR>");
      const id = expand(a1);
      if (!(await net.viewAccount(id))) throw new Error(`${id} does not exist`);
      await send(`transfer ${a2} NEAR to ${id}`, ROOT!, id, [actions.transfer(nearToYoctoExact(a2))]);
      break;
    }
    case "treasury": {
      if (!a1) throw new Error("usage: treasury <NEAR>");
      await send(`fund_treasury ${a1} NEAR`, ROOT!, HUB, [actions.functionCall("fund_treasury", {}, teraToGas(30), nearToYoctoExact(a1))]);
      break;
    }
    case "rekey": {
      const spec = AGENT_ENV[a1 ?? ""];
      if (!spec) throw new Error(`usage: rekey <${Object.keys(AGENT_ENV).join("|")}> [allowanceNEAR]`);
      const id = expand(a1!);
      const rootPk = publicKeyOf(ROOT_KEY!);
      if (!(await net.accessKey(id, rootPk))) throw new Error(`${id} has no root recovery key; cannot add keys (AGENT_RECOVERY_KEY=none at setup)`);
      const allowance = nearToYoctoExact(a2 ?? env("FC_ALLOWANCE_NEAR", "0.05")!);
      const fresh = newKey();
      const old = env(spec.envKey);
      const acts = [actions.addFunctionCallAccessKey(fresh.getPublicKey(), HUB, spec.methods, allowance)];
      if (old && (await net.accessKey(id, publicKeyOf(old)))) acts.push(actions.deleteKey(PublicKey.fromString(publicKeyOf(old))));
      if (DRY) {
        console.log(`[dry-run] rekey ${id}: add FC key (${fmtNear(allowance)}) ${acts.length > 1 ? "and delete old key" : ""}`);
        break;
      }
      // Agent account signs with the root recovery key (receiver = itself).
      const r = await net.send(id, ROOT_KEY!, id, acts);
      if (!r.ok) throw new Error(`rekey failed (${txUrl(r.txHash)}): ${r.failure}`);
      upsertEnv({ [spec.envKey]: fresh.toString() });
      console.log(`rekey ${id}: ${txUrl(r.txHash)} (new key saved to .env.local ${spec.envKey})`);
      break;
    }
    case "status":
      await status();
      break;
    default:
      console.log("usage: tsx scripts/topup.ts <fund|treasury|rekey|status> ... [--dry-run]");
      process.exit(cmd ? 1 : 0);
  }
}

main().catch((e) => {
  console.error(errMsg(e));
  process.exit(1);
});
