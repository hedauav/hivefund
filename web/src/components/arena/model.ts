// Swarm arena: a pure reducer over real market events (get_activity_log + strategy logs).
// The arena never invents events; every frame is the result of one logged action.
import { formatHive, formatNear, type ActivityEntry, type StrategyChange } from "@hivefund/shared";
import { humanizeDetail } from "@/lib/format";

export type Role = "cheap" | "quality" | "adaptive" | "forger" | "coordinator" | "verifier";
export const ROLES: Role[] = ["coordinator", "verifier", "cheap", "quality", "adaptive", "forger"];

export interface Pt {
  x: number; // % of stage width
  y: number; // % of stage height (agent feet)
}

export const HOME: Record<Role, Pt> = {
  coordinator: { x: 44, y: 40 },
  verifier: { x: 64, y: 40 },
  cheap: { x: 42, y: 93 },
  quality: { x: 52, y: 93 },
  adaptive: { x: 62, y: 93 },
  forger: { x: 72, y: 93 },
};
const BENCH: Pt = { x: 58, y: 44 };
const CHEST: Pt = { x: 79, y: 42 };
const MINT: Pt = { x: 79, y: 90 };

export type TimelineEvent =
  | { key: string; ts: number; type: "activity"; e: ActivityEntry }
  | { key: string; ts: number; type: "strategy"; s: StrategyChange };

export type BidState = "pending" | "rejected" | "won" | "lost" | "failed" | "paid" | "old";
export interface Card {
  id: number;
  status: "open" | "taken" | "verifying" | "passed" | "failed" | "done" | "cancelled";
}
export interface BidBlock {
  id: number;
  bounty: number;
  role: Role | null;
  price: string | null;
  state: BidState;
  reason?: string;
}
export type Fx =
  | { k: "drop"; at: Pt; text: string }
  | { k: "stamp"; at: Pt }
  | { k: "check" | "cross" }
  | { k: "coins"; to: Pt; text: string }
  | { k: "hive"; to: Pt; text: string }
  | { k: "fund"; text: string };

export interface Scene {
  cards: Record<number, Card>;
  bids: Record<number, BidBlock>;
  pos: Record<Role, Pt & { walk: boolean; carry: boolean }>;
  fx: Fx[];
  bubble: { role: Role; text: string } | null;
  caption: string;
  last: TimelineEvent | null;
  n: number;
}

export function emptyScene(): Scene {
  const pos = {} as Scene["pos"];
  for (const r of ROLES) pos[r] = { ...HOME[r], walk: false, carry: false };
  return { cards: {}, bids: {}, pos, fx: [], bubble: null, caption: "", last: null, n: 0 };
}

export function roleOf(account: string | null | undefined): Role | null {
  const head = (account ?? "").split(".")[0] as Role;
  return ROLES.includes(head) ? head : null;
}

export function buildTimeline(activity: ActivityEntry[], strategy: Record<string, StrategyChange[]>): TimelineEvent[] {
  const ev: TimelineEvent[] = activity.map((e) => ({ key: `a${e.id}`, ts: e.ts_ms, type: "activity", e }));
  for (const list of Object.values(strategy)) {
    for (const s of list) ev.push({ key: `s${s.worker}:${s.ts_ms}`, ts: s.ts_ms, type: "strategy", s });
  }
  // Stable: activity keeps contract order (by id); strategy notes slot in by time.
  return ev.sort((a, b) => a.ts - b.ts || (a.type === "activity" && b.type === "activity" ? a.e.id - b.e.id : a.type === "activity" ? -1 : 1));
}

/** Visible board slots: the 6 most recent bounties. */
export function slotOf(cards: Record<number, Card>, id: number): number {
  const ids = Object.keys(cards).map(Number).sort((a, b) => a - b).slice(-6);
  return ids.indexOf(id);
}
export function cardPt(slot: number): Pt {
  return { x: 6.5 + (slot % 3) * 9.4, y: 12 + Math.floor(slot / 3) * 32 };
}
const standAt = (slot: number): Pt => {
  const c = cardPt(Math.max(0, slot));
  return { x: c.x + 3.6, y: c.y + 39 };
};

