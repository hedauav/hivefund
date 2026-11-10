"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useHub } from "@/providers/data-provider";
import { ExtLink } from "../ui";
import { apply, buildTimeline, cardPt, durationOf, emptyScene, reportHashOf, ROLES, settle, slotOf, type ArenaProc, type BidBlock, type Scene, type TimelineEvent } from "./model";
import { useEvidenceByReport, useProcurement } from "@/hooks/use-procurement";
import { Crate, Sprite } from "./sprites";

const KEEP = 14; // on first load, older history is fast-forwarded; the last KEEP events are replayed

function subscribeReduced(cb: () => void) {
  const m = window.matchMedia("(prefers-reduced-motion: reduce)");
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}
const getReduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function SwarmArena() {
  const { snapshot, strategy, explorer } = useHub();
  const reduced = useSyncExternalStore(subscribeReduced, getReduced, () => false);
  const timeline = useMemo(() => buildTimeline(snapshot?.activity ?? [], strategy), [snapshot?.activity, strategy]);
  const titles = useMemo(() => new Map((snapshot?.bounties ?? []).map((b) => [b.id, b.title])), [snapshot?.bounties]);
  const procMap = useProcurement(snapshot?.bounties);
  const reportHashes = useMemo(
    () =>
      (snapshot?.activity ?? [])
        .filter((e) => (e.kind === "VerificationPassed" || e.kind === "VerificationFailed") && e.bounty_id != null && procMap.has(e.bounty_id))
        .map((e) => reportHashOf(e.detail))
        .filter((h): h is string => !!h),
    [snapshot?.activity, procMap],
  );
  const evidence = useEvidenceByReport(reportHashes);
  const proc = useMemo<ArenaProc>(() => ({ bounties: new Set(procMap.keys()), evidence }), [procMap, evidence]);

  const [scene, setScene] = useState<Scene>(emptyScene);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [epoch, setEpoch] = useState(0);
  const played = useRef(new Set<string>());
  const gap = useRef(250);

  const step = useCallback(
    (all: boolean) => {
      const pending = timeline.filter((e) => !played.current.has(e.key));
      if (!pending.length) return false;
      // First run (or reduced motion): fast-forward silently, keep a short tail to animate.
      const silent = all ? pending : played.current.size === 0 && pending.length > KEEP ? pending.slice(0, -KEEP) : [];
      setScene((s) => {
        let next = s;
        for (const e of silent) next = apply(next, e, titles, proc);
        if (silent.length) next = settle(next);
        const head = all ? undefined : pending[silent.length];
        return head ? apply(next, head, titles, proc) : next;
      });
      for (const e of silent) played.current.add(e.key);
      const head = all ? undefined : pending[silent.length];
      if (head) {
        played.current.add(head.key);
        gap.current = durationOf(head);
      }
      return true;
    },
    [timeline, titles, proc],
  );

  useEffect(() => {
    if (reduced) {
      const t = setTimeout(() => step(true), 0);
      return () => clearTimeout(t);
    }
    if (!playing) return;
    const t = setTimeout(() => step(false), gap.current / speed);
    return () => clearTimeout(t);
  }, [reduced, playing, speed, step, scene.n, epoch]);

  const replay = () => {
    played.current = new Set();
    gap.current = 250;
    setScene(emptyScene());
    setPlaying(true);
    setEpoch((x) => x + 1);
  };

  const total = timeline.length;
  const done = Math.min(scene.n, total);
  const last = scene.last;
  const height = last?.type === "activity" ? last.e.block_height : null;
  const visible = useMemo(() => Object.keys(scene.cards).map(Number).sort((a, b) => a - b).slice(-6), [scene.cards]);
  const bidsBy = useMemo(() => {
    const m = new Map<number, BidBlock[]>();
    for (const b of Object.values(scene.bids)) m.set(b.bounty, [...(m.get(b.bounty) ?? []), b]);
    return m;
  }, [scene.bids]);

  return (
    <section className="sheet" aria-label="Swarm arena">
      <header className="sheet-head">
        <span className="tag">01</span>
        <h2 className="sheet-title">Swarm arena</h2>
        <span className="hidden text-xs text-muted sm:inline">replays the contract&apos;s activity log, one event at a time</span>
        <div className="ml-auto flex items-center gap-1" role="group" aria-label="Playback">
          {!reduced && (
            <button className="btn" onClick={() => setPlaying((p) => !p)} aria-pressed={!playing}>
              {playing ? "Pause" : "Play"}
            </button>
          )}
          {!reduced &&
            [1, 2, 4].map((v) => (
              <button key={v} className="btn" aria-pressed={speed === v} onClick={() => setSpeed(v)}>
                {v}×
              </button>
            ))}
          <button className="btn" onClick={replay} disabled={reduced}>
            Replay
          </button>
        </div>
      </header>

      <p className="border-b border-hair px-4 py-1 text-[11px] text-muted sm:hidden">Swipe sideways to see the whole arena.</p>
      <div className="overflow-x-auto">
        <div className="arena" style={{ ["--spd" as string]: speed }}>
          {/* stations */}
          <div className="st board" style={{ left: "3%", top: "6%", width: "31%", height: "72%" }}>
            <span className="st-label">Bounty board</span>
            {!visible.length && <span className="board-empty">no bounties pinned yet</span>}
          </div>
          <div className="st desk" style={{ left: "38%", top: "10%", width: "12%", height: "14%" }}>
            <span className="st-label">Coordinator</span>
          </div>
          <div className="st bench" style={{ left: "57%", top: "10%", width: "13%", height: "14%" }}>
            <span className="st-label">Verifier</span>
            {scene.fx.map((f, i) =>
              f.k === "check" || f.k === "cross" ? (
                <span key={`${scene.n}-${i}`} className={`verdict ${f.k}`} aria-hidden>
                  {f.k === "check" ? "✓" : "✗"}
                </span>
              ) : null,
            )}
          </div>
          <div className="st chest" style={{ left: "82%", top: "10%", width: "13%", height: "18%" }}>
            <span className="st-label">Treasury</span>
          </div>
          <div className="st mint" style={{ left: "82%", top: "56%", width: "13%", height: "22%" }}>
            <span className="st-label">HIVE mint</span>
          </div>

          {/* bounty cards with their bid blocks */}
          {visible.map((id) => {
            const c = scene.cards[id];
            const p = cardPt(slotOf(scene.cards, id));
            const isProc = proc.bounties.has(id);
            return (
              <div
                key={id}
                className={`card st-${c.status}${isProc ? " proc" : ""}`}
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
                title={`${titles.get(id) ?? ""}${isProc ? " · procurement: find the best real item under budget" : ""}`}
              >
                <span className="card-id">
                  {isProc && (
                    <span className="card-crate" aria-label="procurement">
                      <Crate color="#8B6B4A" />
                    </span>
                  )}
                  #{id}
                </span>
                <span className="card-st">{c.status}</span>
                <div className="blocks">
                  {(bidsBy.get(id) ?? []).slice(-8).map((b) => (
                    <span
                      key={b.id}
                      className={`blk b-${b.state}`}
                      title={`bid #${b.id}${b.role ? ` · ${b.role}` : ""}${b.price ? ` · ${b.price}` : ""}${b.reason ? ` · rejected: ${b.reason}` : ""}`}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          {/* transient effects */}
          {scene.fx.map((f, i) => {
            const key = `${scene.n}-${i}`;
            if (f.k === "drop") return <span key={key} className="fx-drop" style={{ left: `${f.at.x + 4}%`, top: `${f.at.y - 4}%` }}>{f.text}</span>;
            if (f.k === "stamp") return <span key={key} className="fx-stamp" style={{ left: `${f.at.x + 1}%`, top: `${f.at.y + 2}%` }}>WON</span>;
            if (f.k === "coins")
              return (
                <span key={key} className="fx-fly" style={{ left: "88%", top: "18%", ["--tx" as string]: `${f.to.x}%`, ["--ty" as string]: `${f.to.y - 16}%` }}>
                  <i className="coin" />
                  <i className="coin" />
                  <i className="coin" />
                  <b>{f.text}</b>
                </span>
              );
            if (f.k === "hive")
              return (
                <span key={key} className="fx-fly hive" style={{ left: "88%", top: "64%", ["--tx" as string]: `${f.to.x}%`, ["--ty" as string]: `${f.to.y - 18}%` }}>
                  <i className="hx" />
                  <i className="hx" />
                  <b>{f.text}</b>
                </span>
              );
            if (f.k === "fund") return <span key={key} className="fx-drop" style={{ left: "84%", top: "4%" }}>+{f.text}</span>;
            return null;
          })}

          {/* agents */}
          {ROLES.map((r) => {
            const p = scene.pos[r];
            const bubble = scene.bubble?.role === r ? scene.bubble.text : null;
            return (
              <div key={r} className={`agent${p.walk ? " walk" : ""}`} style={{ left: `${p.x}%`, top: `${p.y}%` }}>
                {bubble && <span className="bubble">{bubble}</span>}
                {p.carry && (
                  <span className="carry">
                    <Crate />
                  </span>
                )}
                <span className="body">
                  <Sprite role={r} />
                </span>
                <span className="name">{r}</span>
              </div>
            );
          })}
        </div>
      </div>

      <footer className="arena-cap" aria-live="polite">
        <span className="font-mono text-[11px] text-muted tabular-nums">
          {done}/{total}
        </span>
        <span className="min-w-0 flex-1">
          {scene.caption || (total ? "Starting the replay…" : "Nothing has happened on this hub yet. The arena starts moving with the first bounty.")}
        </span>
        {height != null && explorer.enabled && <ExtLink href={explorer.block(height)}>block {height.toLocaleString()}</ExtLink>}
      </footer>

      {reduced && <ReducedList timeline={timeline} titles={titles} proc={proc} />}
    </section>
  );
}

/** prefers-reduced-motion: the same events as a numbered, readable list. */
function ReducedList({ timeline, titles, proc }: { timeline: TimelineEvent[]; titles: Map<number, string>; proc: ArenaProc }) {
  const lines = useMemo(() => {
    const out: { key: string; text: string }[] = [];
    timeline.reduce((s, e) => {
      const next = apply(s, e, titles, proc);
      out.push({ key: e.key, text: next.caption });
      return next;
    }, emptyScene());
    return out;
  }, [timeline, titles, proc]);
  return (
    <ol className="max-h-56 list-decimal overflow-y-auto border-t-[1.5px] border-ink px-8 py-2 text-sm">
      {lines.slice(-20).map((l) => (
        <li key={l.key} className="py-0.5">
          {l.text}
        </li>
      ))}
    </ol>
  );
}
