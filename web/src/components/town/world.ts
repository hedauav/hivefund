// HiveFund town: an isometric pixel island drawn by hand-written raster code (no engine, no assets).
// Everything is rasterised row by row with fillRect so pixels stay crisp when scaled up.
import type { Role, Station } from "../arena/model";

export const W = 336;
export const H = 216;
const OX = 168;
const OY = 40;
export const N = 18; // grid is N×N tiles

export type Ctx = CanvasRenderingContext2D;
export type XY = [number, number];

/** Grid → screen (top vertex of the tile at gx, gy). */
export const iso = (gx: number, gy: number): XY => [OX + (gx - gy) * 8, OY + (gx + gy) * 4];

export interface Pal {
  sky: string;
  grass: [string, string];
  dirt: [string, string];
  path: string;
  stone: string;
  water: [string, string];
  leaf: [string, string];
  trunk: string;
  wood: string;
  ink: string;
  glow: string;
  night: boolean;
}

export const DAY: Pal = {
  sky: "#BFD9E2",
  grass: ["#86B25A", "#7CA852"],
  dirt: ["#8A5E3C", "#6E4A2E"],
  path: "#EAD9A8",
  stone: "#C9BFA8",
  water: ["#4F7FA0", "#6C98B5"],
  leaf: ["#4E8A3A", "#3B6E2C"],
  trunk: "#6B4428",
  wood: "#8A5A34",
  ink: "#2A1F16",
  glow: "#5E7380",
  night: false,
};
export const DUSK: Pal = {
  sky: "#18202B",
  grass: ["#3E5E3A", "#385634"],
  dirt: ["#4A3424", "#3A2A1D"],
  path: "#7D7158",
  stone: "#6D6758",
  water: ["#2C4A63", "#3B5E7A"],
  leaf: ["#2F5130", "#264326"],
  trunk: "#4A3020",
  wood: "#5E3E25",
  ink: "#0E0B08",
  glow: "#F2C35A",
  night: true,
};

/* ---------- raster primitives ---------- */

/** Scanline-fill a convex polygon with whole pixels. */
export function poly(c: Ctx, pts: XY[], col: string) {
  c.fillStyle = col;
  let y0 = 1e9;
  let y1 = -1e9;
  for (const p of pts) {
    y0 = Math.min(y0, p[1]);
    y1 = Math.max(y1, p[1]);
  }
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
    const yc = y + 0.5;
    let a = 1e9;
    let b = -1e9;
    for (let i = 0; i < pts.length; i++) {
      const [x1, ya] = pts[i];
      const [x2, yb] = pts[(i + 1) % pts.length];
      if (yc >= Math.min(ya, yb) && yc < Math.max(ya, yb)) {
        const x = x1 + ((yc - ya) * (x2 - x1)) / (yb - ya);
        a = Math.min(a, x);
        b = Math.max(b, x);
      }
    }
    const l = Math.round(a);
    const r = Math.round(b);
    if (r > l) c.fillRect(l, y, r - l, 1);
  }
}
export const px = (c: Ctx, x: number, y: number, w: number, h: number, col: string) => {
  c.fillStyle = col;
  c.fillRect(Math.round(x), Math.round(y), w, h);
};
const up = ([x, y]: XY, h: number): XY => [x, y - h];

export function tile(c: Ctx, gx: number, gy: number, col: string) {
  const [x, y] = iso(gx, gy);
  poly(c, [[x, y], [x + 8, y + 4], [x, y + 8], [x - 8, y + 4]], col);
}

/** Shade a hex colour (k < 1 darker, > 1 lighter). */
export function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/** An iso box on footprint (gx..gx+w, gy..gy+d), h pixels tall. Returns its corners. */
export function box(c: Ctx, gx: number, gy: number, w: number, d: number, h: number, wall: string, top?: string) {
  const A = iso(gx, gy);
  const B = iso(gx + w, gy);
  const C = iso(gx + w, gy + d);
  const D = iso(gx, gy + d);
  poly(c, [D, C, up(C, h), up(D, h)], wall); // front-left face
  poly(c, [C, B, up(B, h), up(C, h)], shade(wall, 0.78)); // front-right face
  if (top) poly(c, [up(A, h), up(B, h), up(C, h), up(D, h)], top);
  return { A, B, C, D };
}

