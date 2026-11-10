"use client";

import type { Deliverable, ProcurementEvidence, ProcurementSpec } from "@hivefund/shared";
import { useOffchain } from "@/hooks/use-offchain";
import { clock, shortHash } from "@/lib/format";
import { Check, Chip, cx, ExtLink, Mono } from "./ui";

/** Proposal payload a procurement worker submits as Deliverable.data (docs/notes/procurement.md). */
export interface ProcurementProposal {
  item_id: string;
  source_url: string;
  quoted_pricing: { input: number; output: number };
  quoted_workload_cost_usd: number;
  catalog_fetched_at_ms: number;
  considered_count: number;
  alternatives?: { item_id: string; workload_cost_usd: number }[];
  justification: string;
}

export const usd = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return "—";
  const digits = Math.abs(n) >= 1 ? 2 : Math.abs(n) >= 0.01 ? 3 : 6;
  return `$${n.toFixed(digits).replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1")}`;
};
const per1m = (p: { input: number; output: number } | null | undefined) => (p ? `${usd(p.input)} in · ${usd(p.output)} out` : "—");

/** Small tag used on boards. */
export function ProcurementTag() {
  return (
    <span className="ml-1.5 inline-flex items-center gap-1 border border-current px-1 align-middle font-mono text-[9px] font-semibold uppercase tracking-wide text-warn" title="Procurement bounty: find the best real item under a budget">
      <svg aria-hidden viewBox="0 0 6 6" className="h-2 w-2" shapeRendering="crispEdges">
        <rect width={6} height={6} fill="currentColor" />
        <rect x={1} y={1} width={4} height={4} fill="var(--panel)" />
        <rect x={1} y={2.5} width={4} height={1} fill="currentColor" />
      </svg>
      procurement
    </span>
  );
}

/** The buyer's request: product budget, workload and hard requirements. */
export function ProcurementRequest({ p }: { p: ProcurementSpec }) {
  const req = p.requirements;
  const rows: [string, string][] = [];
  if (req.supported_features?.length) rows.push(["features", req.supported_features.join(", ")]);
  if (req.min_context_length != null) rows.push(["context", `≥ ${req.min_context_length.toLocaleString()} tokens`]);
  if (req.input_modalities?.length) rows.push(["input", req.input_modalities.join(", ")]);
  if (req.output_modalities?.length) rows.push(["output", req.output_modalities.join(", ")]);
  return (
    <div className="border-[1.5px] border-ink bg-panel-2 p-3 text-xs">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-display text-sm font-bold">Purchase request</span>
        <ProcurementTag />
        <span className="ml-auto text-muted">
          catalog <ExtLink href={p.catalog_url}>{p.catalog}</ExtLink>
        </span>
      </div>
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1">
        <dt className="text-muted">Product budget</dt>
        <dd className="font-semibold">
          {usd(p.product_budget_usd)} {p.currency} for the workload
        </dd>
        <dt className="text-muted">Workload</dt>
        <dd className="font-mono">
          {p.workload.input_mtok}M in + {p.workload.output_mtok}M out tokens
        </dd>
        <dt className="text-muted">Cost formula</dt>
        <dd className="font-mono">input$/1M × {p.workload.input_mtok} + output$/1M × {p.workload.output_mtok}</dd>
        {rows.map(([k, v]) => (
          <FragmentRow key={k} k={`must have · ${k}`} v={v} />
        ))}
        <dt className="text-muted">Price tolerance</dt>
        <dd>quoted vs live within {p.price_tolerance_pct}%</dd>
        <dt className="text-muted">Delivery check</dt>
        <dd>{p.delivery_check ? "verifier makes one tiny real call to the pick" : "off"}</dd>
      </dl>
      <p className="mt-2 text-muted">Agents recommend and verify an item; nobody checks out or pays the vendor.</p>
    </div>
  );
}

function FragmentRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-muted">{k}</dt>
      <dd className="break-anywhere min-w-0 font-mono">{v}</dd>
    </>
  );
}

/** The worker's proposal, loaded from the deliverable by hash. */
export function ProposalFromHash({ hash }: { hash: string }) {
  const d = useOffchain<Deliverable>(hash);
  if (d.status === "loading" || d.status === "idle") return <p className="text-xs text-muted">Loading proposal {shortHash(hash)}…</p>;
  if (d.status !== "ok") return <p className="text-xs text-bad">Proposal {shortHash(hash)}: {d.error}</p>;
  return <ProposalView d={d.object} />;
}

