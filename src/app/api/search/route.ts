import { NextRequest, NextResponse } from "next/server";
import { geocodeLocation, searchPlaces } from "@/lib/google";
import { deriveWhatsappFromPhone, normalizeBrazilPhone } from "@/lib/contacts";
import type { BusinessResult, ContactSource, SearchResponse } from "@/lib/types";
import { checkRateLimit } from "@/lib/rateLimit";
import { discoverWebsiteByBusiness } from "@/lib/scraper";
import { getEnabledCategoryIds } from "@/lib/category-config";
import { enqueueEnrichment } from "@/lib/enrichment-queue";
import { getSearchCache, setSearchCache } from "@/lib/query-cache";
import { appendComplianceAudit, upsertLead } from "@/lib/storage";
import { trackLeadQualityMetric } from "@/lib/metrics";

const DEFAULT_LIMIT = Number(process.env.RATE_LIMIT_PER_MIN ?? 30);
const ENABLE_AUTO_PHONE_ENRICHMENT = process.env.ENABLE_AUTO_PHONE_ENRICHMENT === "true";
const SCRAPE_TIMEOUT_MS = Number(process.env.SCRAPE_TIMEOUT_MS ?? 3000);
const ENRICH_TOP_N = Number(process.env.ENRICH_TOP_N ?? 5);
const ENRICH_CONCURRENCY = Number(process.env.ENRICH_CONCURRENCY ?? 3);
const SEARCH_CACHE_TTL_MS = Number(process.env.SEARCH_CACHE_TTL_MS ?? 10 * 60 * 1000);
const LGPD_LEGAL_BASIS = process.env.LGPD_LEGAL_BASIS ?? "legitimate_interest_b2b";
const CONTACT_PURPOSE = process.env.CONTACT_PURPOSE ?? "prospeccao_comercial_b2b";
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

function buildSafePlaceId(item: { place_id?: string; name?: string; formatted_address?: string }, index: number): string {
  if (item.place_id?.trim()) return item.place_id;
  const base = `${item.name ?? "empresa"}|${item.formatted_address ?? "endereco"}|${index}`
    .trim()
    .toLowerCase()
    .replaceAll(/\s+/g, "-")
    .replaceAll(/[^a-z0-9\-|]/g, "");
  return `fallback-${base || index}`;
}

function contactConfidence(phoneSource?: ContactSource, whatsappSource?: ContactSource): "high" | "medium" | "low" {
  const highSources = new Set<ContactSource>(["osm", "website_tel_link", "website_whatsapp_link"]);
  if ((phoneSource && highSources.has(phoneSource)) || (whatsappSource && highSources.has(whatsappSource))) {
    return "high";
  }
  if (phoneSource || whatsappSource) return "medium";
  return "low";
}

