import { NextResponse } from "next/server";
import { getLeadQualitySummary } from "@/lib/metrics";

export async function GET() {
  const summary = await getLeadQualitySummary();
  return NextResponse.json(summary);
}

