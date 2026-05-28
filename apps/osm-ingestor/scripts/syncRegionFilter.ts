/**
 * Manually-run script that fetches an administrative boundary (or any other
 * OSM relation/way/node geometry) from Nominatim and writes the raw GeoJSON
 * FeatureCollection to disk for use as an AED region filter.
 *
 * Run with:
 *   pnpm --filter osm-ingestor sync-region-filter
 */

/**
 * Manually-run script that fetches an administrative boundary (or any other
 * OSM relation/way/node geometry) from Nominatim and writes the raw GeoJSON
 * FeatureCollection to disk for use as an AED region filter.
 *
 * Run with:
 *   pnpm --filter osm-ingestor sync-region-filter
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeEnv } from "../src/config.ts";
import { logger } from "../src/utils/logger.ts";

const log = logger.child({ module: "syncRegionFilter" });

const appRoot = fileURLToPath(new URL("../", import.meta.url));

const regionOsmId = "R2978650";
const regionFilterFilePath = runtimeEnv.OSM_REGION_FILTER_FILE_PATH;
const userAgent = runtimeEnv.OSM_USER_AGENT;

const nominatimUrl = new URL("https://nominatim.openstreetmap.org/lookup");
nominatimUrl.searchParams.set("osm_ids", regionOsmId);
nominatimUrl.searchParams.set("format", "geojson");
nominatimUrl.searchParams.set("polygon_geojson", "1");

const outputPath = isAbsolute(regionFilterFilePath)
  ? regionFilterFilePath
  : join(appRoot, regionFilterFilePath);

const main = async () => {
  log.info(
    { regionOsmId, url: nominatimUrl.toString() },
    "Fetching region filter from Nominatim",
  );
  const response = await fetch(nominatimUrl, {
    headers: { "User-Agent": userAgent, Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(
      `Nominatim request failed: ${response.status} ${response.statusText}`,
    );
  }

  const raw = await response.text();
  const parsed = JSON.parse(raw) as {
    type?: string;
    features?: Array<{ geometry?: { type?: string } }>;
  };

  if (parsed.type !== "FeatureCollection" || !parsed.features?.length) {
    throw new Error(
      "Nominatim response is not a FeatureCollection with features.",
    );
  }

  const geometryTypes = parsed.features.map(
    (feature) => feature.geometry?.type ?? "<missing>",
  );

  await mkdir(dirname(outputPath), { recursive: true });
  // Pretty-print to keep diffs readable.
  await writeFile(outputPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");

  log.info(
    {
      outputPath,
      featureCount: parsed.features.length,
      geometryTypes,
    },
    "Wrote region filter file",
  );
};

main().catch((err) => {
  log.fatal({ err }, "Failed to sync region filter");
  process.exit(1);
});
