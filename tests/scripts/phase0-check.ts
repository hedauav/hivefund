import { writeFileSync } from "node:fs";
import { canonicalize, bidPayload, signBid, verifyBid, bidPublicKey, newBidKey, mintAmount, hashJson } from "@hivefund/shared";

const input = { bounty_id: 7, contract: "hub.hivefund-demo.testnet", eta_ms: 3600000, price_yocto: "500000000000000000000000", round: 1, worker: "cheap.hivefund-demo.testnet" };
const canon = canonicalize(input);
const p = bidPayload(input);
// Simulate the Rust format! string literally:
const rust = `{"bounty_id":${7},"contract":"${"hub.hivefund-demo.testnet"}","eta_ms":${3600000},"price_yocto":"${"500000000000000000000000"}","round":${1},"worker":"${"cheap.hivefund-demo.testnet"}"}`;
if (canon !== p || p !== rust) throw new Error(`mismatch\n${canon}\n${p}\n${rust}`);
writeFileSync(new URL("../vectors/bid_payload.json", import.meta.url), JSON.stringify({ input, payload: p }, null, 2) + "\n");

const k = newBidKey(), wrong = newBidKey();
const pk = bidPublicKey(k);
const sig = signBid(p, k);
const forged = signBid(p, wrong);
const results = {
  roundTrip: verifyBid(p, sig, pk),
  forgedKey: verifyBid(p, forged, pk),
  tamperedPayload: verifyBid(p.replace("500", "400"), sig, pk),
  garbageSig: verifyBid(p, "ed25519:xyz", pk),
  mint4Hive: mintAmount("500000000000000000000000", 80, 10n ** 16n).toString(),
  mint10Hive: mintAmount("1000000000000000000000000", 100, 10n ** 16n).toString(),
  keyOrder: canonicalize({ b: 1, a: [{ d: 2, c: "x" }] }),
  hashLen: hashJson(input).length,
};
console.log(JSON.stringify({ payload: p, sigPrefix: sig.slice(0, 12), ...results }, null, 1));
if (!results.roundTrip || results.forgedKey || results.tamperedPayload || results.garbageSig) throw new Error("sig checks failed");
if (results.mint4Hive !== "4000000000000000000" || results.mint10Hive !== "10000000000000000000") throw new Error("mint math");
let threw = false; try { canonicalize({ a: 1n }); } catch { threw = true; }
if (!threw) throw new Error("bigint not rejected");
console.log("PHASE0 CHECK OK");