export function ProposalView({ d }: { d: Deliverable }) {
  const p = d.data as Partial<ProcurementProposal> | null;
  const gen = d.generator;
  return (
    <div className="border border-hair p-3 text-xs">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink">Proposal</span>
        <span className="text-muted">round {d.round} · {d.worker.split(".")[0]}</span>
        {gen && (
          <Chip tone={gen.mode === "failed" ? "bg-bad-soft text-bad" : gen.mode === "llm" ? "bg-info-soft text-info" : "bg-panel-2 text-muted"}>
            {gen.mode === "llm" ? `LLM · ${gen.model ?? "?"}` : gen.mode}
          </Chip>
        )}
      </div>
      {!p?.item_id ? (
        <p className="text-bad">No item proposed (deliverable data is empty or malformed).</p>
      ) : (
        <>
          <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1">
            <dt className="text-muted">Item</dt>
            <dd className="break-anywhere font-mono font-semibold">
              {p.source_url ? <ExtLink href={p.source_url}>{p.item_id}</ExtLink> : p.item_id}
            </dd>
            <dt className="text-muted">Quoted price /1M</dt>
            <dd className="break-anywhere min-w-0 font-mono">{per1m(p.quoted_pricing)}</dd>
            <dt className="text-muted">Quoted workload cost</dt>
            <dd className="font-mono">{usd(p.quoted_workload_cost_usd)}</dd>
            <dt className="text-muted">Catalog read</dt>
            <dd>
              {p.catalog_fetched_at_ms ? clock(p.catalog_fetched_at_ms) : "—"} · scanned {p.considered_count ?? "?"} entries
            </dd>
          </dl>
          {p.justification && <p className="break-anywhere mt-2 border-l-2 border-hair pl-2 text-muted">{p.justification}</p>}
          {!!p.alternatives?.length && (
            <div className="mt-2 text-muted">
              considered:{" "}
              {p.alternatives.slice(0, 6).map((a, i) => (
                <span key={a.item_id} className="font-mono">
                  {i ? " · " : ""}
                  {a.item_id} {usd(a.workload_cost_usd)}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** What the verifier fetched live, hash-locked inside the report. */
export function EvidenceTable({ ev }: { ev: ProcurementEvidence }) {
  const rows: { label: string; value: React.ReactNode; ok: boolean | null }[] = [
    { label: "item in live catalog", value: <Mono>{ev.item_id}</Mono>, ok: ev.found },
    {
      label: "quoted vs live price /1M",
      value: (
        <span className="font-mono">
          {per1m(ev.quoted_pricing)} <span className="text-muted">vs</span> {per1m(ev.live_pricing)}
        </span>
      ),
      ok: ev.price_match,
    },
    {
      label: "live workload cost vs budget",
      value: (
        <span className="font-mono">
          {usd(ev.live_workload_cost_usd)} {ev.within_budget ? "≤" : ">"} {usd(ev.budget_usd)}
          {ev.quoted_workload_cost_usd != null && <span className="text-muted"> (quoted {usd(ev.quoted_workload_cost_usd)})</span>}
        </span>
      ),
      ok: ev.within_budget,
    },
    ...ev.requirement_checks.map((c) => ({
      label: `requirement · ${c.requirement}`,
      value: (
        <span className="break-anywhere font-mono">
          need {c.expected} <span className="text-muted">· has</span> {c.actual}
        </span>
      ),
      ok: c.passed,
    })),
  ];
  if (ev.delivery) {
    const d = ev.delivery;
    rows.push({
      label: "delivery: real call to the pick",
      value: (
        <span className="font-mono">
          {d.model} · HTTP {d.http_status ?? "—"}
          {d.prompt_tokens != null && ` · ${d.prompt_tokens}+${d.completion_tokens ?? 0} tok`}
          {d.cost_usd != null && ` · ${usd(d.cost_usd)}`}
          <span className="text-muted"> · {d.details}</span>
        </span>
      ),
      ok: d.ok,
    });
  }
  return (
    <div className="mt-3">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="font-semibold text-ink">Live catalog evidence</span>
        <span>
          fetched {clock(ev.fetched_at_ms)} from <ExtLink href={ev.catalog_url}>{new URL(ev.catalog_url).host}</ExtLink> · {ev.catalog_size} entries
        </span>
      </div>
      <ul className="text-xs">
        {rows.map((r) => (
          <li key={r.label} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-1 border-t border-dashed border-hair py-1 sm:grid-cols-[1.25rem_15rem_minmax(0,1fr)]">
            <span>
              <Check ok={r.ok}>{""}</Check>
            </span>
            <span className="font-medium">{r.label}</span>
            <span className={cx("break-anywhere col-start-2 min-w-0 sm:col-start-3", r.ok === false && "text-bad")}>{r.value}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-xs text-muted">
        {ev.compliant_count} live item{ev.compliant_count === 1 ? "" : "s"} met every requirement within budget
        {ev.cheapest_compliant && (
          <>
            ; cheapest was <Mono>{ev.cheapest_compliant.id}</Mono> at {usd(ev.cheapest_compliant.workload_cost_usd)}
          </>
        )}
        . The rubric judges value for money against these live options.
      </p>
    </div>
  );
}
