// Read-only: print the live testnet chain state of the deployed hub (no keys, no transactions).
import { NearHubClient, loadDeployment, readChainState } from "@hivefund/shared/node";
const dep = loadDeployment();
if (!dep) throw new Error("no config/deployment.testnet.json");
const hub = new NearHubClient({ accountId: dep.owner, contractId: dep.hub, rpcUrl: dep.rpcUrl });
const token = new NearHubClient({ accountId: dep.owner, contractId: dep.token, rpcUrl: dep.rpcUrl });
const s = await readChainState(hub, token, "testnet");
console.log(JSON.stringify({ config: s.config, treasury: s.treasury, bounties: s.bounties.length, workers: s.reputation.map((w) => [w.account_id, w.tier, w.signing_pk.slice(0, 14)]), activity: s.activity.length, token: s.token_state }, null, 1));