function buildMapsUrl(item: {
  name: string;
  formatted_address?: string;
  geometry?: { location?: { lat: number; lng: number } };
}): string {
  if (typeof item.geometry?.location?.lat === "number" && typeof item.geometry?.location?.lng === "number") {
    return `https://www.google.com/maps/search/?api=1&query=${item.geometry.location.lat},${item.geometry.location.lng}`;
  }
  const fallbackQuery = [item.name, item.formatted_address ?? ""].join(" ").trim();
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fallbackQuery)}`;
}

function resolveWhatsapp(
  phone: string | undefined,
  explicitWhatsapp: string | undefined,
  existingSource?: ContactSource,
): { whatsapp?: string; whatsappSource?: ContactSource } {
  const derivedWhatsapp = explicitWhatsapp ? undefined : deriveWhatsappFromPhone(phone);
  const finalWhatsapp = explicitWhatsapp ?? derivedWhatsapp;
  if (!finalWhatsapp) return { whatsapp: undefined, whatsappSource: existingSource };
  return {
    whatsapp: finalWhatsapp,
    whatsappSource: existingSource ?? "derived_from_phone",
  };
}

async function enrichBusinessContact(
  item: {
    name: string;
    formatted_address?: string;
    tags?: Record<string, string>;
  },
  index: number,
  options: {
    pageToken?: string;
    shouldAutoEnrich: boolean;
  },
): Promise<{
  phone?: string;
  phoneSource?: ContactSource;
  email?: string;
  website?: string;
  explicitWhatsapp?: string;
  whatsappSource?: ContactSource;
}> {
  const tags = item.tags;
  let phone = normalizeBrazilPhone(tags?.["contact:phone"] ?? tags?.phone);
  let phoneSource: ContactSource | undefined = phone ? "osm" : undefined;
  let website = tags?.["contact:website"] ?? tags?.website;
  const email = tags?.["contact:email"] ?? tags?.email;
  let explicitWhatsapp: string | undefined;
  let whatsappSource: ContactSource | undefined;
  // Busca principal nao bloqueia mais por scraping. Enriquecimento entra em fila assincrona.
  if (!website && options.shouldAutoEnrich && !options.pageToken && index < ENRICH_TOP_N) {
    website = await discoverWebsiteByBusiness(item.name, item.formatted_address ?? "", SCRAPE_TIMEOUT_MS);
  }

  return { phone, phoneSource, email, website, explicitWhatsapp, whatsappSource };
}

async function mapBusinessResult(
  item: {
    place_id?: string;
    name: string;
    formatted_address?: string;
    geometry?: { location?: { lat: number; lng: number } };
    tags?: Record<string, string>;
  },
  index: number,
  options: {
    pageToken?: string;
    shouldAutoEnrich: boolean;
  },
): Promise<BusinessResult> {
  const enriched = await enrichBusinessContact(item, index, options);
  const whatsapp = resolveWhatsapp(enriched.phone, enriched.explicitWhatsapp, enriched.whatsappSource);
  const dataSource = enriched.phoneSource ?? whatsapp.whatsappSource ?? "unknown";
  let enrichmentJobId: string | undefined;
  let enrichmentStatus: BusinessResult["enrichmentStatus"];
  const shouldQueueEnrichment = options.shouldAutoEnrich && !options.pageToken && index < ENRICH_TOP_N && !enriched.phone;
  if (shouldQueueEnrichment) {
    const queued = await enqueueEnrichment({
      leadId: buildSafePlaceId(item, index),
      name: item.name,
      address: item.formatted_address ?? "Endereco nao informado",
      website: enriched.website,
      timeoutMs: SCRAPE_TIMEOUT_MS,
    });
    enrichmentJobId = queued.jobId;
    enrichmentStatus = "queued";
  }
  return {
    placeId: buildSafePlaceId(item, index),
    name: item.name,
    address: item.formatted_address ?? "Endereco nao informado",
    location: item.geometry?.location,
    phone: enriched.phone,
    phoneSource: enriched.phoneSource,
    whatsapp: whatsapp.whatsapp,
    whatsappSource: whatsapp.whatsappSource,
    contactConfidence: contactConfidence(enriched.phoneSource, whatsapp.whatsappSource),
    enrichmentJobId,
    enrichmentStatus,
    email: enriched.email,
    website: enriched.website,
    mapsUrl: buildMapsUrl(item),
    dataSource,
    legalBasis: LGPD_LEGAL_BASIS,
    contactPurpose: CONTACT_PURPOSE,
  };
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

    if (!location || !category) {
      return NextResponse.json({ error: "Informe localizacao e categoria." }, { status: 400 });
    }
    const normalizedCategory = category.toLowerCase();
    const enabledCategories = new Set(await getEnabledCategoryIds());
    if (!enabledCategories.has(normalizedCategory)) {
      return NextResponse.json({ error: "Categoria desabilitada nas configuracoes." }, { status: 400 });
    }
    const cacheKey = JSON.stringify({
      location: location.trim().toLowerCase(),
      category: normalizedCategory,
      pageToken: pageToken ?? "",
      autoEnrich: ENABLE_AUTO_PHONE_ENRICHMENT,
      enrichTopN: ENRICH_TOP_N,
    });
    const cachedSearch = await getSearchCache(cacheKey);
    if (cachedSearch) {
      return NextResponse.json(cachedSearch.response);
    }

    let lat: number | undefined;
    let lng: number | undefined;
    let bbox: { south: number; west: number; north: number; east: number } | undefined;
    let radiusM: number | undefined;
    if (location) {
      const coords = await geocodeLocation(location);
      lat = coords?.lat;
      lng = coords?.lng;
      bbox = coords?.bbox;
      const precision = coords?.precisionType?.toLowerCase() ?? "";
      if (precision === "suburb" || precision === "quarter" || precision === "neighbourhood") {
        radiusM = 6000;
      } else if (precision === "city" || precision === "town" || precision === "municipality") {
        // City-wide fallback when geocoder does not provide a usable bbox.
        radiusM = 35000;
      } else if (precision === "state") {
        radiusM = 120000;
      } else if (precision === "country") {
        radiusM = 300000;
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
      locationText: location,
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

    const baseResults = searchResponse.results as Array<{
      place_id?: string;
      name: string;
      formatted_address?: string;
      geometry?: { location?: { lat: number; lng: number } };
      tags?: Record<string, string>;
    }>;
    const results: BusinessResult[] = await mapWithConcurrency(baseResults, ENRICH_CONCURRENCY, (item, index) =>
      mapBusinessResult(item, index, {
        pageToken,
        shouldAutoEnrich: ENABLE_AUTO_PHONE_ENRICHMENT,
      }),
    );
    await Promise.all(
      results.map(async (result) => {
        await upsertLead(result.placeId, result, result.dataSource, LGPD_LEGAL_BASIS, CONTACT_PURPOSE);
        await appendComplianceAudit(result.placeId, result.dataSource, LGPD_LEGAL_BASIS, CONTACT_PURPOSE, {
          location,
          category: normalizedCategory,
          pageToken: pageToken ?? null,
        });
        await trackLeadQualityMetric({
          category: normalizedCategory,
          hasPhone: Boolean(result.phone),
          hasWhatsapp: Boolean(result.whatsapp),
          responseStatus: searchResponse.status === "OK" ? "ok" : "zero_results",
        });
      }),
    );

    const payload: SearchResponse = {
      results,
      nextPageToken: searchResponse.next_page_token,
    };
    await setSearchCache(
      cacheKey,
      {
        response: payload,
        compliance: {
          legalBasis: LGPD_LEGAL_BASIS,
          purpose: CONTACT_PURPOSE,
        },
      },
      SEARCH_CACHE_TTL_MS,
    );

    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha inesperada na busca.";
    await trackLeadQualityMetric({
      category: "unknown",
      hasPhone: false,
      hasWhatsapp: false,
      responseStatus: "error",
    });
    await debugLog("src/app/api/search/route.ts:95", "search route exception", { message }, "H4");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
