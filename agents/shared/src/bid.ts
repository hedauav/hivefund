import { KeyPair, PublicKey, baseDecode, baseEncode } from "near-api-js";
import type { KeyPairString } from "near-api-js";

export interface BidPayloadInput {
  bounty_id: number;
  contract: string;
  eta_ms: number;
  /** decimal string (U128) */
  price_yocto: string;
  round: number;
  worker: string;
}

/**
 * Canonical bid payload. Must byte-match the Rust contract:
 *   format!(r#"{{"bounty_id":{},"contract":"{}","eta_ms":{},"price_yocto":"{}","round":{},"worker":"{}"}}"#,
 *           bounty_id, contract, eta_ms, price_yocto, round, worker)
 * Keys are in alphabetical order (identical to canonicalize()). Account ids contain only
 * [a-z0-9._-], so no JSON escaping is ever needed; we still validate inputs to guarantee it.
 */
export function bidPayload(i: BidPayloadInput): string {
  assertUint(i.bounty_id, "bounty_id");
  assertUint(i.eta_ms, "eta_ms");
  assertUint(i.round, "round");
  if (!/^\d+$/.test(i.price_yocto)) throw new TypeError("price_yocto must be a decimal string");
  assertAccount(i.contract, "contract");
  assertAccount(i.worker, "worker");
  return (
    `{"bounty_id":${i.bounty_id},"contract":"${i.contract}","eta_ms":${i.eta_ms},` +
    `"price_yocto":"${BigInt(i.price_yocto).toString()}","round":${i.round},"worker":"${i.worker}"}`
  );
}

/** Sign a payload with an ed25519 bid key ("ed25519:<base58 secret>"). Returns "ed25519:<base58 signature>". */
export function signBid(payload: string, bidKey: string): string {
  const kp = KeyPair.fromString(bidKey as KeyPairString);
  const { signature } = kp.sign(new TextEncoder().encode(payload));
  return "ed25519:" + baseEncode(signature);
}

/** Verify a bid signature against a registered signing public key ("ed25519:<base58>"). Never throws. */
export function verifyBid(payload: string, signature: string, signingPk: string): boolean {
  try {
    if (!signature.startsWith("ed25519:")) return false;
    const sig = baseDecode(signature.slice("ed25519:".length));
    if (sig.length !== 64) return false;
    const pk = PublicKey.fromString(signingPk);
    return pk.verify(new TextEncoder().encode(payload), sig);
  } catch {
    return false;
  }
}

/** Public key string ("ed25519:<base58>") of a bid key, for add_worker(signing_pk). */
export function bidPublicKey(bidKey: string): string {
  return KeyPair.fromString(bidKey as KeyPairString).getPublicKey().toString();
}

/** Generate a fresh ed25519 bid-signing key ("ed25519:<base58 secret>"). */
export function newBidKey(): string {
  return KeyPair.fromRandom("ed25519").toString();
}

function assertUint(n: number, name: string): void {
  if (!Number.isSafeInteger(n) || n < 0) throw new TypeError(`${name} must be a non-negative safe integer`);
}

function assertAccount(s: string, name: string): void {
  if (!/^[a-z0-9._-]{2,64}$/.test(s)) throw new TypeError(`${name} is not a valid NEAR account id: ${s}`);
}
