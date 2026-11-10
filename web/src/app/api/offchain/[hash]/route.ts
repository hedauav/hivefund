import { NextResponse } from "next/server";
import { readOffchain } from "@/lib/server/data";

export const dynamic = "force-dynamic";

/**
 * Content-addressed off-chain object. The server re-hashes the stored canonical
 * JSON and refuses to serve it if sha256 != requested hash. The client re-hashes
 * again before showing a ✓.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ hash: string }> }) {
  const { hash } = await ctx.params;
  const r = readOffchain(hash.toLowerCase());
  if (r.status === "missing") return NextResponse.json({ hash, error: "not found in off-chain store" }, { status: 404 });
  if (r.status === "mismatch") {
    return NextResponse.json({ hash, recomputed: r.recomputed, error: "hash mismatch: stored object was altered" }, { status: 409 });
  }
  return NextResponse.json({ hash, verified: true, object: r.object });
}
