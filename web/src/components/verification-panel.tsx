"use client";

import type { Bounty, VerificationReport } from "@hivefund/shared";
import { useHub } from "@/providers/data-provider";
import { useOffchain } from "@/hooks/use-offchain";
import { shortHash } from "@/lib/format";
import { Account, Card, Check, Chip, cx, Empty, Mono, TxLink } from "./ui";
import { EvidenceTable, ProcurementTag, ProposalFromHash } from "./procurement-view";

export function VerificationPanel({ bounty }: { bounty: Bounty }) {
  const { index } = useHub();
  // On-chain only holds the latest check_results_hash; earlier rounds' reports come from the off-chain index.
  const reportHashes = index
    .filter((e) => e.kind === "report" && e.bounty_id === bounty.id)
    .sort((a, z) => (z.round ?? 0) - (a.round ?? 0))
    .map((e) => e.hash);
  if (bounty.check_results_hash && !reportHashes.includes(bounty.check_results_hash)) reportHashes.unshift(bounty.check_results_hash);

  return (
    <Card
      id="verification"
      n="04"
      title={`Verification of #${bounty.id}`}
      subtitle="automated checks first (schema, sections, test or live catalog), then rubric; pass needs every check and rubric ≥ threshold"
    >
      {!reportHashes.length ? (
        <Empty hint="A report appears once the winning worker submits a deliverable.">
          {bounty.status === "Verifying" ? "The verifier is checking the deliverable." : "Nothing has been verified for this bounty yet."}
        </Empty>
      ) : (
        <div className="space-y-4">
          {reportHashes.map((h) => (
            <ReportView key={h} hash={h} onChain={h === bounty.check_results_hash} bounty={bounty} />
          ))}
        </div>
      )}
    </Card>
  );
}

function ReportView({ hash, onChain, bounty }: { hash: string; onChain: boolean; bounty: Bounty }) {
  const { txs } = useHub();
  const r = useOffchain<VerificationReport>(hash);
  if (r.status === "loading" || r.status === "idle") return <p className="text-sm text-muted">Loading report {shortHash(hash)}…</p>;
  if (r.status !== "ok") {
    return (
      <div className=" border border-bad/40 bg-bad-soft p-3 text-sm text-bad">
        Report <Mono>{shortHash(hash)}</Mono>: {r.error}
      </div>
    );
  }
  const rep = r.object;
  const verifyTx = txs.verification(bounty.id, hash);
  return (
    <div className={cx(" border p-3", rep.passed ? "border-ok/40" : "border-bad/40")}>
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={rep.passed ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}>{rep.passed ? "PASS" : "FAIL"}</Chip>
        <span className="text-sm font-semibold">score {rep.score}</span>
        {rep.procurement && <ProcurementTag />}
        <span className="text-xs text-muted">
          round {rep.round} · worker <Account id={rep.worker} /> · verifier <Account id={rep.verifier} />
        </span>
        <span className="ml-auto text-xs">
          verify_bounty tx <TxLink hash={verifyTx} />
        </span>
      </div>

      <div className="mt-2 grid gap-1 bg-panel-2 p-2 text-xs sm:grid-cols-2">
        <div>
          check_results_hash{onChain ? " (on-chain)" : " (earlier round)"}: <Mono title={hash}>{shortHash(hash, 12)}</Mono>
        </div>
        <div>
          recomputed sha256(canonical JSON): <Mono title={r.recomputed}>{shortHash(r.recomputed, 12)}</Mono>{" "}
          <Check ok={r.recomputed === hash}>{r.recomputed === hash ? "match" : "MISMATCH"}</Check>
        </div>
        <div>
          deliverable: <Mono title={rep.deliverable_hash}>{shortHash(rep.deliverable_hash, 10)}</Mono>{" "}
          <a className="text-accent-text hover:underline" href={`/api/offchain/${rep.deliverable_hash}`} target="_blank" rel="noreferrer">
            open
          </a>
        </div>
        <div>
          spec: <Mono title={rep.spec_hash}>{shortHash(rep.spec_hash, 10)}</Mono>{" "}
          <Check ok={rep.spec_hash === bounty.spec_hash}>{rep.spec_hash === bounty.spec_hash ? "matches bounty" : "differs from bounty"}</Check>
        </div>
      </div>

      <ol className="mt-3 space-y-1.5">
        {rep.checks.map((c, i) => (
          <li key={c.id} className="grid grid-cols-[1.25rem_5rem_3.5rem] items-start gap-x-2 text-sm sm:grid-cols-[1.25rem_5rem_4rem_1fr]">
            <span className="text-right font-mono text-xs text-muted">{i + 1}.</span>
            <span className="font-medium">{c.id}</span>
            <span>{c.skipped ? <Check ok={null}>skip</Check> : <Check ok={c.passed}>{c.passed ? "pass" : "fail"}</Check>}</span>
            <span className={cx("break-anywhere col-span-3 min-w-0 pl-7 text-xs sm:col-span-1 sm:pl-0", !c.passed && !c.skipped ? "text-bad" : "text-muted")}>
              {c.details} <span className="opacity-60">· {c.duration_ms}ms</span>
            </span>
          </li>
        ))}
      </ol>

      {rep.procurement && (
        <>
          <div className="mt-3">
            <ProposalFromHash hash={rep.deliverable_hash} />
          </div>
          <EvidenceTable ev={rep.procurement} />
        </>
      )}

      {rep.rubric && (
        <div className="mt-3">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="font-semibold text-ink">Rubric</span>
            <Chip tone={rep.rubric.mode === "llm" ? "bg-info-soft text-info" : "bg-panel-2 text-muted"}>
              {rep.rubric.mode === "llm" ? `LLM · ${rep.rubric.model ?? "unknown model"}` : "deterministic fallback"}
            </Chip>
            <span>
              total {rep.rubric.total} vs threshold {rep.rubric.threshold}{" "}
              <Check ok={rep.rubric.total >= rep.rubric.threshold}>{rep.rubric.total >= rep.rubric.threshold ? "above" : "below"}</Check>
            </span>
          </div>
          <table className="ledger w-full text-sm">
            <tbody>
              {rep.rubric.scores.map((s) => (
                <tr key={s.criterion} className="border-t border-dashed border-hair">
                  <td className="py-1 pr-2 font-medium">{s.criterion}</td>
                  <td className="hidden w-40 py-1 pr-2 sm:table-cell">
                    <div className="h-1.5 w-full bg-panel-2">
                      <div className="h-1.5 bg-accent" style={{ width: `${Math.max(0, Math.min(100, s.score))}%` }} />
                    </div>
                  </td>
                  <td className="w-10 py-1 pr-2 text-right font-mono text-xs">{s.score}</td>
                  <td className="break-anywhere py-1 text-xs text-muted">{s.rationale}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
