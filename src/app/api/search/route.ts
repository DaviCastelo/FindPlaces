import { NextRequest, NextResponse } from "next/server";
import { geocodeLocation, searchPlaces } from "@/lib/google";
import { phoneToWhatsappLink } from "@/lib/contacts";
import type { BusinessResult, SearchResponse } from "@/lib/types";
import { checkRateLimit } from "@/lib/rateLimit";
import { discoverWebsiteByBusiness, scrapeContactFromWebsite } from "@/lib/scraper";

const DEFAULT_LIMIT = Number(process.env.RATE_LIMIT_PER_MIN ?? 30);
const ENABLE_AUTO_PHONE_ENRICHMENT = process.env.ENABLE_AUTO_PHONE_ENRICHMENT === "true";
const SCRAPE_TIMEOUT_MS = Number(process.env.SCRAPE_TIMEOUT_MS ?? 3000);
const ENRICH_TOP_N = Number(process.env.ENRICH_TOP_N ?? 5);
const ENRICH_CONCURRENCY = Number(process.env.ENRICH_CONCURRENCY ?? 3);
async function debugLog(
  location: string,
  message: string,
  data: Record<string, unknown>,
  hypothesisId: string,
  runId = "pre-fix",
) {
  if (process.env.DEBUG_RUNTIME_LOGS !== "true") return;
  // #region agent log
  await fetch("http://127.0.0.1:7879/ingest/9fbfc955-983d-43b8-80bb-b7b631f98ff4", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "b67ce5" },
    body: JSON.stringify({
      sessionId: "b67ce5",
      runId,
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const safeConcurrency = Math.max(1, concurrency);
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const current = cursor;
      cursor += 1;
      if (current >= items.length) break;
      out[current] = await fn(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(safeConcurrency, items.length) }, () => worker()));
  return out;
}

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (!checkRateLimit(`search:${ip}`, DEFAULT_LIMIT)) {
      return NextResponse.json({ error: "Muitas requisicoes. Tente novamente em alguns segundos." }, { status: 429 });
    }

    const body = (await req.json()) as { location?: string; category?: string; pageToken?: string };
    const location = body.location?.trim();
    const category = body.category?.trim();
    const pageToken = body.pageToken?.trim();
    await debugLog(
      "src/app/api/search/route.ts:40",
      "search request payload",
      { hasLocation: Boolean(location), category, pageToken },
      "H1",
    );

    if (!pageToken && (!location || !category)) {
      return NextResponse.json({ error: "Informe localizacao e categoria." }, { status: 400 });
    }

    let lat: number | undefined;
    let lng: number | undefined;
    let bbox: { south: number; west: number; north: number; east: number } | undefined;
    let radiusM: number | undefined;
    if (location && !pageToken) {
      const coords = await geocodeLocation(location);
      lat = coords?.lat;
      lng = coords?.lng;
      bbox = coords?.bbox;
      const precision = coords?.precisionType?.toLowerCase() ?? "";
      if (precision === "suburb" || precision === "quarter" || precision === "neighbourhood") {
        radiusM = 3000;
      } else if (precision === "city" || precision === "town" || precision === "municipality") {
        radiusM = 12000;
      } else if (precision === "state") {
        radiusM = 50000;
      } else if (precision === "country") {
        radiusM = 80000;
      }
    }
    await debugLog(
      "src/app/api/search/route.ts:54",
      "resolved coordinates",
      { lat, lng, bbox, radiusM, location, pageToken },
      "H2",
    );

    const searchResponse = await searchPlaces({
      category: category ?? "",
      lat,
      lng,
      bbox,
      radiusM,
      pageToken,
    });

    if (searchResponse.status !== "OK" && searchResponse.status !== "ZERO_RESULTS") {
      return NextResponse.json({ error: `Busca de locais retornou ${searchResponse.status}` }, { status: 400 });
    }
    await debugLog(
      "src/app/api/search/route.ts:69",
      "search response summary",
      { status: searchResponse.status, count: searchResponse.results.length, nextPageToken: searchResponse.next_page_token },
      "H3",
    );

    const baseResults = searchResponse.results.slice(0, 20);
    const results: BusinessResult[] = await mapWithConcurrency(baseResults, ENRICH_CONCURRENCY, async (item, index) => {
        const tags = (item as { tags?: Record<string, string> }).tags;
        let phone = tags?.["contact:phone"] ?? tags?.phone;
        let website = tags?.["contact:website"] ?? tags?.website;
        const email = tags?.["contact:email"] ?? tags?.email;

        const shouldEnrich = ENABLE_AUTO_PHONE_ENRICHMENT && !pageToken && index < ENRICH_TOP_N;
        if (shouldEnrich && !phone) {
          if (!website) {
            website = await discoverWebsiteByBusiness(item.name, item.formatted_address ?? "", SCRAPE_TIMEOUT_MS);
          }
          if (website) {
            const scraped = await scrapeContactFromWebsite(website, SCRAPE_TIMEOUT_MS);
            phone = scraped.phone ?? phone;
          }
        }

        return {
          placeId: item.place_id,
          name: item.name,
          address: item.formatted_address ?? "Endereco nao informado",
          location: item.geometry?.location,
          phone,
          whatsapp: phoneToWhatsappLink(phone),
          email,
          website,
          mapsUrl:
            typeof item.geometry?.location?.lat === "number" && typeof item.geometry?.location?.lng === "number"
              ? `https://www.google.com/maps/search/?api=1&query=${item.geometry.location.lat},${item.geometry.location.lng}`
              : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${item.name} ${item.formatted_address ?? ""}`.trim())}`,
        };
      });

    const payload: SearchResponse = {
      results,
      nextPageToken: searchResponse.next_page_token,
    };

    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha inesperada na busca.";
    await debugLog("src/app/api/search/route.ts:95", "search route exception", { message }, "H4");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
