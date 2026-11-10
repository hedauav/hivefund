// Coordinator selection formula (docs/PLAN.md §5), isomorphic so the web can recompute it:
//   score = w.price·(1 − price/budget) + w.eta·(1 − eta/max_eta) + w.reputation·(rep/max_rep)
// Ties go to the lower price, then the earlier bid id. Only bids with valid signatures are candidates.
//
// Cold start: a worker with no completed or failed bounties has no reputation yet. Scoring it as 0 would lock new
// workers out forever once others have history (they can never win, so never earn reputation). Such a worker is
// scored with a neutral prior instead: COLD_START_PRIOR × the highest reputation among bidders WITH history.
// The candidate records reputation_source "cold_start_prior". Workers with history are scored on their real
// reputation, including 0 or less after failures, so the prior never rewards a bad track record.
import type { SelectionCandidate, SelectionWeights } from "./types.ts";
import { DEFAULT_SELECTION_WEIGHTS } from "./types.ts";

export interface BidForScoring {
  bid_id: number;
  worker: string;
  price_yocto: string;
  eta_ms: number;
  reputation: number;
  /** completed + failed bounties on-chain; 0 => cold-start prior applies. Omit when unknown (treated as history). */
  history?: number;
  sig_valid: boolean;
}

/** Fraction of the best proven reputation given to a worker with no history (neutral midpoint). */
export const COLD_START_PRIOR = 0.5;

/** Score every bid (invalid signatures get score 0) and return candidates sorted best-first. */
export function scoreBids(
  bids: BidForScoring[],
  budgetYocto: string,
  weights: SelectionWeights = DEFAULT_SELECTION_WEIGHTS,
): SelectionCandidate[] {
  const budget = Number(BigInt(budgetYocto)) || 1;
  const valid = bids.filter((b) => b.sig_valid);
  const maxEta = Math.max(1, ...valid.map((b) => b.eta_ms));
  const provenMax = Math.max(0, ...valid.filter((b) => b.history !== 0).map((b) => b.reputation));
  const effective = (b: BidForScoring) =>
    b.history === 0 ? Math.round(COLD_START_PRIOR * provenMax * 1e6) / 1e6 : b.reputation;
  const maxRep = Math.max(0, ...valid.map(effective));
  const out = bids.map((b): SelectionCandidate => {
    let score = 0;
    const reputation = effective(b);
    if (b.sig_valid) {
      const priceTerm = 1 - Number(BigInt(b.price_yocto)) / budget;
      const etaTerm = 1 - b.eta_ms / maxEta;
      const repTerm = maxRep > 0 ? reputation / maxRep : 0;
      score = weights.price * priceTerm + weights.eta * etaTerm + weights.reputation * repTerm;
      score = Math.round(score * 1e6) / 1e6;
    }
    const { history, ...rest } = b;
    return {
      ...rest,
      reputation,
      ...(history !== undefined ? { reputation_source: history === 0 ? ("cold_start_prior" as const) : ("history" as const) } : {}),
      score,
    };
  });
  return out.sort((a, b) => {
    if (a.sig_valid !== b.sig_valid) return a.sig_valid ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    const pa = BigInt(a.price_yocto);
    const pb = BigInt(b.price_yocto);
    if (pa !== pb) return pa < pb ? -1 : 1;
    return a.bid_id - b.bid_id;
  });
}
