const isDryRun = process.env.DRY !== "false";

const currentDir = import.meta.dirname;
const outputDir = `${currentDir}/../out`;

export const overpassConfig = {
  apiUrl: process.env.OVERPASS_API_URL,
  maxRetries: 6,
  queryTimeoutSeconds: 60,
  requestTimeoutMs: 90_000, // 90 seconds
};

export const changesetConfig = {
  addedComment: "Added AED location",
  modifiedComment: "Modified AED location",
  deletedComment: "Deleted AED location",
  commonTags: {
    created_by: "hjertestarterregister2osm v0.1",
    source: "https://hjertestarterregister.113.no/ords/f?p=110:1",
    bot: "yes",
  },
};

export const reconcilerConfig = {
  changesetBatchDistanceMeters: 20_000, // 20 km
  changedLocationDistanceMeters: 10,
  nearbyAedDistanceMeters: 20,
  dryRun: isDryRun,
  dryRunOscOutputPath: `${outputDir}/dry-run-changes.osc`,
  dryRunGeojsonOutputPath: `${outputDir}/dry-run-changes.geojson`,
};
