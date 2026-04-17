import { NextRequest, NextResponse } from "next/server";
import { enqueueEnrichment, getEnrichmentJob } from "@/lib/enrichment-queue";

const SCRAPE_TIMEOUT_MS = Number(process.env.SCRAPE_TIMEOUT_MS ?? 3000);

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      leadId?: string;
      name?: string;
      address?: string;
      website?: string;
      timeoutMs?: number;
    };
    if (!body.leadId || !body.name || !body.address) {
      return NextResponse.json({ error: "Informe leadId, name e address." }, { status: 400 });
    }
    const result = await enqueueEnrichment({
      leadId: body.leadId,
      name: body.name,
      address: body.address,
      website: body.website,
      timeoutMs: body.timeoutMs ?? SCRAPE_TIMEOUT_MS,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao enfileirar enriquecimento.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId")?.trim();
  if (!jobId) {
    return NextResponse.json({ error: "Informe jobId." }, { status: 400 });
  }
  const job = await getEnrichmentJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job nao encontrado." }, { status: 404 });
  }
  return NextResponse.json(job);
}

