import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  bidPayload,
  bidPublicKey,
  bidUnits,
  canonicalize,
  formatHive,
  hashJson,
  mintAmount,
  newBidKey,
  parseNear,
  scoreBids,
  sha256Hex,
  signBid,
  validateSpec,
  verifyBid,
  type BountySpec,
} from "@hivefund/shared";
import { OffchainStore, extractErrCode, parseDotenv, isTransient } from "@hivefund/shared/node";

const vector = JSON.parse(fs.readFileSync(new URL("../vectors/bid_payload.json", import.meta.url), "utf8")) as {
  input: Parameters<typeof bidPayload>[0];
  payload: string;
};

test("golden vector: bidPayload and canonicalize both equal the Rust format! string", () => {
  assert.equal(bidPayload(vector.input), vector.payload);
  assert.equal(canonicalize(vector.input), vector.payload);
});

test("bid signatures: round-trip verifies; forged key, tampered payload, garbage all fail", () => {
  const key = newBidKey();
  const pk = bidPublicKey(key);
  const sig = signBid(vector.payload, key);
  assert.match(sig, /^ed25519:[1-9A-HJ-NP-Za-km-z]+$/);
  assert.equal(verifyBid(vector.payload, sig, pk), true);
  assert.equal(verifyBid(vector.payload, signBid(vector.payload, newBidKey()), pk), false, "forged key");
  assert.equal(verifyBid(vector.payload.replace('"round":1', '"round":2'), sig, pk), false, "tampered");
  assert.equal(verifyBid(vector.payload, "ed25519:abc", pk), false, "garbage");
  assert.equal(verifyBid(vector.payload, sig, "ed25519:notakey"), false, "bad pk never throws");
});

test("mint math matches the contract formula with the demo budgets", () => {
  // 0.08 NEAR winning bid at score 80, mint_rate 1e16: 80 units × 80 / 100 × 1e16 = 0.64 HIVE
  assert.equal(bidUnits(parseNear("0.08")), 80n);
  assert.equal(mintAmount(parseNear("0.08"), 80, 10n ** 16n), 640000000000000000n);
  assert.equal(formatHive(640000000000000000n), "0.64");
  // 0.05 NEAR budget fully used at score 100 -> 0.5 HIVE
  assert.equal(mintAmount(parseNear("0.05"), 100, 10n ** 16n), 500000000000000000n);
  // sub-milliNEAR prices floor to 0 units -> nothing minted
  assert.equal(mintAmount("999999999999999999999", 100, 10n ** 16n), 0n);
  assert.throws(() => mintAmount("1", 101, 1n));
});

test("canonicalize sorts keys recursively and rejects non-JSON values", () => {
  assert.equal(canonicalize({ b: 1, a: [{ d: 2, c: "x" }] }), '{"a":[{"c":"x","d":2}],"b":1}');
  assert.throws(() => canonicalize({ a: 1n }));
  assert.throws(() => canonicalize({ a: undefined }));
  assert.throws(() => canonicalize({ a: NaN }));
  assert.equal(hashJson({ b: 1, a: 2 }), sha256Hex('{"a":2,"b":1}'));
});

