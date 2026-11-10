// Live read-only smoke test of NearHubClient against public testnet (no keys, no state changes).
import { NearHubClient } from "@hivefund/shared/node";
const t0 = Date.now();
const lap = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
const c = new NearHubClient({ accountId: "anon.testnet", contractId: "guestbook.near-examples.testnet", retries: 1 });
try {
  const msgs = await c.view<unknown[]>("get_messages", { from_index: "0", limit: "2" });
  lap(`view ok, messages: ${Array.isArray(msgs) ? msgs.length : JSON.stringify(msgs)}`);
} catch (e) { lap(`view error: ${(e as Error).message.slice(0, 300)}`); }
const none = new NearHubClient({ accountId: "anon.testnet", contractId: "hivefund-2026.testnet", retries: 1 });
try { await none.view("get_config"); lap("unexpected success"); } catch (e) { lap(`expected error: ${(e as Error).message.slice(0, 200)}`); }
try { await c.call("add_message", { text: "x" }); } catch (e) { lap(`no-key call refused: ${(e as Error).message}`); }
