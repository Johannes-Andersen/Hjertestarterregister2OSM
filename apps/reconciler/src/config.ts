const isDryRun = process.env.DRY !== "false";

const currentDir = import.meta.dirname;
const outputDir = `${currentDir}/../out`;

export const overpassConfig = {
  apiUrl: "https://overpass-api.de/api/interpreter",
  queryTimeoutSeconds: 60,
  minRetryDelayMs: 5_000, // 5 seconds
  maxRetries: 6,
};

export const changesetConfig = {
  commentSubject: "AED locations",
  commonTags: {
    created_by: "hjertestarterregister2osm v0.1",
    source: "https://hjertestarterregister.113.no/ords/f?p=110:1",
    bot: "yes",
  },
};

export const reconcilerConfig = {
  changedLocationDistanceMeters: 10,
  nearbyAedDistanceMeters: 20,
  dryRun: isDryRun,
  dryRunOscOutputPath: `${outputDir}/dry-run-changes.osc`,
  dryRunGeojsonOutputPath: `${outputDir}/dry-run-changes.geojson`,
};