test("OffchainStore: put/get round-trip, idempotent, and tampered files are detected", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hivefund-store-"));
  try {
    const store = new OffchainStore(dir);
    const obj = { z: 1, a: { y: "two" } };
    const h = store.put(obj, { kind: "spec", actor: "tester" });
    assert.equal(h, hashJson(obj));
    assert.equal(store.put(obj, { kind: "spec", actor: "tester" }), h);
    assert.deepEqual(store.get(h), obj);
    assert.equal(store.readIndex().length, 1, "idempotent put writes one index entry");
    // the file on disk is exactly the canonical JSON
    assert.equal(fs.readFileSync(path.join(dir, "offchain", `${h}.json`), "utf8"), canonicalize(obj));
    fs.writeFileSync(path.join(dir, "offchain", `${h}.json`), '{"z":2}');
    assert.throws(() => store.get(h), /hash mismatch/);
    assert.throws(() => store.get("0".repeat(64)), /not found/);
    store.appendStrategy("adaptive.x.testnet", {
      ts_ms: 1, worker: "adaptive.x.testnet", bounty_id: 0, old_margin: 0.2, new_margin: 0.25, reason: "won", window: ["win"],
    });
    assert.equal(store.readStrategy("adaptive.x.testnet")[0].new_margin, 0.25);
    store.appendTx({ ts: 1, actor: "a", method: "m", args: {}, txHash: "h" });
    assert.equal(store.readTx().length, 1);
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "hivefund-export-"));
    store.exportSnapshot(out);
    assert.ok(fs.existsSync(path.join(out, "offchain")) && fs.existsSync(path.join(out, "tx.jsonl")));
    fs.rmSync(out, { recursive: true, force: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("bounty fixtures in /bounties are valid specs", () => {
  const dir = new URL("../../bounties/", import.meta.url);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 2);
  for (const f of files) {
    const spec = JSON.parse(fs.readFileSync(new URL(f, dir), "utf8")) as BountySpec;
    assert.deepEqual(validateSpec(spec), [], f);
  }
});

test("selection formula: price 0.5, eta 0.2, reputation 0.3; invalid signatures never win", () => {
  const budget = parseNear("0.1").toString();
  const c = scoreBids(
    [
      { bid_id: 1, worker: "cheap", price_yocto: parseNear("0.06").toString(), eta_ms: 4000, reputation: 0, sig_valid: true },
      { bid_id: 2, worker: "quality", price_yocto: parseNear("0.08").toString(), eta_ms: 1000, reputation: 30, sig_valid: true },
      { bid_id: 3, worker: "forger", price_yocto: parseNear("0.01").toString(), eta_ms: 100, reputation: 0, sig_valid: false },
    ],
    budget,
  );
  // cheap: 0.5·0.4 + 0.2·0 + 0 = 0.2 ; quality: 0.5·0.2 + 0.2·0.75 + 0.3·1 = 0.55
  assert.equal(c[0].worker, "quality");
  assert.equal(c[0].score, 0.55);
  assert.equal(c.find((x) => x.worker === "cheap")!.score, 0.2);
  assert.equal(c.at(-1)!.worker, "forger");
  assert.equal(c.at(-1)!.score, 0);
});

test("helpers: ERR code extraction, dotenv parsing, transient error classification", () => {
  assert.equal(extractErrCode("Smart contract panicked: ERR_NOT_VERIFIER: x"), "ERR_NOT_VERIFIER");
  assert.equal(extractErrCode("no code"), null);
  assert.deepEqual(parseDotenv("A=1\n# c\nB='two'\n\nC=\"3=3\""), { A: "1", B: "two", C: "3=3" });
  assert.equal(isTransient(new Error("fetch failed")), true);
  assert.equal(isTransient(new Error("Smart contract panicked: ERR_BAD_STATUS")), false);
  assert.equal(isTransient(new Error("InvalidNonce: tx nonce 5 must be larger")), true);
});

test("agent gas caps fit the 0.05 NEAR function-call allowance; tx log carries returned ids", async () => {
  const { gasFor, withResultIds } = await import("@hivefund/shared/node");
  assert.equal(gasFor("place_bid"), 30);
  assert.equal(gasFor("verify_bounty", 100), 60, "callers asking for more are clamped");
  assert.equal(gasFor("select_winner", 20), 20);
  assert.equal(gasFor("fund_treasury"), 30);
  assert.deepEqual(withResultIds("post_bounty", { title: "t" }, 4), { title: "t", bounty_id: 4 });
  assert.deepEqual(withResultIds("place_bid", { bounty_id: 4 }, "7"), { bounty_id: 4, bid_id: 7 });
  assert.deepEqual(withResultIds("submit_work", { bounty_id: 4 }, null), { bounty_id: 4 });
});
