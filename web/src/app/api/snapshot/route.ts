import { NextResponse } from "next/server";
import { getWebConfig, loadSampleSnapshot } from "@/lib/server/data";

export const dynamic = "force-dynamic";

/** Sample snapshot, served only when no deployment exists. Live mode reads the chain from the browser. */
export function GET() {
  if (getWebConfig().mode === "live") {
    return NextResponse.json({ error: "live mode: read the contract views via RPC" }, { status: 409 });
  }
  const snap = loadSampleSnapshot();
  if (!snap) return NextResponse.json({ error: "no sample snapshot found" }, { status: 404 });
  return NextResponse.json(snap);
}
