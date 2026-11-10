"use client";

import Link from "next/link";
import { useTheme } from "@/providers/theme-provider";
import { WalletButton } from "./wallet-button";

export function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden>
      <path d="M16 2 28 9v14l-12 7-12-7V9z" fill="var(--accent)" />
      <path d="M16 9.5 22 13v6.5l-6 3.5-6-3.5V13z" fill="var(--bg)" opacity="0.9" />
      <path d="M16 13 19 14.8v3.4L16 20l-3-1.8v-3.4z" fill="var(--accent)" />
    </svg>
  );
}

export function Header() {
  const { theme, toggle } = useTheme();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <Logo />
          <span className="text-lg font-semibold tracking-tight">HiveFund</span>
        </Link>
        <nav className="hidden items-center gap-4 text-sm text-muted md:flex">
          <Link href="/#bounties" className="hover:text-ink">Bounties</Link>
          <Link href="/#hive" className="hover:text-ink">HIVE</Link>
          <Link href="/#workers" className="hover:text-ink">Workers</Link>
          <Link href="/#treasury" className="hover:text-ink">Treasury</Link>
          <Link href="/#activity" className="hover:text-ink">Activity</Link>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={toggle}
            className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted hover:text-ink"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? "☀ Light" : "☾ Dark"}
          </button>
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
