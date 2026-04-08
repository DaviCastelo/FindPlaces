type OsmElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

type OverpassResponse = {
  elements: OsmElement[];
};

type OsmSearchResponse = {
  place_id: number;
  lat: string;
  lon: string;
  addresstype?: string;
  boundingbox?: [string, string, string, string];
};

type PhotonResponse = {
  features?: Array<{
    geometry?: { coordinates?: [number, number] };
  }>;
};

const pageSize = Number(process.env.SEARCH_PAGE_SIZE ?? 50);
const searchRadiusM = Number(process.env.DEFAULT_SEARCH_RADIUS_M ?? 35000);
const cacheTtlMs = Number(process.env.SEARCH_CACHE_TTL_MS ?? 10 * 60 * 1000);
const overpassEndpoints = [
  "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const geocodeCache = new Map<
  string,
  {
    value:
      | {
          lat: number;
          lng: number;
          bbox?: { south: number; west: number; north: number; east: number };
          precisionType?: string;
        }
      | undefined;
    expiresAt: number;
  }
>();
const placesCache = new Map<
  string,
  {
    value: {
      status: string;
      next_page_token?: string;
      results: Array<{
        place_id: string;
        name: string;
        formatted_address?: string;
        geometry?: { location?: { lat: number; lng: number } };
        tags?: Record<string, string>;
      }>;
    };
    expiresAt: number;
  }
>();
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

const categoryMap: Record<string, string[]> = {
  academia: ['"leisure"="fitness_centre"', '"shop"="sports"'],
  padaria: ['"shop"="bakery"'],
  lanchonete: ['"amenity"="fast_food"', '"amenity"="cafe"'],
  restaurante: ['"amenity"="restaurant"'],
  mercado: ['"shop"="supermarket"', '"shop"="convenience"'],
  farmacia: ['"amenity"="pharmacy"', '"shop"="chemist"'],
  "salão de beleza": ['"shop"="beauty"', '"shop"="hairdresser"', '"amenity"="beauty_salon"'],
};

function overpassFilter(category: string): string[] {
  return categoryMap[category.toLowerCase()] ?? ['"name"'];
}

function elementCoords(element: OsmElement): { lat: number; lng: number } | undefined {
  if (typeof element.lat === "number" && typeof element.lon === "number") {
    return { lat: element.lat, lng: element.lon };
  }
  if (element.center) {
    return { lat: element.center.lat, lng: element.center.lon };
  }
  return undefined;
}

function elementAddress(tags?: Record<string, string>): string {
  if (!tags) return "Endereco nao informado";
  const street = tags["addr:street"];
  const number = tags["addr:housenumber"];
  const suburb = tags["addr:suburb"];
  const city = tags["addr:city"] ?? tags["addr:town"] ?? tags["addr:village"];
  const state = tags["addr:state"];
  const pieces = [street, number, suburb, city, state].filter(Boolean);
  return pieces.length ? pieces.join(", ") : "Endereco nao informado";
}

export async function geocodeLocation(query: string): Promise<
  | {
      lat: number;
      lng: number;
      bbox?: { south: number; west: number; north: number; east: number };
      precisionType?: string;
    }
  | undefined
> {
  const cacheKey = query.trim().toLowerCase();
  const locationQuery = `${query}, Brasil`;
  const cached = geocodeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const nominatim = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=br&q=${encodeURIComponent(locationQuery)}`,
    {
      cache: "no-store",
      headers: { "user-agent": "local-contacts-app/1.0 (nominatim-geocoder)" },
    },
  );
  if (nominatim.ok) {
    const data = (await nominatim.json()) as OsmSearchResponse[];
    await debugLog("src/lib/google.ts:97", "nominatim response", { ok: nominatim.ok, resultCount: data.length, query }, "H2");
    if (data.length) {
      const first = data[0];
      const bbox = first.boundingbox?.length === 4
        ? {
            south: Number(first.boundingbox[0]),
            north: Number(first.boundingbox[1]),
            west: Number(first.boundingbox[2]),
            east: Number(first.boundingbox[3]),
          }
        : undefined;
      const value = { lat: Number(first.lat), lng: Number(first.lon), bbox, precisionType: first.addresstype };
      geocodeCache.set(cacheKey, { value, expiresAt: Date.now() + cacheTtlMs });
      return value;
    }
  } else {
    await debugLog("src/lib/google.ts:102", "nominatim non-ok", { ok: nominatim.ok, status: nominatim.status, query }, "H2");
  }

  const photon = await fetch(`https://photon.komoot.io/api/?limit=1&lang=pt&q=${encodeURIComponent(locationQuery)}`, {
    cache: "no-store",
  });
  if (!photon.ok) {
    await debugLog("src/lib/google.ts:110", "photon non-ok", { ok: photon.ok, status: photon.status, query }, "H2");
    geocodeCache.set(cacheKey, { value: undefined, expiresAt: Date.now() + 60_000 });
    return undefined;
  }
  const photonData = (await photon.json()) as PhotonResponse;
  const coordinates = photonData.features?.[0]?.geometry?.coordinates;
  await debugLog("src/lib/google.ts:115", "photon response", { hasCoordinates: Boolean(coordinates), query }, "H2");
  if (!coordinates) {
    geocodeCache.set(cacheKey, { value: undefined, expiresAt: Date.now() + 60_000 });
    return undefined;
  }
  const value = { lat: coordinates[1], lng: coordinates[0], precisionType: "fallback" };
  geocodeCache.set(cacheKey, { value, expiresAt: Date.now() + cacheTtlMs });
  return value;
}

