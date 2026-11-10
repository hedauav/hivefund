// Runs the e2e suite against NEAR testnet (cross-platform way to set HIVEFUND_E2E_TESTNET=1).
import { spawnSync } from "node:child_process";
const r = spawnSync(process.execPath, ["--import", "tsx", "--test", "e2e/**/*.test.ts"], {
  stdio: "inherit",
  env: { ...process.env, HIVEFUND_E2E_TESTNET: "1", HIVEFUND_MODE: "testnet" },
});
process.exit(r.status ?? 1);
