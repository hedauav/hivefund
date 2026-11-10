"use client";

import { useEffect, useState } from "react";
import { hashJson } from "@hivefund/shared";

export type OffchainState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "missing"; error: string }
  | { status: "mismatch"; error: string }
  | { status: "ok"; object: T; recomputed: string };

const cache = new Map<string, unknown>();

/**
 * Loads an off-chain object by its content hash and re-hashes it in the browser.
 * `status: "ok"` means sha256(canonical JSON) === the hash recorded on-chain.
 */
export function useOffchain<T>(hash: string | null | undefined): OffchainState<T> {
  const [result, setResult] = useState<{ hash: string; state: OffchainState<T> } | null>(null);

  useEffect(() => {
    if (!hash || cache.has(hash)) return;
    let cancelled = false;
    const done = (state: OffchainState<T>) => !cancelled && setResult({ hash, state });
    fetch(`/api/offchain/${hash}`, { cache: "no-store" })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (r.status === 409) return done({ status: "mismatch", error: body.error ?? "hash mismatch" });
        if (!r.ok) return done({ status: "missing", error: body.error ?? `HTTP ${r.status}` });
        const recomputed = hashJson(body.object);
        if (recomputed !== hash) return done({ status: "mismatch", error: `recomputed ${recomputed.slice(0, 12)}… ≠ on-chain hash` });
        cache.set(hash, body.object);
        done({ status: "ok", object: body.object as T, recomputed });
      })
      .catch((e) => done({ status: "missing", error: String(e) }));
    return () => {
      cancelled = true;
    };
  }, [hash]);

  if (!hash) return { status: "idle" };
  if (cache.has(hash)) return { status: "ok", object: cache.get(hash) as T, recomputed: hash };
  if (result?.hash === hash) return result.state;
  return { status: "loading" };
}
