"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { formatHive, formatNear } from "@hivefund/shared";
import { useHub } from "@/providers/data-provider";
import { useTheme } from "@/providers/theme-provider";
import { useEvidenceByReport, useProcurement } from "@/hooks/use-procurement";
import { ExtLink } from "../ui";
import { apply, buildTimeline, durationOf, emptyScene, reportHashOf, ROLES, settle, type ArenaProc, type Role, type Scene, type TimelineEvent } from "../arena/model";
import { drawVillager } from "./people";
import {
  BUILDINGS, DAY, DUSK, H, POND_TILES, TREE_LIST, W, byId, depthOfBuilding, iso, paintBuilding, paintStatic, paintTree, px, route, spot,
  type BuildingId, type Ctx, type Pal, type XY,
} from "./world";

const KEEP = 14; // on first load, older history is fast-forwarded; the last KEEP events animate
const FPS = 30;
const SPEED_TILES = 5; // villager walking speed, tiles per second at 1×

interface Walker { x: number; y: number; path: XY[]; carry: boolean; }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; col: string; size: number; g: number; }
interface Layer { depth: number; canvas: HTMLCanvasElement; id?: BuildingId; }

const reducedQuery = "(prefers-reduced-motion: reduce)";
const subReduced = (cb: () => void) => {
  const m = window.matchMedia(reducedQuery);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};

function offscreen(): [HTMLCanvasElement, Ctx] {
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  return [cv, cv.getContext("2d")!];
}

/** Screen-space hit box (in W×H units) for a building, generous enough to tap on a phone. */
function hitBox(id: BuildingId) {
  const b = byId[id];
  if (id === "board") {
    const [x, y] = iso(b.gx + 1, b.gy + 0.5);
    return { x: x - 19, y: y - 26, w: 38, h: 32 };
  }
  const [lx] = iso(b.gx, b.gy + b.d);
  const [rx] = iso(b.gx + b.w, b.gy);
  const top = iso(b.gx, b.gy)[1] - b.h - 12;
  const bottom = iso(b.gx + b.w, b.gy + b.d)[1];
  return { x: lx - 2, y: top, w: rx - lx + 4, h: bottom - top };
}
const pct = (v: number, of: number) => `${(v / of) * 100}%`;
const ROOF: Record<BuildingId, number> = { board: 0, hall: 11, lab: 12, vault: 16, mint: 14, "house-cheap": 8, "house-quality": 8, "house-adaptive": 15, shack: 4 };
/** Name plates hang just above each roof. */
function plateAt(id: BuildingId): XY {
  const b = byId[id];
  if (id === "board") {
    const [x, y] = iso(b.gx + 1, b.gy + 0.5);
    return [x, y - 26];
  }
  const [x, y] = iso(b.gx + b.w / 2, b.gy + b.d / 2);
  return [x, y - b.h - ROOF[id] - 3];
}

const NOTICE = (slot: number): XY => {
  const [x, y] = iso(9, 8.5);
  return [x - 14 + (slot % 3) * 10, y - 19 + Math.floor(slot / 3) * 9];
};
const STATUS_COL: Record<string, string> = {
  open: "#F6EFD9", taken: "#E1A43A", verifying: "#9CC1D9", passed: "#8FC46E", done: "#8FC46E", failed: "#E07A5C", cancelled: "#9A8F80",
};
const BID_COL: Record<string, string> = { pending: "#F6EFD9", won: "#E1A43A", paid: "#3E7A2E", lost: "#9A8F80", old: "#9A8F80", rejected: "#B23A2A", failed: "#B23A2A" };

