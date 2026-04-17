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

type NominatimPoiResponse = Array<{
  osm_id?: number;
  osm_type?: "node" | "way" | "relation";
  display_name?: string;
  name?: string;
  lat?: string;
  lon?: string;
  type?: string;
  addresstype?: string;
}>;

type SearchArea =
  | { kind: "bbox"; south: number; west: number; north: number; east: number }
  | { kind: "around"; lat: number; lng: number; radius: number };
type SearchParams = {
  category: string;
  lat?: number;
  lng?: number;
  radiusM?: number;
  bbox?: { south: number; west: number; north: number; east: number };
  pageToken?: string;
  locationText?: string;
};
type MappedPlace = {
  place_id: string;
  name: string;
  formatted_address?: string;
  geometry?: { location?: { lat: number; lng: number } };
  tags?: Record<string, string>;
};
type PageCursor = {
  offset: number;
  expansionRound: number;
};

const pageSize = Number(process.env.SEARCH_PAGE_SIZE ?? 10);
const searchRadiusM = Number(process.env.DEFAULT_SEARCH_RADIUS_M ?? 20000);
const cacheTtlMs = Number(process.env.SEARCH_CACHE_TTL_MS ?? 10 * 60 * 1000);
const overpassQueryTimeoutS = Number(process.env.OVERPASS_QUERY_TIMEOUT_S ?? 25);
const maxGridCells = Math.max(1, Number(process.env.SEARCH_GRID_MAX_CELLS ?? 4));
const maxSearchAreas = Math.max(1, Number(process.env.SEARCH_MAX_AREAS ?? 4));
const enableGridSearch = process.env.ENABLE_GRID_SEARCH !== "false";
const fallbackQueryLimit = Math.max(30, Number(process.env.FALLBACK_QUERY_LIMIT ?? 60));
const fallbackMaxQueries = Math.max(1, Number(process.env.FALLBACK_MAX_QUERIES ?? 4));
const maxSnapshotExpansionRounds = Math.max(1, Number(process.env.SEARCH_MAX_EXPANSION_ROUNDS ?? 2));
const overpassEndpoints = [
  "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const overpassRetryBackoffMs = [1000, 2000, 4000];
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
const overpassSnapshotCache = new Map<
  string,
  {
    value: Array<{
      place_id: string;
      name: string;
      formatted_address?: string;
      geometry?: { location?: { lat: number; lng: number } };
      tags?: Record<string, string>;
    }>;
    expiresAt: number;
  }
>();
const fallbackSnapshotCache = new Map<
  string,
  {
    value: Array<{
      place_id: string;
      name: string;
      formatted_address?: string;
      geometry?: { location?: { lat: number; lng: number } };
      tags?: Record<string, string>;
    }>;
    expiresAt: number;
  }
>();

function parsePageCursor(pageToken?: string): PageCursor {
  if (!pageToken) return { offset: 0, expansionRound: 0 };
  const legacyOffset = Number(pageToken);
  if (Number.isFinite(legacyOffset)) {
    return { offset: Math.max(0, legacyOffset), expansionRound: 0 };
  }
  const [offsetRaw, expansionRaw] = pageToken.split("|");
  const offset = Number(offsetRaw);
  const expansionRound = Number(expansionRaw);
  return {
    offset: Number.isFinite(offset) ? Math.max(0, offset) : 0,
    expansionRound: Number.isFinite(expansionRound) ? Math.max(0, expansionRound) : 0,
  };
}

function serializePageCursor(cursor: PageCursor): string {
  return `${cursor.offset}|${cursor.expansionRound}`;
}
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
  academia: ['"leisure"="fitness_centre"', '"leisure"="sports_centre"', '"shop"="sports"'],
  padaria: ['"shop"="bakery"'],
  lanchonete: ['"amenity"="fast_food"', '"amenity"="cafe"'],
  restaurante: ['"amenity"="restaurant"', '"amenity"="food_court"'],
  mercado: ['"shop"="supermarket"', '"shop"="convenience"', '"shop"="wholesale"'],
  farmacia: ['"amenity"="pharmacy"', '"shop"="chemist"', '"healthcare"="pharmacy"'],
  "salão de beleza": ['"shop"="beauty"', '"shop"="hairdresser"', '"amenity"="beauty_salon"'],
  bar: ['"amenity"="bar"', '"amenity"="pub"', '"amenity"="biergarten"'],
  pizzaria: ['"amenity"="restaurant"', '"cuisine"="pizza"', '"shop"="pizza"'],
  hotel: ['"tourism"="hotel"', '"tourism"="motel"'],
  pousada: ['"tourism"="guest_house"', '"tourism"="hostel"', '"tourism"="chalet"'],
  "oficina mecânica": ['"shop"="car_repair"', '"craft"="mechanic"', '"service"="car_repair"'],
  autopeças: ['"shop"="car_parts"', '"shop"="car_accessories"'],
  "clínica odontológica": ['"amenity"="dentist"', '"healthcare"="dentist"', '"healthcare"="clinic"'],
  "clínica médica": ['"amenity"="clinic"', '"healthcare"="clinic"', '"amenity"="doctors"'],
  laboratório: ['"healthcare"="laboratory"', '"amenity"="laboratory"', '"shop"="medical_supply"'],
  "pet shop": ['"shop"="pet"', '"shop"="animal"'],
  veterinário: ['"amenity"="veterinary"', '"healthcare"="veterinary"'],
  "loja de roupas": ['"shop"="clothes"', '"shop"="boutique"', '"shop"="fashion"'],
  "loja de móveis": ['"shop"="furniture"', '"shop"="interior_decoration"'],
  papelaria: ['"shop"="stationery"', '"shop"="copyshop"'],
  livraria: ['"shop"="books"', '"amenity"="library"'],
  eletrônicos: ['"shop"="electronics"', '"shop"="computer"', '"shop"="mobile_phone"'],
  escola: ['"amenity"="school"', '"amenity"="college"'],
  creche: ['"amenity"="kindergarten"', '"amenity"="childcare"'],
  "curso de idiomas": ['"amenity"="language_school"', '"amenity"="school"'],
  "material de construção": ['"shop"="doityourself"', '"shop"="hardware"', '"shop"="trade"'],
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

function buildSearchAreas(params: {
  lat: number;
  lng: number;
  radius: number;
  bbox?: { south: number; west: number; north: number; east: number };
}): SearchArea[] {
  if (!params.bbox || !enableGridSearch) {
    return [{ kind: "around", lat: params.lat, lng: params.lng, radius: params.radius }];
  }

  const cellsPerAxis = Math.max(1, Math.floor(Math.sqrt(maxGridCells)));
  const latStep = (params.bbox.north - params.bbox.south) / cellsPerAxis;
  const lngStep = (params.bbox.east - params.bbox.west) / cellsPerAxis;
  const areas: SearchArea[] = [];
  for (let row = 0; row < cellsPerAxis; row += 1) {
    for (let col = 0; col < cellsPerAxis; col += 1) {
      if (areas.length >= maxSearchAreas) break;
      const south = params.bbox.south + latStep * row;
      const north = row === cellsPerAxis - 1 ? params.bbox.north : south + latStep;
      const west = params.bbox.west + lngStep * col;
      const east = col === cellsPerAxis - 1 ? params.bbox.east : west + lngStep;
      areas.push({ kind: "bbox", south, west, north, east });
    }
  }
  return areas.length ? areas : [{ kind: "around", lat: params.lat, lng: params.lng, radius: params.radius }];
}

function buildOverpassQuery(filters: string[], area: SearchArea): string {
  const block = filters
    .map((filter) => {
      if (area.kind === "bbox") {
        return `
        node[${filter}](${area.south},${area.west},${area.north},${area.east});
        way[${filter}](${area.south},${area.west},${area.north},${area.east});
        relation[${filter}](${area.south},${area.west},${area.north},${area.east});`;
      }
      return `
        node[${filter}](around:${area.radius},${area.lat},${area.lng});
        way[${filter}](around:${area.radius},${area.lat},${area.lng});
        relation[${filter}](around:${area.radius},${area.lat},${area.lng});`;
    })
    .join("\n");
  return `[out:json][timeout:${overpassQueryTimeoutS}];
(
${block}
);
out center tags;`;
}

function dedupeMappedPlaces<T extends { place_id: string; name: string; formatted_address?: string }>(mapped: T[]): T[] {
  const byId = new Map<string, T>();
  const seenNameAddress = new Set<string>();
  for (const item of mapped) {
    if (byId.has(item.place_id)) continue;
    const key = `${item.name.trim().toLowerCase()}|${(item.formatted_address ?? "").trim().toLowerCase()}`;
    if (key !== "|" && seenNameAddress.has(key)) {
      continue;
    }
    byId.set(item.place_id, item);
    if (key !== "|") seenNameAddress.add(key);
  }
  return Array.from(byId.values());
}

function buildSearchKeys(params: SearchParams): { cacheKey: string; snapshotKey: string } {
  const base = {
    category: params.category.trim().toLowerCase(),
    lat: params.lat,
    lng: params.lng,
    radiusM: params.radiusM,
    bbox: params.bbox,
    locationText: params.locationText?.trim().toLowerCase(),
  };
  return {
    cacheKey: JSON.stringify({ ...base, pageToken: params.pageToken ?? "0" }),
    snapshotKey: JSON.stringify(base),
  };
}

function mapOverpassElements(elements: OsmElement[]): MappedPlace[] {
  return elements
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
}

function savePagedValue(cacheKey: string, value: { status: string; next_page_token?: string; results: MappedPlace[] }) {
  placesCache.set(cacheKey, { value, expiresAt: Date.now() + cacheTtlMs });
  return value;
}

async function collectOverpassChunks(params: SearchParams, filters: string[], radius: number): Promise<{
  mappedChunks: MappedPlace[];
  hadSuccess: boolean;
  lastStatus?: number;
  lastNetworkError?: string;
}> {
  const areas = buildSearchAreas({
    lat: params.lat as number,
    lng: params.lng as number,
    radius,
    bbox: params.bbox,
  });
  const mappedChunks: MappedPlace[] = [];
  let lastStatus: number | undefined;
  let lastNetworkError: string | undefined;
  let hadSuccess = false;

  for (const area of areas) {
    const query = buildOverpassQuery(filters, area);
    const responseInfo = await requestOverpass(query);
    if (!responseInfo.response) {
      if (typeof responseInfo.lastStatus === "number") lastStatus = responseInfo.lastStatus;
      if (responseInfo.lastNetworkError) lastNetworkError = responseInfo.lastNetworkError;
      continue;
    }
    hadSuccess = true;
    const data = (await responseInfo.response.json()) as OverpassResponse;
    mappedChunks.push(...mapOverpassElements(data.elements));
  }
  return { mappedChunks, hadSuccess, lastStatus, lastNetworkError };
}

async function resolveOverpassFailure(params: SearchParams, snapshotKey: string, lastStatus?: number, lastNetworkError?: string) {
  if (lastStatus === 429 || !lastStatus) {
    await debugLog(
      "src/lib/google.ts:230",
      "overpass exhausted, using nominatim fallback",
      { category: params.category, locationText: params.locationText, lastStatus, lastNetworkError },
      "H4",
      "post-fix",
    );
    return searchPlacesWithNominatimFallback({
      category: params.category,
      locationText: params.locationText,
      pageToken: params.pageToken,
      bbox: params.bbox,
      lat: params.lat,
      lng: params.lng,
      radiusM: params.radiusM,
      snapshotKey,
    });
  }
  if (lastNetworkError) {
    throw new Error("Servico de mapas indisponivel temporariamente. Tente novamente em instantes.");
  }
  throw new Error(`Overpass API indisponivel nos mirrors. Ultimo status: ${lastStatus ?? "desconhecido"}`);
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function canRetry(attempt: number): boolean {
  return attempt < overpassRetryBackoffMs.length;
}

async function tryOverpassEndpoint(endpoint: string, query: string, attempt: number): Promise<{
  response?: Response;
  status?: number;
  networkError?: string;
}> {
  await debugLog("src/lib/google.ts:163", "overpass endpoint attempt", { endpoint, attempt }, "H4", "post-fix");
  try {
    const current = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: query,
      cache: "no-store",
    });
    if (current.ok) {
      await debugLog(
        "src/lib/google.ts:172",
        "overpass endpoint success",
        { endpoint, status: current.status, attempt },
        "H4",
        "post-fix",
      );
      return { response: current };
    }

    await debugLog(
      "src/lib/google.ts:177",
      "overpass endpoint non-ok",
      { endpoint, status: current.status, attempt },
      "H4",
      "post-fix",
    );
    return { status: current.status };
  } catch (error) {
    const message = error instanceof Error ? error.message : "fetch failed";
    await debugLog(
      "src/lib/google.ts:185",
      "overpass endpoint network error",
      { endpoint, attempt, message },
      "H4",
      "post-fix",
    );
    return { networkError: message };
  }
}

