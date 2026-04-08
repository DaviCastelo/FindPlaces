import { extractFirstEmail, normalizeBrazilPhone } from "@/lib/contacts";

const blockedSearchHosts = [
  "google.com/maps",
  "maps.google.",
  "facebook.com",
  "instagram.com",
  "youtube.com",
];
const websiteDiscoveryCache = new Map<string, { value: string | undefined; expiresAt: number }>();
const phoneScrapeCache = new Map<string, { value: { email?: string; phone?: string }; expiresAt: number }>();
const scraperCacheTtlMs = Number(process.env.SCRAPER_CACHE_TTL_MS ?? 30 * 60 * 1000);

function pickFirstPhone(text?: string): string | undefined {
  if (!text) return undefined;
  const match = text.match(/(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9?\d{4})[-\s]?\d{4}/);
  return match ? normalizeBrazilPhone(match[0]) : undefined;
}

export async function scrapeContactFromWebsite(url: string, timeoutMs: number) {
  const cacheKey = url.trim().toLowerCase();
  const cached = phoneScrapeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

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

    if (!response.ok) return {};
    const html = await response.text();
    const email = extractFirstEmail(html);
    const phone = pickFirstPhone(html);

    const value = { email, phone };
    phoneScrapeCache.set(cacheKey, { value, expiresAt: Date.now() + scraperCacheTtlMs });
    return value;
  } catch {
    return {};
  } finally {
    clearTimeout(timeout);
  }
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
