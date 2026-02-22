import type { APIRoute } from "astro";

export const prerender = false;

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const OVERPASS_QUERY = `
  [out:json][timeout:45];
  nwr["emergency"="defibrillator"]["ref:hjertestarterregister"];
  out center tags;
`;

/** Consider cached data fresh for 5 hours before triggering background revalidation. */
const STALE_AFTER_MS = 5 * 60 * 60 * 1000;

const CLIENT_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=3600";

const RUNTIME_CACHE_CONTROL = "public, max-age=604800";

const H = {
  ct: "Content-Type",
  cc: "Cache-Control",
  status: "X-Map-Cache-Status",
  age: "X-Map-Cache-Age-Seconds",
  generatedAt: "X-Map-Data-Generated-At",
  source: "X-Map-Cache-Source",
} as const;

const JSON_CT = "application/json; charset=utf-8";

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassPayload {
  osm3s?: { timestamp_osm_base?: string };
  elements?: OverpassElement[];
}

interface AedMapPayload {
  generatedAt: string;
  osmBaseTimestamp: string | null;
  totalElements: number;
  displayedElements: number;
  featureCollection: {
    type: "FeatureCollection";
    features: Array<{
      type: "Feature";
      geometry: { type: "Point"; coordinates: [number, number] };
      properties: Record<string, unknown>;
    }>;
  };
}

interface RuntimeCache {
  match: (req: string) => Promise<Response | undefined>;
  put: (req: string, res: Response) => Promise<void>;
}

const parseTs = (v: string | null | undefined): number | null => {
  if (!v) return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
};

const pointOf = (el: OverpassElement) =>
  el.type === "node" && el.lat != null && el.lon != null
    ? { lat: el.lat, lon: el.lon }
    : (el.center ?? null);

const jsonResponse = (
  body: unknown,
  headers: Record<string, string>,
  status = 200,
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { [H.ct]: JSON_CT, ...headers },
  });

const clientResponse = (
  cached: Response,
  cacheStatus: string,
  ageSeconds?: number,
  stale = false,
) => {
  const headers = new Headers(cached.headers);
  headers.set(H.cc, CLIENT_CACHE_CONTROL);
  headers.set(H.status, cacheStatus);
  headers.set(H.source, "RUNTIME_CACHE");

  if (ageSeconds != null) headers.set(H.age, String(ageSeconds));
  else headers.delete(H.age);

  if (stale) headers.set("Warning", '110 - "Response is stale"');
  else headers.delete("Warning");

  return new Response(cached.body, { status: cached.status, headers });
};

const errorResponse = (
  message: string,
  status = 502,
  cacheStatus = "RUNTIME_CACHE_ERROR",
) =>
  jsonResponse(
    { error: message },
    {
      [H.cc]: "no-store",
      [H.status]: cacheStatus,
      [H.source]: "RUNTIME_CACHE",
    },
    status,
  );

const fetchFromOverpass = async (): Promise<AedMapPayload> => {
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ data: OVERPASS_QUERY }),
  });

  if (!res.ok) {
    throw new Error(
      `Overpass returned ${res.status}: ${(await res.text()).slice(0, 1500)}`,
    );
  }

  const payload: OverpassPayload = await res.json();
  const elements = payload.elements ?? [];

  const features = elements.flatMap((el) => {
    const pt = pointOf(el);
    if (!pt) return [];
    const t = el.tags ?? {};
    return [
      {
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [pt.lon, pt.lat] as [number, number],
        },
        properties: {
          id: `${el.type}/${el.id}`,
          ref: t["ref:hjertestarterregister"] ?? null,
          name: t.name ?? null,
          level: t.level ?? null,
          location: t["defibrillator:location"] ?? null,
          openingHours: t.opening_hours ?? null,
          elementType: el.type,
          osmUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
        },
      },
    ];
  });

  return {
    generatedAt: new Date().toISOString(),
    osmBaseTimestamp: payload.osm3s?.timestamp_osm_base ?? null,
    totalElements: elements.length,
    displayedElements: features.length,
    featureCollection: { type: "FeatureCollection", features },
  };
};

const refreshCache = async (cache: RuntimeCache, key: string) => {
  const payload = await fetchFromOverpass();
  const res = jsonResponse(payload, {
    [H.cc]: RUNTIME_CACHE_CONTROL,
    [H.generatedAt]: payload.generatedAt,
  });
  await cache.put(key, res.clone());
  return res;
};

export const GET: APIRoute = async ({ request, locals }) => {
  const cache = locals.runtime.caches.default as unknown as RuntimeCache;

  const keyUrl = new URL(request.url);
  keyUrl.pathname = "/api/osm-aeds.json";
  keyUrl.search = "";
  keyUrl.hash = "";
  keyUrl.searchParams.set("__runtime_cache_key", "v1");
  const cacheKey = keyUrl.toString();

  const cached = await cache.match(cacheKey);
  const now = Date.now();

  if (!cached) {
    try {
      await refreshCache(cache, cacheKey);
      const warmed = await cache.match(cacheKey);
      if (warmed) return clientResponse(warmed, "RUNTIME_CACHE_MISS_WARMED", 0);

      const fresh = await refreshCache(cache, cacheKey);
      return clientResponse(fresh, "RUNTIME_CACHE_MISS_WARMED", 0);
    } catch (err) {
      return errorResponse(
        err instanceof Error ? err.message : "Overpass request failed.",
        502,
        "RUNTIME_CACHE_MISS_FETCH_FAILED",
      );
    }
  }

  const generatedAt = cached.headers.get(H.generatedAt);
  const generatedMs = parseTs(generatedAt);
  const ageMs = generatedMs != null ? now - generatedMs : Infinity;
  const ageSec = Number.isFinite(ageMs)
    ? Math.max(0, Math.floor(ageMs / 1000))
    : undefined;

  if (ageMs < STALE_AFTER_MS) {
    return clientResponse(cached, "RUNTIME_CACHE_HIT_FRESH", ageSec);
  }

  locals.runtime.ctx.waitUntil(
    refreshCache(cache, cacheKey).catch((err) =>
      console.warn(
        "[osm-aeds.json] Background revalidation failed:",
        err instanceof Error ? err.message : err,
      ),
    ),
  );

  return clientResponse(
    cached,
    "RUNTIME_CACHE_HIT_STALE_REVALIDATING",
    ageSec,
    true,
  );
};