function evaluateOverpassAttempt(
  attemptResult: { response?: Response; status?: number; networkError?: string },
  attempt: number,
): {
  response?: Response;
  lastStatus?: number;
  lastNetworkError?: string;
  breakEndpoint: boolean;
  shouldDelay: boolean;
} {
  if (attemptResult.response) {
    return { response: attemptResult.response, breakEndpoint: false, shouldDelay: false };
  }
  if (typeof attemptResult.status === "number") {
    const shouldRetry = attemptResult.status === 429 && canRetry(attempt);
    return {
      lastStatus: attemptResult.status,
      breakEndpoint: !shouldRetry,
      shouldDelay: shouldRetry,
    };
  }
  const hasRetry = canRetry(attempt);
  return {
    lastNetworkError: attemptResult.networkError ?? "fetch failed",
    breakEndpoint: !hasRetry,
    shouldDelay: hasRetry,
  };
}

async function requestOverpass(query: string): Promise<{
  response?: Response;
  lastStatus?: number;
  lastNetworkError?: string;
}> {
  let lastStatus: number | undefined;
  let lastNetworkError: string | undefined;

  for (const endpoint of overpassEndpoints) {
    const result = await requestOverpassFromEndpoint(endpoint, query);
    if (result.response) {
      return {
        response: result.response,
        lastStatus: result.lastStatus ?? lastStatus,
        lastNetworkError: result.lastNetworkError ?? lastNetworkError,
      };
    }
    if (typeof result.lastStatus === "number") {
      lastStatus = result.lastStatus;
    }
    if (result.lastNetworkError) {
      lastNetworkError = result.lastNetworkError;
    }
  }

  return { lastStatus, lastNetworkError };
}

