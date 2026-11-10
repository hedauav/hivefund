import { NextResponse } from "next/server";
import { readTxLog } from "@/lib/server/data";

export const dynamic = "force-dynamic";

/** Agents' transaction log (method, args, txHash) used to link items to nearblocks. */
export function GET() {
  return NextResponse.json(readTxLog());
}
