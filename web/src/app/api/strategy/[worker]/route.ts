import { NextResponse } from "next/server";
import { readStrategy } from "@/lib/server/data";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ worker: string }> }) {
  const { worker } = await ctx.params;
  return NextResponse.json(readStrategy(decodeURIComponent(worker))[decodeURIComponent(worker)] ?? []);
}