async function requestOverpassFromEndpoint(
  endpoint: string,
  query: string,
): Promise<{ response?: Response; lastStatus?: number; lastNetworkError?: string }> {
  let lastStatus: number | undefined;
  let lastNetworkError: string | undefined;

  for (let attempt = 0; attempt <= overpassRetryBackoffMs.length; attempt += 1) {
    const attemptResult = await tryOverpassEndpoint(endpoint, query, attempt);
    const outcome = evaluateOverpassAttempt(attemptResult, attempt);

    if (outcome.response) {
      return { response: outcome.response, lastStatus, lastNetworkError };
    }
    if (typeof outcome.lastStatus === "number") {
      lastStatus = outcome.lastStatus;
    }
    if (outcome.lastNetworkError) {
      lastNetworkError = outcome.lastNetworkError;
    }
    if (outcome.breakEndpoint) break;
    if (outcome.shouldDelay) {
      await delay(overpassRetryBackoffMs[attempt]);
    }
  }

  return { lastStatus, lastNetworkError };
}

async function collectNominatimFallbackMapped(params: {
  categoryQueries: string[];
  viewbox?: { west: number; north: number; east: number; south: number };
  locationText?: string;
}): Promise<MappedPlace[]> {
  const queryLimit = Math.max(fallbackQueryLimit, pageSize * 4);
  const requests = params.categoryQueries.slice(0, fallbackMaxQueries).map(async (categoryQuery) => {
    const fallbackUrl = new URL("https://nominatim.openstreetmap.org/search");
    fallbackUrl.searchParams.set("format", "jsonv2");
    fallbackUrl.searchParams.set("countrycodes", "br");
    fallbackUrl.searchParams.set("limit", String(queryLimit));
    fallbackUrl.searchParams.set("offset", "0");
    fallbackUrl.searchParams.set("q", categoryQuery);
    if (params.viewbox) {
      fallbackUrl.searchParams.set("bounded", "1");
      fallbackUrl.searchParams.set(
        "viewbox",
        `${params.viewbox.west},${params.viewbox.north},${params.viewbox.east},${params.viewbox.south}`,
      );
    } else if (params.locationText?.trim()) {
      fallbackUrl.searchParams.set("q", `${categoryQuery}, ${params.locationText.trim()}`);
    }

    const response = await fetch(fallbackUrl, {
      cache: "no-store",
      headers: { "user-agent": "local-contacts-app/1.0 (nominatim-poi-fallback)" },
    });
    if (!response.ok) return [] as NominatimPoiResponse;
    return (await response.json()) as NominatimPoiResponse;
  });

  const responses = await Promise.all(requests);
  const merged = responses.flat();
  const deduped = new Map<string, NominatimPoiResponse[number]>();
  for (const item of merged) {
    const key = `${item.osm_type ?? "node"}-${item.osm_id ?? item.display_name ?? ""}`;
    if (!deduped.has(key)) deduped.set(key, item);
  }

  return Array.from(deduped.values())
    .map((item) => ({
      place_id: `${item.osm_type ?? "node"}-${item.osm_id ?? item.display_name ?? Math.random()}`,
      name: item.name ?? item.display_name?.split(",")[0]?.trim() ?? "Empresa sem nome",
      formatted_address: item.display_name ?? "Endereco nao informado",
      geometry:
        typeof item.lat === "string" && typeof item.lon === "string"
          ? { location: { lat: Number(item.lat), lng: Number(item.lon) } }
          : undefined,
      tags: undefined,
    }))
    .sort((a, b) => a.place_id.localeCompare(b.place_id));
}

