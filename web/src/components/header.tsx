"use client";

import Link from "next/link";
import { useTheme } from "@/providers/theme-provider";
import { WalletButton } from "./wallet-button";

/** Pixel hex mark, drawn on a 7×7 grid. */
export function Logo() {
  return (
    <svg viewBox="0 0 7 7" className="h-6 w-6" shapeRendering="crispEdges" aria-hidden>
      <path d="M2 0h3v1h1v1h1v3h-1v1h-1v1h-3v-1h-1v-1h-1v-3h1v-1h1z" fill="var(--text)" />
      <path d="M2 2h3v3h-3z" fill="var(--accent)" />
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
    <header className="border-b-[1.5px] border-line bg-bg">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <Logo />
          <span className="font-display text-xl font-extrabold tracking-tight">HiveFund</span>
          <span className="hidden font-mono text-[11px] text-muted lg:inline">bounty market · NEAR</span>
        </Link>
        <nav className="order-3 flex w-full gap-4 overflow-x-auto text-sm md:order-none md:w-auto">
          {NAV.map(([label, href]) => (
            <Link key={href} href={href} className="whitespace-nowrap text-muted underline-offset-4 hover:text-ink hover:underline">
              {label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={toggle} className="btn" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
            {theme === "dark" ? "Paper" : "Night"}
          </button>
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