/** Hip roof over a footprint, starting at wall height h, rising r pixels. */
function roof(c: Ctx, gx: number, gy: number, w: number, d: number, h: number, r: number, col: string) {
  const A = up(iso(gx - 0.15, gy - 0.15), h);
  const B = up(iso(gx + w + 0.15, gy - 0.15), h);
  const C = up(iso(gx + w + 0.15, gy + d + 0.15), h);
  const D = up(iso(gx - 0.15, gy + d + 0.15), h);
  const m = up(iso(gx + w / 2, gy + d / 2), h + r);
  poly(c, [A, B, m], shade(col, 1.1));
  poly(c, [D, A, m], shade(col, 1.05));
  poly(c, [D, C, m], col);
  poly(c, [C, B, m], shade(col, 0.75));
  // a darker eave line along the front edges
  poly(c, [D, C, [C[0], C[1] + 1], [D[0], D[1] + 1]], shade(col, 0.6));
  poly(c, [C, B, [B[0], B[1] + 1], [C[0], C[1] + 1]], shade(col, 0.5));
}

/* ---------- layout ---------- */

export type BuildingId = "board" | "hall" | "lab" | "vault" | "mint" | "house-cheap" | "house-quality" | "house-adaptive" | "shack";

export interface Building {
  id: BuildingId;
  label: string;
  gx: number;
  gy: number;
  w: number;
  d: number;
  h: number; // wall height
  door: XY; // grid point villagers stand on
}

export const BUILDINGS: Building[] = [
  { id: "hall", label: "Coordinator's Hall", gx: 2, gy: 6, w: 3, d: 2, h: 15, door: [3.5, 8.7] },
  { id: "lab", label: "Verifier's Lab", gx: 6, gy: 2, w: 2, d: 3, h: 13, door: [8.7, 3.5] },
  { id: "board", label: "Job Board", gx: 8, gy: 8, w: 2, d: 1, h: 0, door: [9, 10.3] },
  { id: "vault", label: "Treasury Vault", gx: 12, gy: 5, w: 2, d: 2, h: 11, door: [12.4, 7.6] },
  { id: "mint", label: "HIVE Mint", gx: 5, gy: 12, w: 2, d: 2, h: 13, door: [7.6, 12.4] },
  { id: "house-cheap", label: "cheap's house", gx: 10, gy: 14, w: 1, d: 1, h: 9, door: [10.5, 15.6] },
  { id: "house-adaptive", label: "adaptive's house", gx: 12, gy: 12, w: 1, d: 1, h: 9, door: [12.5, 13.6] },
  { id: "house-quality", label: "quality's house", gx: 14, gy: 9, w: 1, d: 1, h: 10, door: [14.5, 10.6] },
  { id: "shack", label: "the forger's shack", gx: 1, gy: 14, w: 1, d: 1, h: 7, door: [1.5, 15.6] },
];
export const byId = Object.fromEntries(BUILDINGS.map((b) => [b.id, b])) as Record<BuildingId, Building>;

const HOMES: Record<Role, BuildingId> = {
  coordinator: "hall",
  verifier: "lab",
  cheap: "house-cheap",
  quality: "house-quality",
  adaptive: "house-adaptive",
  forger: "shack",
};
const AT: Record<Exclude<Station, "home">, BuildingId> = { board: "board", hall: "hall", lab: "lab", vault: "vault", mint: "mint" };
const SPREAD: Record<Role, XY> = {
  coordinator: [-0.9, 0.1],
  verifier: [0.9, -0.2],
  cheap: [-0.45, 0.45],
  quality: [0.45, 0.45],
  adaptive: [0, 0.75],
  forger: [-1.2, 0.8],
};

export const buildingFor = (r: Role, s: Station): BuildingId => (s === "home" ? HOMES[r] : AT[s]);
/** Where a villager stands for a station; several can share a door without overlapping. */
export function spot(r: Role, s: Station): XY {
  const b = byId[buildingFor(r, s)];
  const [ox, oy] = s === "home" ? [0, 0] : SPREAD[r];
  return [b.door[0] + ox * 0.6, b.door[1] + oy * 0.6];
}

const PLAZA: XY = [9, 10.3];
/** Walk via the plaza along the same L-shaped roads that are painted on the ground. */
export function route(from: XY, to: XY): XY[] {
  const leg = (p: XY): XY[] => [p, [PLAZA[0], p[1]]];
  const near = Math.hypot(from[0] - to[0], from[1] - to[1]) < 2.2;
  if (near) return [to];
  return [...leg(from).slice(1), PLAZA, ...leg(to).reverse()];
}

