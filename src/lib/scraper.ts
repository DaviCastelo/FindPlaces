import { extractFirstEmail, normalizeBrazilPhone } from "@/lib/contacts";
import type { ContactSource } from "@/lib/types";

const blockedSearchHosts = [
  "google.com/maps",
  "maps.google.",
  "facebook.com",
  "instagram.com",
  "youtube.com",
];
const telLinkRegex = /href=["']tel:([^"']+)["']/i;
const whatsappPhoneRegex = /(?:wa\.me\/|api\.whatsapp\.com\/send\?phone=)(\+?\d{10,14})/i;
const phoneRegex = /(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9?\d{4})[-\s]?\d{4}/;
const whatsappLinkRegex = /https?:\/\/(?:wa\.me\/\d+|api\.whatsapp\.com\/send\?phone=\d+)/i;

type ScrapedContact = {
  email?: string;
  phone?: string;
  whatsapp?: string;
  phoneSource?: ContactSource;
  whatsappSource?: ContactSource;
};

const websiteDiscoveryCache = new Map<string, { value: string | undefined; expiresAt: number }>();
const phoneScrapeCache = new Map<
  string,
  { value: ScrapedContact; expiresAt: number }
>();
const scraperCacheTtlMs = Number(process.env.SCRAPER_CACHE_TTL_MS ?? 30 * 60 * 1000);
const maxScrapePages = Number(process.env.SCRAPE_MAX_PAGES ?? 3);
const candidateContactPaths = ["/contato", "/fale-conosco", "/contatos", "/about", "/sobre"];

function pickFirstPhone(text?: string): { value?: string; source?: ContactSource } {
  if (!text) return {};
  const telLinkMatch = telLinkRegex.exec(text);
  if (telLinkMatch?.[1]) {
    const normalized = normalizeBrazilPhone(telLinkMatch[1]);
    if (normalized) return { value: normalized, source: "website_tel_link" };
  }
  const waMatch = whatsappPhoneRegex.exec(text);
  if (waMatch?.[1]) {
    const normalized = normalizeBrazilPhone(waMatch[1]);
    if (normalized) return { value: normalized, source: "website_whatsapp_link" };
  }
  const regexMatch = phoneRegex.exec(text);
  if (regexMatch?.[0]) {
    const normalized = normalizeBrazilPhone(regexMatch[0]);
    if (normalized) return { value: normalized, source: "website_regex" };
  }
  return {};
}

function pickWhatsappLink(text?: string): string | undefined {
  if (!text) return undefined;
  const match = whatsappLinkRegex.exec(text);
  return match?.[0];
}

function withPath(base: string, path: string): string | undefined {
  try {
    return new URL(path, base).toString();
  } catch {
    return undefined;
  }
}

async function fetchHtml(url: string, timeoutMs: number): Promise<string | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; LocalContactsBot/1.0)",
      },
    });
    if (!response.ok) return undefined;
    return await response.text();
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

export async function scrapeContactFromWebsite(url: string, timeoutMs: number): Promise<ScrapedContact> {
  const cacheKey = url.trim().toLowerCase();
  const cached = phoneScrapeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const pages: string[] = [url];
  for (const path of candidateContactPaths) {
    const resolved = withPath(url, path);
    if (resolved) pages.push(resolved);
  }
  const uniquePages = Array.from(new Set(pages)).slice(0, maxScrapePages);

  for (const pageUrl of uniquePages) {
    const html = await fetchHtml(pageUrl, timeoutMs);
    if (!html) continue;
    const email = extractFirstEmail(html);
    const phoneResult = pickFirstPhone(html);
    const phone = phoneResult?.value;
    const whatsapp = pickWhatsappLink(html);
    const value: ScrapedContact = {
      email,
      phone,
      whatsapp,
      phoneSource: phoneResult?.source,
      whatsappSource: whatsapp ? "website_whatsapp_link" : undefined,
    };
    if (value.email || value.phone || value.whatsapp) {
      phoneScrapeCache.set(cacheKey, { value, expiresAt: Date.now() + scraperCacheTtlMs });
      return value;
    }
  }
  return {};
}

export async function discoverWebsiteByBusiness(name: string, address: string, timeoutMs: number): Promise<string | undefined> {
  const cacheKey = `${name}|${address}`.trim().toLowerCase();
  const cached = websiteDiscoveryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const query = `${name} ${address} site oficial telefone`;
    const response = await fetch(`https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; LocalContactsBot/1.0)",
      },
    });
    if (!response.ok) return undefined;

    const html = await response.text();
    const links: string[] = [];
    const linkRegex = /uddg=([^"&]+)/g;
    let current = linkRegex.exec(html);
    while (current) {
      try {
        links.push(decodeURIComponent(current[1]));
      } catch {
        // ignore malformed uri
      }
      current = linkRegex.exec(html);
    }

    const selected = links.find((link) => {
      const normalized = link.toLowerCase();
      return normalized.startsWith("http") && !blockedSearchHosts.some((host) => normalized.includes(host));
    });
    websiteDiscoveryCache.set(cacheKey, { value: selected, expiresAt: Date.now() + scraperCacheTtlMs });
    return selected;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}
