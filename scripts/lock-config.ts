// One-way config lock for HiveFund contracts (Lane C).
//
// Calls `lock_config()` on the given hub and/or token accounts, signed by ROOT (the owner).
// After a lock, `set_mint_rate` (hub) / `set_minter` (token) panic with ERR_CONFIG_LOCKED forever.
//
// SAFETY: dry-run by default. Nothing is sent unless you pass --confirm AND name the accounts
// explicitly. It refuses to lock a token whose minter is not the given hub, and refuses any
// account that is not under ROOT on testnet. It cannot be undone.
//
// Usage:
//   npx tsx scripts/lock-config.ts --hub hub-v2.<root>.testnet --token hive-v2.<root>.testnet            # dry run
//   npx tsx scripts/lock-config.ts --hub hub-v2.<root>.testnet --token hive-v2.<root>.testnet --confirm  # sends
//
// Lock the token only after its minter is the final hub (the minter can never change again).
import { actions, teraToGas } from "near-api-js";
import { Net, env, errMsg, txUrl } from "./near-ops.ts";

const argv = process.argv.slice(2);
const CONFIRM = argv.includes("--confirm");
const arg = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const HUB = arg("--hub");
const TOKEN = arg("--token");

const ROOT = env("ROOT_ACCOUNT");
const ROOT_KEY = env("ROOT_PRIVATE_KEY");
if (!HUB && !TOKEN) {
  console.error("Name the accounts explicitly: --hub <account> and/or --token <account>. Nothing was sent.");
  process.exit(1);
}
if (!ROOT || !ROOT.endsWith(".testnet")) {
  console.error("ROOT_ACCOUNT (testnet) missing in .env.local. Nothing was sent.");
  process.exit(1);
}
for (const id of [HUB, TOKEN].filter(Boolean) as string[]) {
  if (!id.endsWith(`.${ROOT}`)) {
    console.error(`Refusing: ${id} is not a sub-account of ${ROOT}. Nothing was sent.`);
    process.exit(1);
  }
}

const net = new Net();
const log = (s: string) => console.log(s);

async function locked(id: string): Promise<boolean | null> {
  try {
    return await net.view<boolean>(id, "is_config_locked");
  } catch (e) {
    log(`  ! ${id}: is_config_locked unavailable (${errMsg(e).slice(0, 120)}) — contract predates lock_config?`);
    return null;
  }
}

async function main() {
  log(`HiveFund lock_config — ${CONFIRM ? "LIVE (--confirm)" : "DRY RUN (add --confirm to send)"}`);
  const targets: { id: string; kind: "hub" | "token" }[] = [];
  if (HUB) targets.push({ id: HUB, kind: "hub" });
  if (TOKEN) targets.push({ id: TOKEN, kind: "token" });

  for (const t of targets) {
    const state = await locked(t.id);
    if (state === null) {
      log(`  x ${t.id}: cannot lock (no lock_config on this code). Skipping.`);
      continue;
    }
    if (t.kind === "hub") {
      const cfg = await net.view<{ owner: string; mint_rate: string; hive_token: string }>(t.id, "get_config");
      log(`  ${t.id}: owner ${cfg.owner}, mint_rate ${cfg.mint_rate}, hive_token ${cfg.hive_token}, locked ${state}`);
      if (cfg.owner !== ROOT) {
        log(`  x ${t.id}: owner is ${cfg.owner}, not ${ROOT}. Skipping.`);
        continue;
      }
    } else {
      const minter = await net.view<string>(t.id, "get_minter");
      const owner = await net.view<string>(t.id, "get_owner");
      log(`  ${t.id}: owner ${owner}, minter ${minter}, locked ${state}`);
      if (owner !== ROOT) {
        log(`  x ${t.id}: owner is ${owner}, not ${ROOT}. Skipping.`);
        continue;
      }
      if (HUB && minter !== HUB) {
        log(`  x ${t.id}: minter is ${minter}, not ${HUB}. Fix the minter first; locking would freeze the wrong minter. Skipping.`);
        continue;
      }
    }
    if (state) {
      log(`  = ${t.id}: already locked`);
      continue;
    }
    if (!CONFIRM) {
      log(`  ~ would call ${t.id}.lock_config() signed by ${ROOT} (irreversible)`);
      continue;
    }
    if (!ROOT_KEY) {
      log(`  x ROOT_PRIVATE_KEY missing in .env.local`);
      process.exit(1);
    }
    const r = await net.send(ROOT, ROOT_KEY, t.id, [actions.functionCall("lock_config", {}, teraToGas(30), 0n)]);
    log(`  ${r.ok ? "+" : "x"} ${t.id}.lock_config ${r.ok ? "ok" : `FAILED: ${r.failure}`}  ${txUrl(r.txHash)}`);
    if (r.ok) log(`    is_config_locked -> ${await locked(t.id)}`);
  }
}

main().catch((e) => {
  console.error(errMsg(e));
  process.exit(1);
});
