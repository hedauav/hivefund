"use client";

import Link from "next/link";
import { useTheme } from "@/providers/theme-provider";
import { WalletButton } from "./wallet-button";

/** Pixel bee over a hive, drawn on a 10×10 grid. */
export function Logo() {
  const px: [number, number, number, number, string][] = [
    [2, 5, 6, 1, "#4a3322"], [1, 6, 8, 3, "#e1a43a"], [1, 7, 8, 1, "#b8802a"], [2, 9, 6, 1, "#4a3322"], [4, 7, 2, 2, "#4a3322"],
    [3, 1, 4, 3, "#2a1f16"], [4, 1, 1, 3, "#f0c35a"], [6, 1, 1, 3, "#f0c35a"], [1, 0, 2, 2, "#fff3d6"], [7, 0, 2, 2, "#fff3d6"],
  ];
  return (
    <svg viewBox="0 0 10 10" className="h-8 w-8" shapeRendering="crispEdges" aria-hidden>
      {px.map(([x, y, w, h, f], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} fill={f} />
      ))}
    </svg>
  );
}

const NAV = [
  ["Bounties", "/#bounties"],
  ["Verification", "/#verification"],
  ["HIVE", "/#hive"],
  ["Workers", "/#workers"],
  ["Ledger", "/#activity"],
] as const;

export function Header() {
  const { theme, toggle } = useTheme();
  return (
    <header className="border-b-2 border-line bg-[var(--wood)] text-[var(--wood-text)]">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <Logo />
          <span className="font-display text-[2rem] leading-none">HiveFund</span>
          <span className="pxlabel hidden opacity-80 lg:inline">a town of AI workers · NEAR testnet</span>
        </Link>
        <nav className="order-3 flex w-full gap-4 overflow-x-auto text-sm md:order-none md:w-auto">
          {NAV.map(([label, href]) => (
            <Link key={href} href={href} className="pxlabel whitespace-nowrap opacity-85 underline-offset-4 hover:underline">
              {label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={toggle} className="btn" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
            {theme === "dark" ? "Day" : "Dusk"}
          </button>
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
