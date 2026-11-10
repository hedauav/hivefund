// Mirrors the bounty-hub mint formula (docs/PLAN.md section 2, "Mint units"):
//   bid_units = price_yocto / 10^21   (milliNEAR, floor)
//   amount    = bid_units * score * mint_rate / 100

export const YOCTO_PER_MILLINEAR = 10n ** 21n;
export const YOCTO_PER_NEAR = 10n ** 24n;
export const HIVE_DECIMALS = 18;
export const DEFAULT_MINT_RATE = 10n ** 16n;

export function bidUnits(priceYocto: string | bigint): bigint {
  const p = BigInt(priceYocto);
  if (p < 0n) throw new RangeError("price must be >= 0");
  return p / YOCTO_PER_MILLINEAR;
}

export function mintAmount(priceYocto: string | bigint, score: number, mintRate: string | bigint): bigint {
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    throw new RangeError("score must be an integer 0..100");
  }
  return (bidUnits(priceYocto) * BigInt(score) * BigInt(mintRate)) / 100n;
}

/** Raw HIVE (18 decimals) to a display string, e.g. 4000000000000000000n -> "4". */
export function formatHive(raw: string | bigint, maxFrac = 4): string {
  return formatUnits(BigInt(raw), HIVE_DECIMALS, maxFrac);
}

/** yoctoNEAR to a NEAR display string, e.g. "500000000000000000000000" -> "0.5". */
export function formatNear(yocto: string | bigint, maxFrac = 4): string {
  return formatUnits(BigInt(yocto), 24, maxFrac);
}

/** Parse a NEAR decimal string ("0.5") into yoctoNEAR. */
export function parseNear(near: string): bigint {
  const [whole = "0", frac = ""] = near.trim().split(".");
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(frac) || frac.length > 24) {
    throw new Error(`bad NEAR amount: ${near}`);
  }
  return BigInt(whole || "0") * YOCTO_PER_NEAR + BigInt((frac + "0".repeat(24)).slice(0, 24));
}

function formatUnits(v: bigint, decimals: number, maxFrac: number): string {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
  return (neg ? "-" : "") + whole.toString() + (frac ? "." + frac : "");
}
