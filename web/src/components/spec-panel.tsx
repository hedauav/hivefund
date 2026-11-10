"use client";

import type { Bounty, BountySpec } from "@hivefund/shared";
import { useOffchain } from "@/hooks/use-offchain";
import { near, shortHash } from "@/lib/format";
import { Card, Check, Mono } from "./ui";

export function SpecPanel({ bounty }: { bounty: Bounty }) {
  const s = useOffchain<BountySpec>(bounty.spec_hash);
  return (
    <Card
      id="spec"
      title="Acceptance spec"
      subtitle={
        <>
          spec_hash <Mono title={bounty.spec_hash}>{shortHash(bounty.spec_hash, 10)}</Mono>{" "}
          {s.status === "ok" ? <Check ok>re-hashed in browser</Check> : s.status === "loading" ? "loading…" : s.status !== "idle" ? <Check ok={false}>{s.error}</Check> : null}
        </>
      }
    >
      {s.status !== "ok" ? (
        <p className="text-sm text-muted">The spec object is stored off-chain and addressed by the hash above.</p>
      ) : (
        <div className="space-y-3 text-sm">
          <p>{s.object.description}</p>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
            <dt className="text-muted">Budget</dt>
            <dd>{near(s.object.budget_yocto)}</dd>
            <dt className="text-muted">Min tier</dt>
            <dd>{s.object.min_tier}</dd>
            <dt className="text-muted">Required sections</dt>
            <dd className="font-mono">{s.object.required_sections.join(", ")}</dd>
            <dt className="text-muted">Test command</dt>
            <dd className="font-mono">{s.object.test ? `node bounties/${s.object.test.file} <deliverable> (timeout ${s.object.test.timeout_ms}ms)` : "none"}</dd>
            <dt className="text-muted">Rubric</dt>
            <dd>
              {s.object.rubric.criteria.map((c) => `${c.id} ×${c.weight}`).join(" · ")} — pass ≥ {s.object.rubric.pass_threshold}
            </dd>
          </dl>
          <details className="rounded-md bg-panel-2 p-2 text-xs">
            <summary className="cursor-pointer text-muted">Deliverable JSON schema</summary>
            <pre className="mt-2 overflow-x-auto font-mono">{JSON.stringify(s.object.deliverable_schema, null, 2)}</pre>
          </details>
        </div>
      )}
    </Card>
  );
}