const near = (y?: string | null) => (y ? `${formatNear(y, 3)} NEAR` : "");
const who = (r: Role | null, acct: string) => r ?? acct.split(".")[0];

export function durationOf(ev: TimelineEvent): number {
  if (ev.type === "strategy") return 2600;
  switch (ev.e.kind) {
    case "BidPlaced":
    case "WorkSubmitted":
    case "WinnerSelected":
    case "BountyPosted":
    case "Payout":
    case "Mint":
      return 1700;
    case "BidRejected":
    case "VerificationPassed":
    case "VerificationFailed":
    case "BountyReopened":
    case "TreasuryFunded":
      return 1400;
    default:
      return 500;
  }
}

/** Apply one event. Agents not involved in it walk home. */
export function apply(prev: Scene, ev: TimelineEvent, titles: Map<number, string>): Scene {
  const s: Scene = { ...prev, cards: { ...prev.cards }, bids: { ...prev.bids }, pos: { ...prev.pos }, fx: [], bubble: null, last: ev, n: prev.n + 1 };
  const moved = new Set<Role>();
  const go = (r: Role | null, p: Pt, carry = false) => {
    if (!r) return;
    moved.add(r);
    const cur = s.pos[r];
    s.pos[r] = { ...p, walk: cur.x !== p.x || cur.y !== p.y, carry };
  };

  if (ev.type === "strategy") {
    const r = roleOf(ev.s.worker) ?? "adaptive";
    s.bubble = { role: r, text: ev.s.reason };
    s.caption = `${r} changes its margin ${pct(ev.s.old_margin)} → ${pct(ev.s.new_margin)}: ${ev.s.reason}`;
  } else {
    const e = ev.e;
    const actor = roleOf(e.actor);
    const b = e.bounty_id;
    const title = b != null ? titles.get(b) : undefined;
    const bLabel = b != null ? `bounty #${b}${title ? ` “${title}”` : ""}` : "";
    const slot = b != null ? slotOf(b in s.cards ? s.cards : { ...s.cards, [b]: { id: b, status: "open" } }, b) : -1;
    // Payout/Mint may omit bid_id: fall back to this bounty's winning block, then to an account named in the detail.
    const winning = b != null ? Object.values(s.bids).find((x) => x.bounty === b && (x.state === "won" || x.state === "paid")) : undefined;
    const bid = e.bid_id != null ? (s.bids[e.bid_id] ?? winning) : winning;
    const named = roleOf(e.detail.match(/([a-z0-9_-]+)\.[a-z0-9._-]+\.(?:testnet|near)/)?.[0]);
    const bidRole = bid?.role ?? (actor && actor !== "coordinator" && actor !== "verifier" ? actor : named);
    switch (e.kind) {
      case "BountyPosted":
        s.cards[b!] = { id: b!, status: "open" };
        go("coordinator", standAt(slotOf(s.cards, b!)));
        s.caption = `The coordinator pins ${bLabel} to the board${e.amount ? `, ${near(e.amount)} held in escrow` : ""}.`;
        break;
      case "BidPlaced":
        s.bids[e.bid_id!] = { id: e.bid_id!, bounty: b!, role: actor, price: e.amount, state: "pending" };
        go(actor, standAt(slot), true);
        s.fx.push({ k: "drop", at: cardPt(slot), text: near(e.amount) });
        s.caption = `${who(actor, e.actor)} bids ${near(e.amount)} on ${bLabel}.`;
        break;
      case "BidRejected": {
        const reason = e.detail.split("rejected: ")[1] ?? e.detail;
        const role = bid?.role ?? (actor === "coordinator" ? named : actor);
        s.bids[e.bid_id!] = { id: e.bid_id!, bounty: b!, role, price: bid?.price ?? e.amount, state: "rejected", reason };
        go(actor === "coordinator" ? "coordinator" : role, standAt(slot));
        s.caption = `Bid #${e.bid_id} from ${role ?? "a worker"} is rejected: ${reason}.`;
        break;
      }
      case "WinnerSelected":
        for (const k in s.bids) {
          const x = s.bids[k];
          if (x.bounty === b && x.state === "pending") s.bids[k] = { ...x, state: x.id === e.bid_id ? "won" : "lost" };
        }
        if (b != null && s.cards[b]) s.cards[b] = { ...s.cards[b], status: "taken" };
        go("coordinator", standAt(slot));
        s.fx.push({ k: "stamp", at: cardPt(slot) });
        s.caption = `The coordinator stamps bid #${e.bid_id} (${bidRole ?? "?"}) as the winner of ${bLabel}.`;
        break;
      case "WorkSubmitted":
        if (b != null && s.cards[b]) s.cards[b] = { ...s.cards[b], status: "verifying" };
        go(actor, BENCH, true);
        s.caption = `${who(actor, e.actor)} carries its deliverable to the verifier.`;
        break;
      case "VerificationPassed":
      case "VerificationFailed": {
        const ok = e.kind === "VerificationPassed";
        if (b != null && s.cards[b]) s.cards[b] = { ...s.cards[b], status: ok ? "passed" : "failed" };
        if (bid && !ok) s.bids[bid.id] = { ...bid, state: "failed" };
        go("verifier", HOME.verifier);
        go(bidRole, BENCH);
        s.fx.push({ k: ok ? "check" : "cross" });
        s.caption = ok
          ? `The verifier passes the work on ${bLabel}: ${humanizeDetail(e.detail)}.`
          : `The verifier fails the work on ${bLabel}: ${humanizeDetail(e.detail)}.`;
        break;
      }
      case "Payout":
        if (bid) s.bids[bid.id] = { ...bid, state: "paid" };
        if (b != null && s.cards[b]) s.cards[b] = { ...s.cards[b], status: "done" };
        go(bidRole, CHEST);
        s.fx.push({ k: "coins", to: CHEST, text: near(e.amount) });
        s.caption = `The treasury pays ${bidRole ?? "the winner"} ${near(e.amount)} from escrow.`;
        break;
      case "Mint": {
        const amt = e.amount ? `${formatHive(e.amount, 3)} HIVE` : "HIVE";
        go(bidRole, MINT);
        s.fx.push({ k: "hive", to: MINT, text: amt });
        s.caption = `The market mints ${amt} to ${bidRole ?? "the winner"} (winning bid × score).`;
        break;
      }
      case "BountyReopened":
        for (const k in s.bids) {
          const x = s.bids[k];
          if (x.bounty === b && (x.state === "lost" || x.state === "pending" || x.state === "won")) s.bids[k] = { ...x, state: "old" };
        }
        if (b != null && s.cards[b]) s.cards[b] = { ...s.cards[b], status: "open" };
        s.caption = `${bLabel} goes back on the board for another round.`;
        break;
      case "BountyCancelled":
        if (b != null && s.cards[b]) s.cards[b] = { ...s.cards[b], status: "cancelled" };
        s.caption = `${bLabel} is cancelled after two failed attempts; escrow returns to the treasury.`;
        break;
      case "TreasuryFunded":
        s.fx.push({ k: "fund", text: near(e.amount) });
        s.caption = `The treasury receives ${near(e.amount)}.`;
        break;
      default:
        s.caption = humanizeDetail(e.detail);
    }
  }
  for (const r of ROLES) {
    if (moved.has(r)) continue;
    const cur = s.pos[r];
    const h = HOME[r];
    s.pos[r] = { ...h, walk: cur.x !== h.x || cur.y !== h.y, carry: false };
  }
  return s;
}

/** Fast-forward without animation: same reducer, then everyone rests at home. */
export function settle(s: Scene): Scene {
  const pos = {} as Scene["pos"];
  for (const r of ROLES) pos[r] = { ...HOME[r], walk: false, carry: false };
  return { ...s, pos, fx: [], bubble: null };
}

const pct = (m: number) => `${Math.round(m * 100)}%`;
