// TS mirrors of the bounty-hub Rust types (docs/PLAN.md section 2) and off-chain shapes (section 4).
// Amounts (U128) are decimal strings. Enums are string unions identical to Rust variant names.

export type AccountId = string;
/** u128 serialized as a decimal string (near_sdk::json_types::U128). */
export type U128 = string;

export type BountyStatus =
  | "Open"
  | "Bidding"
  | "InProgress"
  | "Verifying"
  | "Completed"
  | "Disputed"
  | "Cancelled";

export type BidStatus = "Pending" | "Rejected" | "Won" | "Lost" | "Superseded" | "Failed" | "Paid";

export type ActivityKind =
  | "TreasuryFunded"
  | "RoleChanged"
  | "WorkerAdded"
  | "WorkerRemoved"
  | "BountyPosted"
  | "BidPlaced"
  | "BidRejected"
  | "WinnerSelected"
  | "WorkSubmitted"
  | "VerificationPassed"
  | "VerificationFailed"
  | "Payout"
  | "Mint"
  | "MintFailed"
  | "BountyReopened"
  | "BountyCancelled"
  | "TreasuryRefund"
  | "DisputeOpened"
  | "DisputeResolved";

/** Exact place_bid business-rule rejection reasons (stored as Rejected bids, not panics). */
export type BidRejectReason =
  | "bounty closed"
  | "deadline passed"
  | "price exceeds budget"
  | "tier below min_tier"
  | "worker excluded"
  | "duplicate bid this round";

export const BID_REJECT_REASONS: readonly BidRejectReason[] = [
  "bounty closed",
  "deadline passed",
  "price exceeds budget",
  "tier below min_tier",
  "worker excluded",
  "duplicate bid this round",
];

/** Coordinator's reject_bid reason for a forged/invalid bid signature. */
export const INVALID_SIGNATURE_REASON = "invalid bid signature";

export interface Bounty {
  id: number;
  title: string;
  spec_hash: string;
  poster: AccountId;
  budget_yocto: U128;
  deadline_ms: number;
  min_tier: number;
  status: BountyStatus;
  /** == number of failed verifications so far (0, 1); bids carry the round. */
  round: number;
  /** Failed verifications; 2 => Cancelled. */
  attempts: number;
  bid_ids: number[];
  winner_bid_id: number | null;
  deliverable_hash: string | null;
  check_results_hash: string | null;
  score: number | null;
  excluded: AccountId[];
  created_ms: number;
  updated_ms: number;
  hive_minted: U128;
}

export interface Bid {
  id: number;
  bounty_id: number;
  round: number;
  worker: AccountId;
  tier: number;
  price_yocto: U128;
  eta_ms: number;
  signature: string;
  signed_payload: string;
  status: BidStatus;
  reject_reason: string | null;
  created_ms: number;
}

export interface WorkerInfo {
  account_id: AccountId;
  tier: number;
  signing_pk: string;
  active: boolean;
  completed: number;
  failed: number;
  total_score: number;
  earned_yocto: U128;
  hive_earned: U128;
}

/** get_reputation row: WorkerInfo + reputation = max(0, completed*10 + total_score/10 - failed*15). */
export interface WorkerView extends WorkerInfo {
  reputation: number;
}

export interface ActivityEntry {
  id: number;
  ts_ms: number;
  block_height: number;
  actor: AccountId;
  kind: ActivityKind;
  bounty_id: number | null;
  bid_id: number | null;
  amount: U128 | null;
  /** <= 200 chars, human readable */
  detail: string;
}

export interface SupplyPoint {
  id: number;
  ts_ms: number;
  block_height: number;
  bounty_id: number;
  recipient: AccountId;
  bid_units: U128;
  score: number;
  mint_rate: U128;
  amount: U128;
  total_minted_after: U128;
}

export interface Treasury {
  spend_cap: U128;
  committed_total: U128;
  funded_total: U128;
  available: U128;
  escrowed: U128;
  paid_out: U128;
  refunded_total: U128;
}

export interface PendingMint {
  bounty_id: number;
  recipient: AccountId;
  amount: U128;
  bid_units: U128;
  score: number;
}

/** get_config view. */
export interface HubConfig {
  owner: AccountId;
  coordinator: AccountId | null;
  verifier: AccountId | null;
  hive_token: AccountId;
  mint_rate: U128;
  total_minted: U128;
  version: string;
}

