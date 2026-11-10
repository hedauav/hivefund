// Bid pricing. All money math is BigInt yoctoNEAR; ratios are applied in basis points so tiny budgets
// (e.g. 0.05 NEAR) never round to zero and no float ever touches an amount.
import { canonicalize } from "@hivefund/shared";
import type { BountySpec } from "@hivefund/shared";

export type Quality = "low" | "medium" | "high";

/** Relative cost of producing a deliverable at each quality level (1.0 = baseline effort). */
export const QUALITY_COST_FACTOR: Record<Quality, number> = { low: 0.8, medium: 1.0, high: 1.2 };

export const MIN_COMPLEXITY = 0.3;
export const MAX_COMPLEXITY = 0.7;
/** One hour of work at complexity 1.0 and speed 1.0. */
export const BASE_ETA_MS = 3_600_000;

const BP = 10_000n;

export function round4(x: number): number {
  return Math.round(x * 10_000) / 10_000;
}

export function toBp(x: number): bigint {
  if (!Number.isFinite(x) || x < 0) throw new RangeError(`bad ratio ${x}`);
  return BigInt(Math.round(x * 10_000));
}

/**
 * Complexity in [0.3, 0.7]: base 0.3, +0.2 if the bounty has an executable test, plus up to +0.2
 * for spec size (schema, required sections, rubric criteria).
 */
export function complexity(spec: BountySpec): number {
  let c = MIN_COMPLEXITY;
  if (spec.test) c += 0.2;
  const size =
    canonicalize(spec.deliverable_schema).length +
    spec.required_sections.length * 50 +
    spec.rubric.criteria.length * 40;
  c += Math.min(0.2, size / 5000);
  return round4(Math.min(MAX_COMPLEXITY, Math.max(MIN_COMPLEXITY, c)));
}

export interface Quote {
  /** budget * complexity, floored at minCostYocto */
  cost: bigint;
  /** what producing it costs this worker at its quality level */
  ownCost: bigint;
  /** cost * (1 + margin) */
  price: bigint;
  expectedProfit: bigint;
  etaMs: number;
  complexity: number;
}

export function quote(
  spec: BountySpec,
  budgetYocto: bigint,
  margin: number,
  quality: Quality,
  speed: number,
  minCostYocto: bigint = 0n,
): Quote {
  const cx = complexity(spec);
  let cost = (budgetYocto * toBp(cx)) / BP;
  if (cost < minCostYocto) cost = minCostYocto;
  const ownCost = (cost * toBp(QUALITY_COST_FACTOR[quality])) / BP;
  const price = (cost * toBp(1 + margin)) / BP;
  return {
    cost,
    ownCost,
    price,
    expectedProfit: price - ownCost,
    etaMs: Math.max(1, Math.round(cx * BASE_ETA_MS * speed)),
    complexity: cx,
  };
}

/** Smallest margin at which price covers own cost for this quality. */
export function breakEvenMargin(quality: Quality): number {
  return round4(QUALITY_COST_FACTOR[quality] - 1);
}
