const dryModeValue = process.env.dry?.trim().toLowerCase();
const dryRunOscOutputPath =
  process.env.DRY_RUN_OSC_PATH?.trim() || "dry-run-changes.osc";
const dryRunGeojsonOutputPath =
  process.env.DRY_RUN_GEOJSON_PATH?.trim() || "dry-run-changes.geojson";
const changesetBatchDistanceKm = Number(
  process.env.CHANGESET_BATCH_DISTANCE_KM?.trim() || "20",
);
const changesetBatchDistanceMeters =
  Number.isFinite(changesetBatchDistanceKm) && changesetBatchDistanceKm > 0
    ? changesetBatchDistanceKm * 1000
    : 20_000;

export const overpassConfig = {
  origin: process.env.OVERPASS_ORIGIN?.trim() || "https://overpass-api.de",
  path: process.env.OVERPASS_PATH?.trim() || "/api/interpreter",
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
  changedLocationDistanceMeters: 10,
  nearbyAedDistanceMeters: 20,
  dryRun: dryModeValue !== "false",
  dryRunOscOutputPath,
  dryRunGeojsonOutputPath,
  changesetBatchDistanceMeters,
};
