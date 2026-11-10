// Coordinator selection formula (docs/PLAN.md §5), isomorphic so the web can recompute it:
//   score = w.price·(1 − price/budget) + w.eta·(1 − eta/max_eta) + w.reputation·(rep/max_rep)
// Ties go to the lower price, then the earlier bid id. Only bids with valid signatures are candidates.
import type { SelectionCandidate, SelectionWeights } from "./types.ts";
import { DEFAULT_SELECTION_WEIGHTS } from "./types.ts";

export interface BidForScoring {
  bid_id: number;
  worker: string;
  price_yocto: string;
  eta_ms: number;
  reputation: number;
  sig_valid: boolean;
}

/** Score every bid (invalid signatures get score 0) and return candidates sorted best-first. */
export function scoreBids(
  bids: BidForScoring[],
  budgetYocto: string,
  weights: SelectionWeights = DEFAULT_SELECTION_WEIGHTS,
): SelectionCandidate[] {
  const budget = Number(BigInt(budgetYocto)) || 1;
  const valid = bids.filter((b) => b.sig_valid);
  const maxEta = Math.max(1, ...valid.map((b) => b.eta_ms));
  const maxRep = Math.max(0, ...valid.map((b) => b.reputation));
  const out = bids.map((b): SelectionCandidate => {
    let score = 0;
    if (b.sig_valid) {
      const priceTerm = 1 - Number(BigInt(b.price_yocto)) / budget;
      const etaTerm = 1 - b.eta_ms / maxEta;
      const repTerm = maxRep > 0 ? b.reputation / maxRep : 0;
      score = weights.price * priceTerm + weights.eta * etaTerm + weights.reputation * repTerm;
      score = Math.round(score * 1e6) / 1e6;
    }
    return { ...b, score };
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
