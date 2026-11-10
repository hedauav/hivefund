"use client";

import { useEffect, useState } from "react";
import type { Bounty, BountySpec, ProcurementEvidence, ProcurementSpec, VerificationReport } from "@hivefund/shared";
import { loadOffchain } from "./use-offchain";

export interface ProcurementInfo {
  spec: ProcurementSpec;
  /** evidence from the report whose hash is on-chain (latest verification), if any */
  evidence: ProcurementEvidence | null;
  passed: boolean | null;
}

/**
 * Which bounties are procurement bounties, keyed by bounty id. Reads each bounty's spec (and its latest
 * on-chain report) by hash; both are re-hashed in the browser before use.
 */
export function useProcurement(bounties: Bounty[] | undefined): Map<number, ProcurementInfo> {
  const [map, setMap] = useState<Map<number, ProcurementInfo>>(() => new Map());
  const key = (bounties ?? []).map((b) => `${b.id}:${b.spec_hash}:${b.check_results_hash ?? ""}`).join("|");

  useEffect(() => {
    if (!bounties?.length) return;
    let cancelled = false;
    Promise.all(
      bounties.map(async (b) => {
        const spec = await loadOffchain<BountySpec>(b.spec_hash);
        if (!spec?.procurement) return null;
        const rep = b.check_results_hash ? await loadOffchain<VerificationReport>(b.check_results_hash) : null;
        const info: ProcurementInfo = { spec: spec.procurement, evidence: rep?.procurement ?? null, passed: rep ? rep.passed : null };
        return [b.id, info] as const;
      }),
    ).then((rows) => {
      if (cancelled) return;
      setMap(new Map(rows.filter((r): r is readonly [number, ProcurementInfo] => r !== null)));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures every field we read
  }, [key]);

  return map;
}

/** Procurement evidence per verification report hash (reports are re-hashed before use). */
export function useEvidenceByReport(hashes: string[]): Map<string, ProcurementEvidence> {
  const [map, setMap] = useState<Map<string, ProcurementEvidence>>(() => new Map());
  const key = [...new Set(hashes)].sort().join(",");
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    Promise.all(
      key.split(",").map(async (h) => {
        const rep = await loadOffchain<VerificationReport>(h);
        return rep?.procurement ? ([h, rep.procurement] as const) : null;
      }),
    ).then((rows) => {
      if (!cancelled) setMap(new Map(rows.filter((r): r is readonly [string, ProcurementEvidence] => r !== null)));
    });
    return () => {
      cancelled = true;
    };
  }, [key]);
  return map;
}