async function searchPlacesWithNominatimFallback(params: {
  category: string;
  locationText?: string;
  pageToken?: string;
  bbox?: { south: number; west: number; north: number; east: number };
  lat?: number;
  lng?: number;
  radiusM?: number;
  snapshotKey: string;
}) {
  const categoryQueryMap: Record<string, string[]> = {
    academia: ["gym", "fitness centre", "academia"],
    padaria: ["bakery", "padaria", "confeitaria"],
    lanchonete: ["fast food", "snack bar", "lanchonete", "cafe"],
    restaurante: ["restaurant", "restaurante", "food court"],
    mercado: ["supermarket", "market", "grocery store", "mercado"],
    farmacia: ["pharmacy", "drugstore", "farmacia", "chemist"],
    "salão de beleza": ["beauty salon", "hairdresser", "barber", "salão de beleza"],
    bar: ["bar", "pub", "cervejaria"],
    pizzaria: ["pizzeria", "pizza restaurant", "pizzaria"],
    hotel: ["hotel", "motel", "resort"],
    pousada: ["guest house", "inn", "pousada", "hostel"],
    "oficina mecânica": ["auto repair", "mechanic workshop", "oficina mecanica"],
    autopeças: ["auto parts", "car parts", "autopecas"],
    "clínica odontológica": ["dentist", "dental clinic", "clinica odontologica"],
    "clínica médica": ["medical clinic", "doctor clinic", "clinica medica"],
    laboratório: ["laboratory", "diagnostic lab", "laboratorio"],
    "pet shop": ["pet shop", "pet store", "pet supplies"],
    veterinário: ["veterinary", "vet clinic", "veterinario"],
    "loja de roupas": ["clothing store", "fashion store", "loja de roupas"],
    "loja de móveis": ["furniture store", "home furniture", "loja de moveis"],
    papelaria: ["stationery", "paper store", "papelaria"],
    livraria: ["bookstore", "book shop", "livraria"],
    eletrônicos: ["electronics store", "computer store", "mobile store"],
    escola: ["school", "educational center", "escola"],
    creche: ["daycare", "childcare", "creche"],
    "curso de idiomas": ["language school", "english course", "curso de idiomas"],
    "material de construção": ["hardware store", "building materials", "material de construcao"],
  };
  const categoryQueries = categoryQueryMap[params.category.trim().toLowerCase()] ?? [params.category.trim()];
  const cursor = parsePageCursor(params.pageToken);
  const radiusM = Math.max(1000, params.radiusM ?? searchRadiusM);

  let viewbox: { west: number; north: number; east: number; south: number } | undefined;
  if (params.bbox) {
    viewbox = {
      west: params.bbox.west,
      north: params.bbox.north,
      east: params.bbox.east,
      south: params.bbox.south,
    };
  } else if (typeof params.lat === "number" && typeof params.lng === "number") {
    const latDelta = radiusM / 111_320;
    const lngDelta = radiusM / (111_320 * Math.max(0.2, Math.cos((params.lat * Math.PI) / 180)));
    viewbox = {
      west: params.lng - lngDelta,
      north: params.lat + latDelta,
      east: params.lng + lngDelta,
      south: params.lat - latDelta,
    };
  }

  const cachedSnapshot = fallbackSnapshotCache.get(params.snapshotKey);
  if (cachedSnapshot && cachedSnapshot.expiresAt > Date.now()) {
    if (cursor.offset >= cachedSnapshot.value.length && cursor.expansionRound > 0) {
      const expandedMapped = dedupeMappedPlaces([
        ...cachedSnapshot.value,
        ...(await collectNominatimFallbackMapped({
          categoryQueries,
          viewbox,
          locationText: params.locationText,
        })),
      ]).sort((a, b) => a.place_id.localeCompare(b.place_id));
      fallbackSnapshotCache.set(params.snapshotKey, { value: expandedMapped, expiresAt: Date.now() + cacheTtlMs });
      const paginatedExpanded = paginateMappedResults(expandedMapped, params.pageToken);
      return {
        status: paginatedExpanded.status,
        next_page_token: paginatedExpanded.next_page_token,
        results: paginatedExpanded.results,
      };
    }
    const paginated = paginateMappedResults(cachedSnapshot.value, params.pageToken);
    return {
      status: paginated.status,
      next_page_token: paginated.next_page_token,
      results: paginated.results,
    };
  }
  const mapped = await collectNominatimFallbackMapped({
    categoryQueries,
    viewbox,
    locationText: params.locationText,
  });

  fallbackSnapshotCache.set(params.snapshotKey, { value: mapped, expiresAt: Date.now() + cacheTtlMs });
  const paginated = paginateMappedResults(mapped, params.pageToken);
  return {
    status: paginated.status,
    next_page_token: paginated.next_page_token,
    results: paginated.results,
  };
}

