"use client";

import type { BidStatus, BountyStatus } from "@hivefund/shared";
import type { PropsWithChildren, ReactNode } from "react";
import { useHub } from "@/providers/data-provider";
import { shortAccount, shortHash } from "@/lib/format";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Card({
  title,
  subtitle,
  action,
  children,
  className,
  id,
}: PropsWithChildren<{ title: ReactNode; subtitle?: ReactNode; action?: ReactNode; className?: string; id?: string }>) {
  return (
    <section id={id} className={cx("rounded-xl border border-line bg-panel shadow-sm", className)}>
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
        </div>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Empty({ children }: PropsWithChildren) {
  return <p className="py-6 text-center text-sm text-muted">{children}</p>;
}

const BOUNTY_TONE: Record<BountyStatus, string> = {
  Open: "bg-info-soft text-info",
  Bidding: "bg-accent-soft text-accent-text",
  InProgress: "bg-warn-soft text-warn",
  Verifying: "bg-info-soft text-info",
  Completed: "bg-ok-soft text-ok",
  Disputed: "bg-bad-soft text-bad",
  Cancelled: "bg-bad-soft text-bad",
};

const BID_TONE: Record<BidStatus, string> = {
  Pending: "bg-info-soft text-info",
  Won: "bg-accent-soft text-accent-text",
  Paid: "bg-ok-soft text-ok",
  Lost: "bg-panel-2 text-muted",
  Rejected: "bg-bad-soft text-bad",
  Superseded: "bg-bad-soft text-bad",
  Failed: "bg-bad-soft text-bad",
};

export function Chip({ children, tone }: PropsWithChildren<{ tone: string }>) {
  return <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", tone)}>{children}</span>;
}

export const BountyStatusChip = ({ status }: { status: BountyStatus }) => <Chip tone={BOUNTY_TONE[status]}>{status}</Chip>;
export const BidStatusChip = ({ status }: { status: BidStatus }) => <Chip tone={BID_TONE[status]}>{status}</Chip>;

const ExtIcon = () => (
  <svg aria-hidden viewBox="0 0 12 12" className="ml-0.5 inline h-2.5 w-2.5 opacity-60">
    <path d="M4.5 2H2v8h8V7.5M7 2h3v3M10 2 5.5 6.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
  </svg>
);

export function ExtLink({ href, children, title }: PropsWithChildren<{ href: string; title?: string }>) {
  return (
    <a href={href} target="_blank" rel="noreferrer" title={title} className="text-accent-text underline-offset-2 hover:underline">
      {children}
      <ExtIcon />
    </a>
  );
}

/** Account name, linked to nearblocks in live mode. */
export function Account({ id, full }: { id: string | null | undefined; full?: boolean }) {
  const { explorer } = useHub();
  if (!id) return <span className="text-muted">—</span>;
  const label = full ? id : shortAccount(id);
  if (!explorer.enabled) return <span title={id} className="font-medium">{label}</span>;
  return (
    <ExtLink href={explorer.account(id)} title={id}>
      <span className="font-medium">{label}</span>
    </ExtLink>
  );
}

/** Transaction hash, linked to nearblocks in live mode. */
export function TxLink({ hash, label }: { hash: string | null | undefined; label?: string }) {
  const { explorer } = useHub();
  if (!hash) return <span className="text-muted">—</span>;
  if (!explorer.enabled) {
    return (
      <span className="text-[11px] italic text-muted" title="sample data: there is no real transaction behind this entry">
        sample tx
      </span>
    );
  }
  return (
    <ExtLink href={explorer.tx(hash)} title={hash}>
      <span className="font-mono text-xs">{label ?? shortHash(hash, 6)}</span>
    </ExtLink>
  );
}

export function BlockLink({ height }: { height: number }) {
  const { explorer } = useHub();
  const label = `#${height.toLocaleString()}`;
  if (!explorer.enabled) return <span className="font-mono text-xs text-muted">{label}</span>;
  return (
    <ExtLink href={explorer.block(height)} title={`block ${height}`}>
      <span className="font-mono text-xs">{label}</span>
    </ExtLink>
  );
}

export function Mono({ children, title }: PropsWithChildren<{ title?: string }>) {
  return (
    <span className="font-mono text-xs" title={title}>
      {children}
    </span>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-panel px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 text-xl font-semibold tracking-tight">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function Check({ ok, children }: PropsWithChildren<{ ok: boolean | null }>) {
  return (
    <span className={cx("inline-flex items-center gap-1 text-xs font-medium", ok === null ? "text-muted" : ok ? "text-ok" : "text-bad")}>
      <span aria-hidden>{ok === null ? "○" : ok ? "✓" : "✕"}</span>
      {children}
    </span>
  );
}
