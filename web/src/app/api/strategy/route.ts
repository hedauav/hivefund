import { NextResponse } from "next/server";
import { readStrategy } from "@/lib/server/data";

export const dynamic = "force-dynamic";

/** All workers' strategy-change logs, keyed by worker account. */
export function GET() {
  return NextResponse.json(readStrategy());
}
