// Worker strategies. Static workers (cheap, quality) never change. The adaptive worker keeps a
// sliding window of its last 5 outcomes and adjusts margin/quality; every change is returned as a
// StrategyChange (with a human-readable reason) so the worker can append it to the off-chain log.
import type { Outcome, StrategyChange } from "@hivefund/shared";
import { breakEvenMargin, round4, type Quality } from "./pricing.ts";

export interface Strategy {
  readonly kind: "static" | "adaptive";
  margin: number;
  quality: Quality;
  /** last outcomes, oldest first (max 5 for adaptive) */
  readonly window: Outcome[];
  onOutcome(outcome: Outcome, bountyId: number): StrategyChange[];
  /** Called when a quote is unprofitable. May raise the margin; returns the change, or null to just skip. */
  onUnprofitable(bountyId: number): StrategyChange | null;
}

export class StaticStrategy implements Strategy {
  readonly kind = "static" as const;
  readonly window: Outcome[] = [];
  constructor(
    public margin: number,
    public quality: Quality,
  ) {}
  onOutcome(outcome: Outcome): StrategyChange[] {
    this.window.push(outcome);
    if (this.window.length > 5) this.window.shift();
    return [];
  }
  onUnprofitable(): StrategyChange | null {
    return null;
  }
}

export interface AdaptiveOptions {
  worker: string;
  initialMargin: number;
  minMargin: number;
  maxMargin: number;
  initialQuality: Quality;
  windowSize?: number;
  now?: () => number;
}

const QUALITY_UP: Record<Quality, Quality> = { low: "medium", medium: "high", high: "high" };

export class AdaptiveStrategy implements Strategy {
  readonly kind = "adaptive" as const;
  margin: number;
  quality: Quality;
  readonly window: Outcome[] = [];
  readonly minMargin: number;
  readonly maxMargin: number;
  private readonly size: number;
  private readonly now: () => number;
  private readonly worker: string;

  constructor(o: AdaptiveOptions) {
    if (o.minMargin > o.maxMargin) throw new RangeError("minMargin > maxMargin");
    this.worker = o.worker;
    this.minMargin = o.minMargin;
    this.maxMargin = o.maxMargin;
    this.margin = this.clamp(o.initialMargin);
    this.quality = o.initialQuality;
    this.size = o.windowSize ?? 5;
    this.now = o.now ?? Date.now;
  }

  private clamp(m: number): number {
    return round4(Math.min(this.maxMargin, Math.max(this.minMargin, m)));
  }

  private summary(): string {
    const c = { win: 0, loss: 0, fail: 0 };
    for (const o of this.window) c[o]++;
    return `last ${this.window.length}: ${c.win}W/${c.loss}L/${c.fail}F`;
  }

  private change(bountyId: number, oldMargin: number, reason: string): StrategyChange {
    return {
      ts_ms: this.now(),
      worker: this.worker,
      bounty_id: bountyId,
      old_margin: oldMargin,
      new_margin: this.margin,
      reason,
      window: [...this.window],
    };
  }

  onOutcome(outcome: Outcome, bountyId: number): StrategyChange[] {
    this.window.push(outcome);
    if (this.window.length > this.size) this.window.shift();
    const wins = this.window.filter((o) => o === "win").length;
    const losses = this.window.filter((o) => o === "loss").length;
    const changes: StrategyChange[] = [];
    const old = this.margin;

    if (outcome === "win") {
      // Winning streaks mean we are underpricing: raise faster.
      const step = wins >= 3 ? 0.07 : 0.05;
      this.margin = this.clamp(old + step);
      if (this.margin !== old) {
        changes.push(
          this.change(bountyId, old, `won bounty #${bountyId} (${this.summary()}): raising margin +${step} to capture more value`),
        );
      }
    } else if (outcome === "loss") {
      // Losing streaks mean we are overpriced: cut faster.
      const step = losses >= 3 ? 0.06 : 0.04;
      this.margin = this.clamp(old - step);
      if (this.margin !== old) {
        changes.push(
          this.change(bountyId, old, `lost bounty #${bountyId} to a better-scored bid (${this.summary()}): lowering margin -${step}`),
        );
      }
    } else {
      // Verification failed: the deliverable was not good enough; spend more effort next time.
      const oldQ = this.quality;
      this.quality = QUALITY_UP[oldQ];
      if (this.quality !== oldQ) {
        changes.push(
          this.change(bountyId, old, `deliverable for bounty #${bountyId} failed verification (${this.summary()}): raising quality ${oldQ} -> ${this.quality}`),
        );
      }
    }
    return changes;
  }

  onUnprofitable(bountyId: number): StrategyChange | null {
    const old = this.margin;
    const target = this.clamp(breakEvenMargin(this.quality) + 0.05);
    if (target <= old) return null;
    this.margin = target;
    return this.change(
      bountyId,
      old,
      `margin ${old} is below break-even for ${this.quality} quality on bounty #${bountyId}: raising to ${target}`,
    );
  }
}