export async function searchPlaces(params: {
  category: string;
  lat?: number;
  lng?: number;
  radiusM?: number;
  bbox?: { south: number; west: number; north: number; east: number };
  pageToken?: string;
}) {
  const cacheKey = JSON.stringify({
    category: params.category.trim().toLowerCase(),
    lat: params.lat,
    lng: params.lng,
    radiusM: params.radiusM,
    bbox: params.bbox,
    pageToken: params.pageToken ?? "0",
  });
  const cached = placesCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  await debugLog(
    "src/lib/google.ts:127",
    "searchPlaces input",
    {
      category: params.category,
      lat: params.lat,
      lng: params.lng,
      radiusM: params.radiusM,
      bbox: params.bbox,
      pageToken: params.pageToken,
    },
    "H1",
  );
  if (typeof params.lat !== "number" || typeof params.lng !== "number") {
    return { status: "ZERO_RESULTS", next_page_token: undefined, results: [] };
  }

  const filters = overpassFilter(params.category);
  await debugLog("src/lib/google.ts:136", "resolved overpass filters", { category: params.category, filters }, "H1");
  const radius = params.radiusM ?? searchRadiusM;
  const block = filters
    .map((filter) => {
      if (params.bbox) {
        const { south, west, north, east } = params.bbox;
        return `
        node[${filter}](${south},${west},${north},${east});
        way[${filter}](${south},${west},${north},${east});
        relation[${filter}](${south},${west},${north},${east});`;
      }
      return `
        node[${filter}](around:${radius},${params.lat},${params.lng});
        way[${filter}](around:${radius},${params.lat},${params.lng});
        relation[${filter}](around:${radius},${params.lat},${params.lng});`;
    })
    .join("\n");

  const query = `[out:json][timeout:25];
(
${block}
);
out center tags;`;

  let response: Response | undefined;
  let lastStatus: number | undefined;
  for (const endpoint of overpassEndpoints) {
    await debugLog("src/lib/google.ts:163", "overpass endpoint attempt", { endpoint }, "H4", "post-fix");
    const current = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: query,
      cache: "no-store",
    });
    if (current.ok) {
      response = current;
      await debugLog("src/lib/google.ts:172", "overpass endpoint success", { endpoint, status: current.status }, "H4", "post-fix");
      break;
    }
    lastStatus = current.status;
    await debugLog("src/lib/google.ts:177", "overpass endpoint non-ok", { endpoint, status: current.status }, "H4", "post-fix");
  }

  if (!response) {
    throw new Error(`Overpass API indisponivel nos mirrors. Ultimo status: ${lastStatus ?? "desconhecido"}`);
  }

  const data = (await response.json()) as OverpassResponse;
  const offset = Number(params.pageToken ?? 0) || 0;
  const mapped = data.elements
    .filter((element) => element.tags?.name)
    .map((element) => {
      const coords = elementCoords(element);
      return {
        place_id: `${element.type}-${element.id}`,
        name: element.tags?.name ?? "Empresa sem nome",
        formatted_address: elementAddress(element.tags),
        geometry: { location: coords },
        tags: element.tags,
      };
    });
  mapped.sort((a, b) => a.place_id.localeCompare(b.place_id));

  const paged = mapped.slice(offset, offset + pageSize);
  const nextOffset = offset + pageSize < mapped.length ? String(offset + pageSize) : undefined;
  await debugLog(
    "src/lib/google.ts:180",
    "overpass mapping summary",
    { rawCount: data.elements.length, mappedCount: mapped.length, pagedCount: paged.length, offset, nextOffset },
    "H3",
  );

  const value = {
    status: paged.length ? "OK" : "ZERO_RESULTS",
    next_page_token: nextOffset,
    results: paged,
  };
  placesCache.set(cacheKey, { value, expiresAt: Date.now() + cacheTtlMs });
  return value;
}

