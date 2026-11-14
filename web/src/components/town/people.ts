// Villagers: 7×12 hand-placed pixel figures, one per agent. "." is transparent.
import type { Role } from "../arena/model";
import { px, type Ctx } from "./world";

const BODY = [
  "..hhh..",
  ".hhhhh.",
  "..fff..",
  "..efe..",
  "..fff..",
  ".ccccc.",
  "accccca",
  "a.ccc.a",
  "..ccc..",
  "..p.p..",
  "..p.p..",
  "..s.s..",
];
// Per-role row overrides give each villager a silhouette you can tell apart at 3× scale.
const OVR: Record<Role, Record<number, string>> = {
  coordinator: { 0: ".kkkkk.", 1: "..kkk..", 6: "accgcca", 7: "a.cgc.a" }, // top hat, gold sash
  verifier: { 0: "..hhh..", 3: "..ggg..", 5: ".wwwww.", 6: "awwwwwa", 7: "a.www.a", 8: "..www.." }, // goggles, lab coat
  cheap: { 0: ".yyyyy.", 1: "yyyyyyy" }, // straw hat
  quality: { 0: "..hhh..", 3: "..g.g.." }, // neat hair, spectacles
  adaptive: { 0: "...t...", 1: ".ccccc.", 2: ".cfffc." }, // hood with an antenna
  forger: { 0: ".kkkkk.", 1: "kkkkkkk", 2: ".kfffk.", 3: ".kmmmk.", 5: ".kkkkk.", 6: "akkkkka", 7: "a.kkk.a", 8: "..kkk.." }, // cloak, red mask
};
const PAL: Record<Role, Record<string, string>> = {
  coordinator: { h: "#3A2A1E", c: "#2F4B6E", k: "#1D1A17", g: "#E1A43A" },
  verifier: { h: "#5A4232", c: "#E9E6DC", w: "#F4F1E8", g: "#3C6E8F" },
  cheap: { h: "#6B4428", c: "#8B6B4A", y: "#E3C25A" },
  quality: { h: "#2A1F16", c: "#3E7A2E", g: "#F2E8CF" },
  adaptive: { h: "#C4572E", c: "#D9783A", t: "#2A1F16" },
  forger: { h: "#1D1A17", c: "#2E2A26", k: "#2B2622", m: "#B23A2A" },
};
const SHARED: Record<string, string> = { f: "#E2B98F", e: "#2A1F16", a: "#E2B98F", p: "#3A3330", s: "#1D1A17" };

/** Draw a villager with feet at (x, y). frame 0/1 alternates the legs while walking. */
export function drawVillager(c: Ctx, r: Role, x: number, y: number, frame: number, carry: boolean) {
  const rows = BODY.map((row, i) => OVR[r][i] ?? row);
  if (frame) {
    rows[9] = ".p...p.";
    rows[10] = ".p...p.";
    rows[11] = ".s...s.";
  }
  const pal = { ...SHARED, ...PAL[r] };
  const ox = Math.round(x) - 3;
  const oy = Math.round(y) - 12 - (frame ? 1 : 0);
  px(c, ox + 1, Math.round(y) - 1, 5, 1, "rgba(0,0,0,0.25)"); // shadow
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const k = row[i];
      if (k !== ".") px(c, ox + i, oy + j, 1, 1, pal[k] ?? "#000");
    }
  });
  if (carry) {
    px(c, ox + 4, oy + 5, 5, 4, "#2A1F16");
    px(c, ox + 5, oy + 6, 3, 2, "#C89B5A");
  }
}