function paginateMappedResults(
  mapped: Array<{
    place_id: string;
    name: string;
    formatted_address?: string;
    geometry?: { location?: { lat: number; lng: number } };
    tags?: Record<string, string>;
  }>,
  pageToken?: string,
) {
  const cursor = parsePageCursor(pageToken);
  const paged = mapped.slice(cursor.offset, cursor.offset + pageSize);
  let nextPageToken: string | undefined;
  if (cursor.offset + pageSize < mapped.length) {
    nextPageToken = serializePageCursor({ offset: cursor.offset + pageSize, expansionRound: cursor.expansionRound });
  } else if (cursor.expansionRound < maxSnapshotExpansionRounds) {
    // Keep "carregar mais" visivel para permitir uma nova varredura quando a pagina atual acabar.
    nextPageToken = serializePageCursor({ offset: mapped.length, expansionRound: cursor.expansionRound + 1 });
  }
  return {
    status: paged.length ? "OK" : "ZERO_RESULTS",
    next_page_token: nextPageToken,
    results: paged,
    offset: cursor.offset,
  };
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

export async function searchPlaces(params: SearchParams) {
  const { cacheKey, snapshotKey } = buildSearchKeys(params);
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
  const cursor = parsePageCursor(params.pageToken);
  const cachedSnapshot = overpassSnapshotCache.get(snapshotKey);
  if (cachedSnapshot && cachedSnapshot.expiresAt > Date.now()) {
    if (cursor.offset >= cachedSnapshot.value.length && cursor.expansionRound > 0) {
      const extraResult = await collectOverpassChunks(params, filters, radius);
      if (extraResult.hadSuccess) {
        const expanded = dedupeMappedPlaces([...cachedSnapshot.value, ...extraResult.mappedChunks]).sort((a, b) =>
          a.place_id.localeCompare(b.place_id),
        );
        overpassSnapshotCache.set(snapshotKey, { value: expanded, expiresAt: Date.now() + cacheTtlMs });
        const expandedPage = paginateMappedResults(expanded, params.pageToken);
        return savePagedValue(cacheKey, expandedPage);
      }
      if (extraResult.lastStatus === 429 || !extraResult.lastStatus) {
        const fallback = await searchPlacesWithNominatimFallback({ ...params, snapshotKey });
        const merged = dedupeMappedPlaces([...(cachedSnapshot.value as MappedPlace[]), ...(fallback.results as MappedPlace[])])
          .sort((a, b) => a.place_id.localeCompare(b.place_id));
        overpassSnapshotCache.set(snapshotKey, { value: merged, expiresAt: Date.now() + cacheTtlMs });
        const mergedPage = paginateMappedResults(merged, params.pageToken);
        return savePagedValue(cacheKey, mergedPage);
      }
    }
    const value = paginateMappedResults(cachedSnapshot.value, params.pageToken);
    return savePagedValue(cacheKey, value);
  }

  const overpassResult = await collectOverpassChunks(params, filters, radius);
  if (!overpassResult.hadSuccess) {
    return resolveOverpassFailure(params, snapshotKey, overpassResult.lastStatus, overpassResult.lastNetworkError);
  }

  const mapped = dedupeMappedPlaces(overpassResult.mappedChunks).sort((a, b) => a.place_id.localeCompare(b.place_id));
  overpassSnapshotCache.set(snapshotKey, { value: mapped, expiresAt: Date.now() + cacheTtlMs });
  const paginated = paginateMappedResults(mapped, params.pageToken);
  await debugLog(
    "src/lib/google.ts:180",
    "overpass mapping summary",
    {
      rawCount: overpassResult.mappedChunks.length,
      mappedCount: mapped.length,
      pagedCount: paginated.results.length,
      offset: paginated.offset,
      nextOffset: paginated.next_page_token,
    },
    "H3",
  );

  return savePagedValue(cacheKey, {
    status: paginated.status,
    next_page_token: paginated.next_page_token,
    results: paginated.results,
  });
}