const TREES: XY[] = [
  [1, 2], [2, 1], [0, 5], [4, 1], [11, 1], [14, 2], [16, 4], [16, 7], [10, 4], [3, 11], [0, 9],
  [6, 16], [4, 16], [15, 15], [12, 16], [16, 12], [13, 3], [1, 11], [7, 17],
];
const POND: XY[] = [[15, 1], [16, 1], [16, 2], [17, 2], [17, 3], [15, 2], [17, 1]];

function isPath(gx: number, gy: number) {
  if (gx >= 7 && gx <= 10 && gy >= 7 && gy <= 11) return true; // plaza
  for (const b of BUILDINGS) {
    const [dx, dy] = [Math.floor(b.door[0]), Math.floor(b.door[1])];
    // L-shaped road from the door to the plaza column
    const xs = [Math.min(dx, PLAZA[0]), Math.max(dx, PLAZA[0])];
    const ys = [Math.min(dy, 10), Math.max(dy, 10)];
    if (gy === dy && gx >= xs[0] && gx <= xs[1]) return true;
    if (gx === 9 && gy >= ys[0] && gy <= ys[1]) return true;
  }
  return false;
}

/* ---------- static layer ---------- */

export function paintGround(c: Ctx, p: Pal) {
  c.fillStyle = p.sky;
  c.fillRect(0, 0, W, H);
  if (p.night) {
    for (let i = 0; i < 40; i++) px(c, (i * 97) % W, (i * 53) % 70, 1, 1, i % 5 ? "#55617a" : "#e9e2c8");
  }
  // island sides (earth slab under the grid)
  const L = iso(0, N);
  const B = iso(N, N);
  const R = iso(N, 0);
  poly(c, [L, B, [B[0], B[1] + 12], [L[0], L[1] + 12]], p.dirt[0]);
  poly(c, [B, R, [R[0], R[1] + 12], [B[0], B[1] + 12]], p.dirt[1]);
  for (let i = 0; i < N; i++) {
    const [x, y] = iso(i, N);
    px(c, x - 3, y + 6, 3, 1, shade(p.dirt[0], 0.8));
    const [x2, y2] = iso(N, i);
    px(c, x2 + 2, y2 + 8, 3, 1, shade(p.dirt[1], 0.8));
  }
  for (let gx = 0; gx < N; gx++)
    for (let gy = 0; gy < N; gy++) {
      const water = POND.some(([a, b]) => a === gx && b === gy);
      tile(c, gx, gy, water ? p.water[0] : isPath(gx, gy) ? (gx >= 7 && gx <= 10 && gy >= 7 && gy <= 11 ? p.stone : p.path) : p.grass[(gx * 7 + gy * 3) % 5 === 0 ? 1 : 0]);
      if (!water && !isPath(gx, gy) && (gx * 13 + gy * 7) % 9 === 0) {
        const [x, y] = iso(gx + 0.5, gy + 0.5);
        px(c, x - 1, y - 1, 1, 2, p.leaf[1]);
        px(c, x + 1, y - 2, 1, 3, p.leaf[0]);
      }
    }
}

export function paintTree(c: Ctx, p: Pal, gx: number, gy: number, i: number) {
  const [x, y] = iso(gx + 0.5, gy + 0.5);
  px(c, x - 1, y - 6, 2, 6, p.trunk);
  if (i % 3 === 0) {
    // pine
    for (let k = 0; k < 4; k++) px(c, x - 5 + k, y - 9 - k * 3, 10 - k * 2, 3, k % 2 ? p.leaf[1] : p.leaf[0]);
  } else {
    px(c, x - 5, y - 15, 10, 8, p.leaf[0]);
    px(c, x - 4, y - 17, 8, 2, p.leaf[0]);
    px(c, x - 5, y - 9, 10, 2, p.leaf[1]);
    px(c, x + 1, y - 14, 3, 3, shade(p.leaf[0], 1.25));
  }
}

