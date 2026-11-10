import { NextResponse } from "next/server";
import { readIndex } from "@/lib/server/data";

export const dynamic = "force-dynamic";

/** Off-chain store index (kind, bounty_id, round, actor per hash). ?bounty_id= & ?kind= filter it. */
export function GET(req: Request) {
  const url = new URL(req.url);
  const bounty = url.searchParams.get("bounty_id");
  const kind = url.searchParams.get("kind");
  let rows = readIndex();
  if (bounty != null) rows = rows.filter((r) => r.bounty_id === Number(bounty));
  if (kind) rows = rows.filter((r) => r.kind === kind);
  return NextResponse.json(rows);
}