export function Town({ onOpen }: { onOpen: (id: BuildingId, bounty?: number) => void }) {
  const { snapshot, strategy, explorer, tokenSupply } = useHub();
  const { theme } = useTheme();
  const reduced = useSyncExternalStore(subReduced, () => window.matchMedia(reducedQuery).matches, () => false);
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

  /* ---------- playback (same reducer as the ledger; never invents events) ---------- */
  const [scene, setScene] = useState<Scene>(emptyScene);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [follow, setFollow] = useState(true);
  const [epoch, setEpoch] = useState(0);
  const played = useRef(new Set<string>());
  const gap = useRef(250);
  const step = useCallback(
    (all: boolean) => {
      const pending = timeline.filter((e) => !played.current.has(e.key));
      if (!pending.length) return;
      const silent = all ? pending : played.current.size === 0 && pending.length > KEEP ? pending.slice(0, -KEEP) : [];
      const head = all ? undefined : pending[silent.length];
      setScene((s) => {
        let next = s;
        for (const e of silent) next = apply(next, e, titles, proc);
        if (silent.length) next = settle(next);
        return head ? apply(next, head, titles, proc) : next;
      });
      for (const e of silent) played.current.add(e.key);
      if (head) {
        played.current.add(head.key);
        gap.current = durationOf(head);
      }
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
  // follow-live: when new chain events arrive and we're behind, skip ahead so we animate the newest ones
  useEffect(() => {
    if (!follow || reduced) return;
    const behind = timeline.filter((e) => !played.current.has(e.key)).length;
    if (behind > 4) {
      const skip = timeline.filter((e) => !played.current.has(e.key)).slice(0, -2);
      setScene((s) => settle(skip.reduce((n, e) => apply(n, e, titles, proc), s)));
      for (const e of skip) played.current.add(e.key);
    }
  }, [follow, reduced, timeline, titles, proc]);
  const replay = () => {
    played.current = new Set();
    gap.current = 250;
    setScene(emptyScene());
    setPlaying(true);
    setFollow(false);
    setEpoch((x) => x + 1);
  };

  /* ---------- canvas ---------- */
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tagRefs = useRef<Partial<Record<Role, HTMLDivElement | null>>>({});
  const [scale, setScale] = useState(3);
  const layers = useRef<{ ground: HTMLCanvasElement; objects: Layer[]; pal: Pal } | null>(null);
  const walkers = useRef<Record<Role, Walker> | null>(null);
  const parts = useRef<Particle[]>([]);
  const live = useRef({ scene, speed, proc, flask: 0, flaskUntil: 0, coins: 1, hive: 0, burnSlot: -1, burnUntil: 0 });
  live.current.scene = scene;
  live.current.speed = speed;
  live.current.proc = proc;

  // treasury and supply drive the vault's coin stack and the mint's block pile
  const availNear = snapshot ? Number(formatNear(snapshot.treasury.available, 4)) : 0;
  const supply = Number(formatHive(tokenSupply ?? snapshot?.config.total_minted ?? "0", 4));
  live.current.coins = Math.max(1, Math.min(14, Math.round(availNear * 24)));
  live.current.hive = Math.max(0, Math.min(21, Math.ceil(supply * 8)));

  // integer pixel scale that fits the column (and the viewport height on desktop)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const fit = Math.floor(Math.min(el.clientWidth / W, Math.max(2, (window.innerHeight - 190) / H)));
      setScale(Math.max(2, Math.min(5, fit)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // center the scroll on narrow screens so the plaza is in view
  useEffect(() => {
    const el = wrapRef.current;
    if (el && el.scrollWidth > el.clientWidth) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  }, [scale]);

  // paint the static layers once per theme
  useEffect(() => {
    const pal = theme === "dark" ? DUSK : DAY;
    const [ground, g] = offscreen();
    paintStatic(g, pal);
    const objects: Layer[] = BUILDINGS.map((b) => {
      const [cv, c] = offscreen();
      paintBuilding(c, pal, b);
      return { depth: depthOfBuilding(b), canvas: cv, id: b.id };
    });
    TREE_LIST.forEach(([gx, gy], i) => {
      const [cv, c] = offscreen();
      paintTree(c, pal, gx, gy, i);
      objects.push({ depth: gx + gy + 0.6, canvas: cv });
    });
    objects.sort((a, b) => a.depth - b.depth);
    layers.current = { ground, objects, pal };
  }, [theme]);

  // villager targets follow the scene's stations
  const lastN = useRef(0);
  useEffect(() => {
    const jump = scene.n - lastN.current !== 1;
    lastN.current = scene.n;
    if (!walkers.current) {
      walkers.current = Object.fromEntries(ROLES.map((r) => { const [x, y] = spot(r, "home"); return [r, { x, y, path: [], carry: false }]; })) as unknown as Record<Role, Walker>;
    }
    for (const r of ROLES) {
      const w = walkers.current[r];
      const to = spot(r, scene.loc[r]);
      w.carry = scene.pos[r].carry;
      if (jump || reduced) {
        w.x = to[0];
        w.y = to[1];
        w.path = [];
      } else if (Math.hypot(w.x - to[0], w.y - to[1]) > 0.05) {
        w.path = route([w.x, w.y], to);
      }
    }
    // one-shot effects for this event
    if (reduced) return;
    const L = live.current;
    const now = performance.now();
    const burst = (at: XY, col: string, n: number, up: number, g = 30) => {
      for (let i = 0; i < n; i++)
        parts.current.push({ x: at[0], y: at[1], vx: (Math.random() - 0.5) * 30, vy: -up - Math.random() * 20, life: 0, max: 0.9 + Math.random() * 0.5, col, size: 1 + (i % 2), g });
    };
    const flyTo = (from: XY, to: XY, col: string, n: number) => {
      for (let i = 0; i < n; i++) {
        const t = 0.8 + i * 0.07;
        parts.current.push({ x: from[0], y: from[1], vx: (to[0] - from[0]) / t, vy: (to[1] - from[1]) / t - 60 * t * 0.5, life: 0, max: t, col, size: 2, g: 60 });
      }
    };
    for (const f of scene.fx) {
      if (f.k === "check" || f.k === "cross") {
        L.flask = f.k === "check" ? 1 : -1;
        L.flaskUntil = now + 2200;
        burst(lab(), f.k === "check" ? "#8FC46E" : "#E07A5C", 10, 40);
      }
      const winner = ROLES.find((r) => scene.loc[r] === "vault" || scene.loc[r] === "mint");
      if (f.k === "coins") flyTo(vaultTop(), feet(winner && spot(winner, "vault")), "#E1A43A", 6);
      if (f.k === "hive") {
        flyTo(chimney(), feet(winner && spot(winner, "mint")), "#F0B74E", 5);
        burst(chimney(), "#CFC6B8", 8, 25, -6);
      }
      if (f.k === "fund") burst(vaultTop(), "#E1A43A", 10, 30);
    }
    const ev = scene.last;
    if (ev?.type === "activity" && ev.e.kind === "BidRejected" && ev.e.bounty_id != null) {
      const ids = Object.keys(scene.cards).map(Number).sort((a, b) => a - b).slice(-6);
      L.burnSlot = ids.indexOf(ev.e.bounty_id);
      L.burnUntil = now + 1600;
    }
  }, [scene, reduced]);

  // the frame loop: 30 fps, paused when hidden or scrolled away
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const c = cv.getContext("2d")!;
    c.imageSmoothingEnabled = false;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(cv);
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (!visible || document.hidden) {
        last = now;
        return;
      }
      acc += now - last;
      last = now;
      // reduced motion: a still picture, redrawn twice a second so it tracks the chain
      if (acc < (reduced ? 500 : 1000 / FPS)) return;
      const dt = reduced ? 0 : Math.min(0.1, acc / 1000);
      acc = 0;
      frame(c, reduced ? 0 : now, dt);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
    // frame reads refs only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, theme]);

  function frame(c: Ctx, now: number, dt: number) {
    const lay = layers.current;
    const ws = walkers.current;
    if (!lay || !ws) return;
    const L = live.current;
    const t = now / 1000;
    const pal = lay.pal;
    c.drawImage(lay.ground, 0, 0);
    // pond shimmer and drifting clouds / fireflies
    POND_TILES.forEach(([gx, gy], i) => {
      const [x, y] = iso(gx + 0.5, gy + 0.3);
      px(c, x - 3 + Math.round(Math.sin(t * 1.5 + i) * 2), y + 2, 3, 1, pal.water[1]);
    });
    for (let i = 0; i < 3; i++) {
      const x = ((t * (4 + i) + i * 120) % (W + 60)) - 40;
      if (pal.night) px(c, (x * 1.7) % W, 120 + ((i * 37 + Math.sin(t + i) * 6) % 60), 1, 1, i % 2 ? "#F2C35A" : "#E8E07A");
      else {
        px(c, x, 10 + i * 9, 22, 4, "#EEF4F2");
        px(c, x + 4, 7 + i * 9, 12, 3, "#EEF4F2");
      }
    }
    // walkers advance along their roads
    const step = SPEED_TILES * L.speed * dt;
    for (const r of ROLES) {
      const w = ws[r];
      let left = step;
      while (left > 0 && w.path.length) {
        const [tx, ty] = w.path[0];
        const d = Math.hypot(tx - w.x, ty - w.y);
        if (d <= left) {
          w.x = tx;
          w.y = ty;
          w.path.shift();
          left -= d;
        } else {
          w.x += ((tx - w.x) / d) * left;
          w.y += ((ty - w.y) / d) * left;
          left = 0;
        }
      }
    }
    // painter's order: objects and villagers by depth
    const order: (Layer | { depth: number; role: Role })[] = [...lay.objects, ...ROLES.map((role) => ({ depth: ws[role].x + ws[role].y, role }))];
    order.sort((a, b) => a.depth - b.depth);
    for (const o of order) {
      if ("role" in o) {
        const w = ws[o.role];
        const [x, y] = iso(w.x, w.y);
        const moving = w.path.length > 0;
        drawVillager(c, o.role, x, y + 4, moving ? Math.floor(t * 8) % 2 : 0, w.carry);
        const tag = tagRefs.current[o.role];
        if (tag) {
          tag.style.left = pct(x, W);
          tag.style.top = pct(y - 10, H);
        }
        continue;
      }
      c.drawImage(o.canvas, 0, 0);
      if (o.id) decorate(c, o.id, pal, t, now);
    }
    // particles
    parts.current = parts.current.filter((p) => (p.life += dt) < p.max);
    for (const p of parts.current) {
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      px(c, p.x, p.y, p.size, p.size, p.col);
    }
    if (Math.random() < dt * 0.4) parts.current.push({ x: chimney()[0], y: chimney()[1], vx: 3, vy: -8, life: 0, max: 2.4, col: pal.night ? "#5D5A55" : "#D9D2C4", size: 2, g: 0 });
    if (Math.random() < dt * 0.8) {
      const [x, y] = flaskAt();
      parts.current.push({ x: x + 1, y: y - 4, vx: 0, vy: -6, life: 0, max: 1, col: L.flask > 0 && now < L.flaskUntil ? "#B9E29A" : "#CFE3EE", size: 1, g: 0 });
    }
  }

  function decorate(c: Ctx, id: BuildingId, pal: Pal, t: number, now: number) {
    const L = live.current;
    const s = L.scene;
    if (id === "board") {
      const ids = Object.keys(s.cards).map(Number).sort((a, b) => a - b).slice(-6);
      ids.forEach((bid, slot) => {
        const [x, y] = NOTICE(slot);
        const card = s.cards[bid];
        px(c, x, y, 8, 7, pal.ink);
        px(c, x + 1, y + 1, 6, 5, STATUS_COL[card.status] ?? "#F6EFD9");
        px(c, x + 3, y - 1, 2, 2, "#B23A2A"); // pin
        if (L.proc.bounties.has(bid)) {
          px(c, x + 5, y + 1, 2, 2, "#8A5A34");
          px(c, x + 5, y + 2, 2, 1, pal.ink);
        }
        const bids = Object.values(s.bids).filter((b) => b.bounty === bid).slice(-4);
        bids.forEach((b, i) => px(c, x + 1 + i * 2 - (i > 2 ? 1 : 0), y + 4, 1, 1, BID_COL[b.state]));
        if (slot === L.burnSlot && now < L.burnUntil) {
          for (let i = 0; i < 4; i++) px(c, x + 1 + i * 2, y - 2 - ((t * 20 + i * 3) % 5), 1, 2, i % 2 ? "#F0B74E" : "#E0582E");
        }
      });
    }
    if (id === "lab") {
      const [x, y] = flaskAt();
      const col = now < L.flaskUntil ? (L.flask > 0 ? "#8FC46E" : "#E07A5C") : "#9CC1D9";
      px(c, x - 1, y - 7, 3, 3, pal.ink);
      px(c, x - 3, y - 4, 7, 5, pal.ink);
      px(c, x - 2, y - 3, 5, 3, col);
      px(c, x, y - 6, 1, 2, "#E9E6DC");
    }
    if (id === "vault") {
      const [x, y] = vaultTop();
      for (let i = 0; i < L.coins; i++) {
        px(c, x - 3, y - i * 2, 7, 2, pal.ink);
        px(c, x - 2, y - i * 2, 5, 1, i % 2 ? "#E1A43A" : "#F0C35A");
      }
    }
    if (id === "mint") {
      const [x0, y0] = iso(4.6, 14.2);
      let k = 0;
      for (let row = 0; k < L.hive; row++)
        for (let i = 0; i < 6 - row && k < L.hive; i++, k++) {
          const x = x0 - 12 + i * 4 + row * 2;
          const y = y0 - row * 3;
          px(c, x, y, 4, 3, (i + row) % 2 ? "#F0B74E" : "#E1A43A");
          px(c, x, y + 2, 4, 1, "#B8802A");
          px(c, x + 1, y, 1, 1, "#FFE3A0");
        }
    }
    if (id === "hall") {
      const [x, y] = iso(3.5, 7);
      const wave = Math.floor(t * 3) % 2;
      px(c, x, y - 40, 1, 12, pal.ink);
      px(c, x + 1, y - 40 + wave, 6, 3, "#E1A43A");
      px(c, x + 1, y - 37 + wave, 4, 1, "#C4572E");
    }
  }

  /* ---------- overlay ---------- */
  const fxText = useMemo(() => {
    const out: { key: string; at: XY; text: string; kind: string }[] = [];
    scene.fx.forEach((f, i) => {
      const key = `${scene.n}-${i}`;
      if (f.k === "drop") out.push({ key, at: iso(9, 7.6), text: f.text, kind: "slip" });
      if (f.k === "stamp") out.push({ key, at: iso(9, 7.8), text: "WON", kind: "stamp" });
      if (f.k === "coins") out.push({ key, at: vaultTop(), text: `+${f.text}`, kind: "gold" });
      if (f.k === "hive") out.push({ key, at: chimney(), text: `+${f.text}`, kind: "gold" });
      if (f.k === "fund") out.push({ key, at: vaultTop(), text: `+${f.text}`, kind: "gold" });
      if (f.k === "check" || f.k === "cross") out.push({ key, at: flaskAt(), text: f.k === "check" ? "PASS" : "FAIL", kind: f.k });
    });
    const ev = scene.last;
    if (ev?.type === "activity" && ev.e.kind === "BidRejected") out.push({ key: `${scene.n}-rej`, at: iso(9, 7.8), text: "REJECTED", kind: "cross" });
    return out;
  }, [scene]);

  const height = scene.last?.type === "activity" ? scene.last.e.block_height : null;
  const total = timeline.length;
  const playedCount = Math.min(scene.n, total);
  const bubbleRole = scene.bubble?.role ?? null;

  return (
    <section className="town" aria-label="HiveFund town: a live replay of the market">
      <div ref={wrapRef} className="town-scroll" style={{ background: (theme === "dark" ? DUSK : DAY).sky }}>
        <div className="town-stage" style={{ width: W * scale, height: H * scale }}>
          <canvas ref={canvasRef} width={W} height={H} className="town-canvas" style={{ width: W * scale, height: H * scale }} aria-hidden />
          {BUILDINGS.map((b) => {
            const r = hitBox(b.id);
            const [lx, ly] = plateAt(b.id);
            const minor = b.id.startsWith("house") || b.id === "shack";
            return (
              <div key={b.id} className={`town-bld${minor ? " minor" : ""}`}>
                <button
                  type="button"
                  className="town-hit"
                  style={{ left: pct(r.x, W), top: pct(r.y, H), width: pct(r.w, W), height: pct(r.h, H) }}
                  onClick={() => onOpen(b.id)}
                  aria-label={`Open the ${b.label} ledger`}
                />
                <span className="town-plate" style={{ left: pct(lx, W), top: pct(ly, H) }} aria-hidden>
                  {b.label}
                </span>
              </div>
            );
          })}
          {ROLES.map((r) => (
            <div key={r} ref={(el) => { tagRefs.current[r] = el; }} className="town-tag" aria-hidden>
              {bubbleRole === r && scene.bubble && <span className="town-bubble">{scene.bubble.text}</span>}
              <span className={`town-name n-${r}`}>{r}</span>
            </div>
          ))}
          {fxText.map((f) => (
            <span key={f.key} className={`town-fx fx-${f.kind}`} style={{ left: pct(f.at[0], W), top: pct(f.at[1] - 6, H), ["--spd" as string]: speed }}>
              {f.text}
            </span>
          ))}
        </div>
      </div>

      <div className="crier">
        <div className="crier-controls" role="group" aria-label="Playback">
          {!reduced && (
            <button className="pxbtn" onClick={() => setPlaying((p) => !p)} aria-pressed={!playing}>
              {playing ? "Pause" : "Play"}
            </button>
          )}
          {!reduced &&
            [1, 2, 4].map((v) => (
              <button key={v} className="pxbtn" aria-pressed={speed === v} onClick={() => setSpeed(v)}>
                {v}×
              </button>
            ))}
          <button className="pxbtn" onClick={replay} disabled={reduced}>
            Replay
          </button>
          <button className="pxbtn" aria-pressed={follow} onClick={() => setFollow((f) => !f)} disabled={reduced} title="Jump to the newest events as they land on-chain">
            Follow live
          </button>
        </div>
        <p className="crier-line" aria-live="polite">
          <span className="crier-count">
            {playedCount}/{total}
          </span>
          <span className="crier-text">{scene.caption || (total ? "The town wakes up…" : "Nothing has happened on this hub yet. The town comes alive with the first bounty.")}</span>
          {height != null && explorer.enabled && <ExtLink href={explorer.block(height)}>block {height.toLocaleString()}</ExtLink>}
        </p>
      </div>
      <p className="town-hint">Tap a building to open its ledger · every movement is a logged on-chain event{reduced ? " · motion is reduced: events are listed below" : ""}</p>
      {reduced && <EventList timeline={timeline} titles={titles} proc={proc} />}
    </section>
  );
}

/* anchor points shared by the canvas and the overlay */
function lab(): XY {
  const [x, y] = iso(7, 3.5);
  return [x, y - 26];
}
function flaskAt(): XY {
  const [x, y] = iso(7, 3.5);
  return [x, y - 22];
}
function vaultTop(): XY {
  const [x, y] = iso(13, 6);
  return [x, y - 12];
}
function chimney(): XY {
  const [x, y] = iso(6.4, 12.7);
  return [x, y - 30];
}
function feet(p: XY | undefined): XY {
  if (!p) return vaultTop();
  const [x, y] = iso(p[0], p[1]);
  return [x, y - 6];
}

/** prefers-reduced-motion: the same events as a numbered list. */
function EventList({ timeline, titles, proc }: { timeline: TimelineEvent[]; titles: Map<number, string>; proc: ArenaProc }) {
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
    <ol className="town-list">
      {lines.slice(-24).map((l) => (
        <li key={l.key}>{l.text}</li>
      ))}
    </ol>
  );
}
