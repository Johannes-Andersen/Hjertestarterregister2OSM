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
  console.log(`Fetching region filter for ${regionOsmId} from ${nominatimUrl}`);
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

  const geometryTypes = parsed.features
    .map((feature) => feature.geometry?.type ?? "<missing>")
    .join(", ");

  await mkdir(dirname(outputPath), { recursive: true });
  // Pretty-print to keep diffs readable.
  await writeFile(outputPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");

  console.log(
    `Wrote ${outputPath} (${parsed.features.length} feature(s): ${geometryTypes})`,
  );
};

main().catch((error) => {
  console.error("Failed to sync region filter:", error);
  process.exit(1);
});
