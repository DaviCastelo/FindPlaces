import { NextRequest, NextResponse } from "next/server";
import { phoneToWhatsappLink } from "@/lib/contacts";
import { checkRateLimit } from "@/lib/rateLimit";
import { scrapeContactFromWebsite } from "@/lib/scraper";

const DEFAULT_LIMIT = Number(process.env.RATE_LIMIT_PER_MIN ?? 30);
const ENABLE_SCRAPING = process.env.ENABLE_SCRAPING === "true";
const SCRAPE_TIMEOUT_MS = Number(process.env.SCRAPE_TIMEOUT_MS ?? 5000);

export async function POST(req: NextRequest) {
  try {
    if (!ENABLE_SCRAPING) {
      return NextResponse.json({ error: "Scraping desabilitado no servidor." }, { status: 403 });
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (!checkRateLimit(`scrape:${ip}`, DEFAULT_LIMIT)) {
      return NextResponse.json({ error: "Muitas requisicoes. Tente novamente em alguns segundos." }, { status: 429 });
    }

    const body = (await req.json()) as { website?: string };
    const website = body.website?.trim();
    if (!website) {
      return NextResponse.json({ error: "Website nao informado." }, { status: 400 });
    }

    const data = await scrapeContactFromWebsite(website, SCRAPE_TIMEOUT_MS);
    return NextResponse.json({
      email: data.email,
      phone: data.phone,
      whatsapp: phoneToWhatsappLink(data.phone),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao extrair contatos.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
