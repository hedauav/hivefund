import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

/**
 * Canonical JSON: object keys sorted recursively (default JS string sort), no whitespace.
 * Rejects values JSON can't represent faithfully: bigint, undefined, NaN/Infinity,
 * functions, symbols. Pass amounts as decimal strings, never numbers or bigints.
 */
export function canonicalize(value: unknown): string {
  return encode(value, "$");
}

function encode(v: unknown, path: string): string {
  if (v === null) return "null";
  switch (typeof v) {
    case "string":
      return JSON.stringify(v);
    case "boolean":
      return v ? "true" : "false";
    case "number":
      if (!Number.isFinite(v)) throw new TypeError(`canonicalize: non-finite number at ${path}`);
      return JSON.stringify(v);
    case "bigint":
      throw new TypeError(`canonicalize: bigint at ${path} (use a decimal string)`);
    case "undefined":
      throw new TypeError(`canonicalize: undefined at ${path}`);
    case "function":
    case "symbol":
      throw new TypeError(`canonicalize: ${typeof v} at ${path}`);
  }
  if (Array.isArray(v)) {
    return "[" + v.map((x, i) => encode(x, `${path}[${i}]`)).join(",") + "]";
  }
  const obj = v as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of Object.keys(obj).sort()) {
    const val = obj[k];
    if (val === undefined) throw new TypeError(`canonicalize: undefined at ${path}.${k}`);
    parts.push(JSON.stringify(k) + ":" + encode(val, `${path}.${k}`));
  }
  return "{" + parts.join(",") + "}";
}

/** Lowercase hex SHA-256 (64 chars) of a UTF-8 string or raw bytes. */
export function sha256Hex(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? utf8ToBytes(input) : input;
  return bytesToHex(sha256(bytes));
}

/** hashJson(v) = sha256Hex(canonicalize(v)): the content address recorded on-chain. */
export function hashJson(value: unknown): string {
  return sha256Hex(canonicalize(value));
}

/** True if s is a 64-char lowercase hex string (the on-chain hash format). */
export function isHash(s: string): boolean {
  return /^[0-9a-f]{64}$/.test(s);
}