/** Static parts of one building (walls, roof, windows) — everything that depends on chain state is drawn per frame. */
export function paintBuilding(c: Ctx, p: Pal, b: Building) {
  const win = p.night ? p.glow : "#2E4253";
  const { gx, gy, w, d, h } = b;
  const face = (t: number, s: number, hh: number): XY => {
    // a point on the front-left face: t along x (0..w), s up the wall (px)
    const [x, y] = iso(gx + t, gy + d);
    return [x, y - hh - s];
  };
  const window = (t: number, s: number) => {
    const [x, y] = face(t, s, 0);
    px(c, x - 1, y - 3, 3, 4, p.ink);
    px(c, x, y - 2, 1, 2, win);
  };
  const door = (t: number, col: string) => {
    const [x, y] = face(t, 0, 0);
    px(c, x - 2, y - 7, 4, 7, p.ink);
    px(c, x - 1, y - 6, 2, 6, col);
  };
  switch (b.id) {
    case "board": {
      const [x, y] = iso(gx + 1, gy + 0.5);
      px(c, x - 15, y - 2, 2, 8, p.trunk);
      px(c, x + 13, y - 2, 2, 8, p.trunk);
      px(c, x - 17, y - 22, 34, 21, p.trunk);
      px(c, x - 16, y - 21, 32, 19, "#C79A63");
      px(c, x - 18, y - 24, 36, 3, shade(p.trunk, 0.8));
      return;
    }
    case "hall":
      box(c, gx, gy, w, d, h, "#D9C7A0");
      for (const t of [0.4, 1.2, 2.2, 2.7]) {
        const [x, y] = face(t, 0, 0);
        px(c, x, y - h + 1, 1, h - 1, "#F3E6C4");
      }
      door(1.7, "#7A3B22");
      roof(c, gx, gy, w, d, h, 11, "#B4502C");
      return;
    case "lab":
      box(c, gx, gy, w, d, h, "#E6E0D2");
      window(0.6, 6);
      window(1.5, 6);
      door(1.05, "#3C6E8F");
      roof(c, gx, gy, w, d, h, 6, "#5D6B73");
      return;
    case "vault": {
      box(c, gx, gy, w, d, h, "#9A958A", "#B5B0A4");
      for (let s = 2; s < h; s += 3) {
        const [x0, y0] = face(0, s, 0);
        const [x1] = face(w, s, 0);
        for (let x = x0; x < x1; x += 2) px(c, x, y0 - (x - x0) / 2, 1, 1, "#7E796F");
      }
      const [x, y] = face(1, 0, 0);
      px(c, x - 3, y - 8, 6, 8, p.ink);
      px(c, x - 2, y - 7, 4, 7, "#C9A04A");
      px(c, x, y - 5, 1, 2, p.ink);
      return;
    }
    case "mint": {
      box(c, gx, gy, w, d, h, "#A9573A");
      for (let s = 2; s < h; s += 3) {
        const [x0, y0] = face(0, s, 0);
        const [x1] = face(w, s, 0);
        for (let x = x0 + (s % 2) * 2; x < x1; x += 4) px(c, x, y0 - (x - x0) / 2, 2, 1, "#8E452C");
      }
      door(0.6, "#4A2A1A");
      window(1.5, 6);
      roof(c, gx, gy, w, d, h, 7, "#5A4A40");
      const [cx, cy] = up(iso(gx + 1.4, gy + 0.7), h + 4);
      px(c, cx - 2, cy - 9, 5, 12, "#6E3A26");
      px(c, cx - 3, cy - 10, 7, 2, "#4A2A1A");
      return;
    }
    case "shack":
      box(c, gx, gy, w, d, h, "#6A5A48");
      door(0.5, "#2A221A");
      roof(c, gx - 0.1, gy, w + 0.2, d, h, 4, "#4A3F36");
      {
        const [x, y] = face(0.5, h - 2, 0);
        px(c, x - 3, y - 3, 6, 1, "#B23A2A");
        px(c, x - 1, y - 5, 1, 5, "#B23A2A");
      }
      return;
    default: {
      const cols: Record<string, [string, string]> = {
        "house-cheap": ["#D8C27A", "#C9A24A"], // straw thatch
        "house-quality": ["#E9E3D4", "#4E6676"],
        "house-adaptive": ["#E4CDB0", "#C76A2E"],
      };
      const [wall, rf] = cols[b.id];
      box(c, gx, gy, w, d, h, wall);
      door(0.5, p.wood);
      roof(c, gx, gy, w, d, h, 8, rf);
      if (b.id === "house-adaptive") {
        const [x, y] = up(iso(gx + 0.5, gy + 0.5), h + 9);
        px(c, x, y - 6, 1, 6, p.ink);
        px(c, x - 2, y - 6, 5, 1, p.ink);
      }
    }
  }
}

export function paintStatic(c: Ctx, p: Pal) {
  paintGround(c, p);
}

/** Depth key for painter's ordering: larger = nearer the viewer. */
export const depthOfBuilding = (b: Building) => b.gx + b.w + b.gy + b.d - 1.2;
export const TREE_LIST = TREES;
export const POND_TILES = POND;
