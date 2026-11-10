import { NextResponse } from "next/server";
import { getWebConfig } from "@/lib/server/data";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getWebConfig());
}
