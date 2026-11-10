import { memo } from "react";
import type { Role } from "./model";

// 8×10 pixel figures, hand-placed. Letters map to the palette below; "." is transparent.
const BASE = [
  "..hhhh..",
  ".hhhhhh.",
  "..ffff..",
  "..fefe..",
  "..ffff..",
  ".bbbbbb.",
  "fbbbbbbf",
  "..bbbb..",
  "..l..l..",
  "..l..l..",
];

const ROWS: Partial<Record<Role, Record<number, string>>> = {
  coordinator: { 0: "........", 1: ".hhhhhh.", 2: ".hfffff." },
  verifier: { 3: ".gggggg.", 0: "........" },
  forger: { 3: "..mmmm..", 4: "..mmmm.." },
  quality: { 0: "...hh...", 1: "..hhhh.." },
  adaptive: { 0: "..h..h..", 1: ".hhhhhh." },
};

const COLORS: Record<Role, Record<string, string>> = {
  coordinator: { h: "#3F5A73", b: "#3F5A73", l: "#1E1B16" },
  verifier: { h: "#1E1B16", b: "#D8CFBC", l: "#1E1B16", g: "#3F5A73" },
  cheap: { h: "#6E5135", b: "#8B6B4A", l: "#3B2C1D" },
  quality: { h: "#2F4423", b: "#4E6B3A", l: "#1E1B16" },
  adaptive: { h: "#8A5F14", b: "#C08A2E", l: "#3B2C1D" },
  forger: { h: "#1E1B16", b: "#B5452B", l: "#1E1B16", m: "#1E1B16" },
};
const SHARED: Record<string, string> = { f: "#D9B48F", e: "#1E1B16" };

export const Sprite = memo(function Sprite({ role, size = 4 }: { role: Role; size?: number }) {
  const rows = BASE.map((r, i) => ROWS[role]?.[i] ?? r);
  const pal = { ...SHARED, ...COLORS[role] };
  const rects: React.ReactNode[] = [];
  rows.forEach((row, y) =>
    [...row].forEach((c, x) => {
      if (c !== ".") rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={pal[c]} />);
    }),
  );
  return (
    <svg width={8 * size} height={10 * size} viewBox="0 0 8 10" shapeRendering="crispEdges" aria-hidden>
      {rects}
    </svg>
  );
});

/** Small 6×6 crate the agent carries. */
export function Crate({ color = "#C08A2E" }: { color?: string }) {
  return (
    <svg width={12} height={12} viewBox="0 0 6 6" shapeRendering="crispEdges" aria-hidden>
      <rect width={6} height={6} fill="#1E1B16" />
      <rect x={1} y={1} width={4} height={4} fill={color} />
      <rect x={1} y={2.5} width={4} height={1} fill="#1E1B16" opacity={0.35} />
    </svg>
  );
}
