"use client";

import Link from "next/link";
import type { VerificationReport } from "@hivefund/shared";
import { EvidenceTable, ProcurementRequest, ProcurementTag, ProposalView } from "@/components/procurement-view";
import { Card, Check, Chip, cx } from "@/components/ui";
import { FIXTURE_DELIVERABLE, FIXTURE_REPORT_FAIL, FIXTURE_REPORT_PASS, FIXTURE_SPEC } from "./fixture";

export function PreviewStory() {
  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm text-accent-text hover:underline">
        ← Dashboard
      </Link>
      <div className="border-[1.5px] border-bad bg-bad-soft px-4 py-2 font-mono text-xs font-semibold uppercase tracking-wide text-bad">
        Fixture preview — illustrative values, not a real run. Real procurement bounties render the same panels from on-chain hashes.
      </div>
      <Card n="§" title={<>Procurement bounty <ProcurementTag /></>} subtitle="what the buyer asks for">
        <ProcurementRequest p={FIXTURE_SPEC} />
      </Card>
      <Card n="04" title="Verification (fixture)" subtitle="live catalog re-fetch, then delivery call, then rubric">
        <div className="space-y-4">
          <FixtureReport rep={FIXTURE_REPORT_FAIL} withProposal={false} />
          <FixtureReport rep={FIXTURE_REPORT_PASS} withProposal />
        </div>
      </Card>
    </div>
  );
}

function FixtureReport({ rep, withProposal }: { rep: VerificationReport; withProposal: boolean }) {
  return (
    <div className={cx("border p-3", rep.passed ? "border-ok/40" : "border-bad/40")}>
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={rep.passed ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}>{rep.passed ? "PASS" : "FAIL"}</Chip>
        <span className="text-sm font-semibold">score {rep.score}</span>
        <ProcurementTag />
        <span className="text-xs text-muted">
          round {rep.round} · {rep.worker.split(".")[0]}
        </span>
      </div>
      <ol className="mt-3 space-y-1">
        {rep.checks.map((c, i) => (
          <li key={c.id} className="grid grid-cols-[1.25rem_5rem_3.5rem] gap-x-2 text-sm sm:grid-cols-[1.25rem_5rem_4rem_minmax(0,1fr)]">
            <span className="text-right font-mono text-xs text-muted">{i + 1}.</span>
            <span className="font-medium">{c.id}</span>
            <span>{c.skipped ? <Check ok={null}>skip</Check> : <Check ok={c.passed}>{c.passed ? "pass" : "fail"}</Check>}</span>
            <span className={cx("break-anywhere col-span-3 min-w-0 pl-7 text-xs sm:col-span-1 sm:pl-0", !c.passed && !c.skipped ? "text-bad" : "text-muted")}>{c.details}</span>
          </li>
        ))}
      </ol>
      {withProposal && (
        <div className="mt-3">
          <ProposalView d={FIXTURE_DELIVERABLE} />
        </div>
      )}
      {rep.procurement && <EvidenceTable ev={rep.procurement} />}
    </div>
  );
}