/** Exact contract panic codes. Each panic message starts with the code. */
export const HUB_ERRORS = [
  "ERR_NOT_OWNER",
  "ERR_NOT_COORDINATOR",
  "ERR_NOT_VERIFIER",
  "ERR_NOT_WORKER",
  "ERR_NOT_WINNER",
  "ERR_NOT_POSTER",
  "ERR_ROLE_CONFLICT",
  "ERR_BAD_TIER",
  "ERR_BAD_SCORE",
  "ERR_BAD_HASH",
  "ERR_TOO_LONG",
  "ERR_TOO_MANY_BIDS",
  "ERR_BOUNTY_NOT_FOUND",
  "ERR_BID_NOT_FOUND",
  "ERR_BAD_STATUS",
  "ERR_BID_NOT_SELECTABLE",
  "ERR_TREASURY_INSUFFICIENT",
  "ERR_SPEND_CAP",
  "ERR_DEADLINE_PAST",
  "ERR_ZERO_DEPOSIT",
  "ERR_OVERFLOW",
  "ERR_NO_PENDING_MINT",
] as const;
export type HubError = (typeof HUB_ERRORS)[number];
export const TOKEN_ERRORS = ["ERR_NOT_MINTER", "ERR_NOT_OWNER"] as const;

/** Function-call key method allowlists per agent role (docs/PLAN.md section 3). */
export const AGENT_METHODS = {
  coordinator: ["post_bounty", "select_winner", "reject_bid", "cancel_bounty"],
  verifier: ["verify_bounty"],
  worker: ["place_bid", "submit_work"],
} as const;

// ---------------- Off-chain shapes (content-addressed by hashJson) ----------------

export type OffchainKind = "spec" | "deliverable" | "report" | "selection";

export interface RubricCriterion {
  id: string;
  description: string;
  weight: number;
}

export interface BountySpec {
  version: 1;
  title: string;
  description: string;
  /** JSON Schema for Deliverable.data */
  deliverable_schema: Record<string, unknown>;
  required_sections: string[];
  /** file: path under /bounties */
  test: { runner: "node"; file: string; timeout_ms: number } | null;
  /** pass_threshold: 0-100 */
  rubric: { criteria: RubricCriterion[]; pass_threshold: number };
  budget_yocto: U128;
  min_tier: 1 | 2 | 3;
  deadline_minutes: number;
}

export interface Deliverable {
  bounty_id: number;
  round: number;
  worker: AccountId;
  sections: Record<string, string>;
  data: unknown;
  code?: Record<string, string>;
  /** Which generator produced the deliverable (LLM model or local template). */
  generator?: DeliverableGenerator;
}

export interface DeliverableGenerator {
  mode: "llm" | "template" | "failed";
  model: string | null;
}

export type CheckId = "schema" | "sections" | "test" | "rubric";

export interface CheckResult {
  id: CheckId;
  passed: boolean;
  skipped?: boolean;
  details: string;
  duration_ms: number;
}

export interface RubricScore {
  criterion: string;
  score: number;
  rationale: string;
}

/** hashJson(report) is the on-chain check_results_hash. */
export interface VerificationReport {
  bounty_id: number;
  round: number;
  worker: AccountId;
  spec_hash: string;
  deliverable_hash: string;
  checks: CheckResult[];
  rubric: {
    mode: "llm" | "fallback";
    model: string | null;
    scores: RubricScore[];
    total: number;
    threshold: number;
  } | null;
  passed: boolean;
  score: number;
  verifier: AccountId;
  created_ms: number;
}

export interface SelectionWeights {
  price: number;
  eta: number;
  reputation: number;
}

export const DEFAULT_SELECTION_WEIGHTS: SelectionWeights = { price: 0.5, eta: 0.2, reputation: 0.3 };

export interface SelectionCandidate {
  bid_id: number;
  worker: AccountId;
  price_yocto: U128;
  eta_ms: number;
  reputation: number;
  sig_valid: boolean;
  score: number;
}

export interface SelectionRationale {
  bounty_id: number;
  round: number;
  weights: SelectionWeights;
  candidates: SelectionCandidate[];
  winner_bid_id: number | null;
  rejected: { bid_id: number; reason: string }[];
}

export type Outcome = "win" | "loss" | "fail";

export interface StrategyChange {
  ts_ms: number;
  worker: AccountId;
  bounty_id: number;
  old_margin: number;
  new_margin: number;
  reason: string;
  window: Outcome[];
}

/** /config/deployment.testnet.json */
export interface DeploymentConfig {
  network: "testnet" | "mainnet";
  rpcUrl: string;
  hub: AccountId;
  token: AccountId;
  owner: AccountId;
  coordinator: AccountId;
  verifier: AccountId;
  workers: { cheap: AccountId; quality: AccountId; adaptive: AccountId; forger: AccountId };
  explorer: string;
  deployedAt: string;
  sampleTxs: Record<string, string>;
}
