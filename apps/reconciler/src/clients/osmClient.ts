import { OsmApiClient } from "@repo/osm-sdk";
import { changesetConfig, runtimeEnv } from "../config.ts";

export const osmClient = new OsmApiClient({
  apiUrl: "https://api.openstreetmap.org",
  bearerToken: runtimeEnv.OSM_AUTH_TOKEN,
  changesetTags: changesetConfig.commonTags,
  userAgent: changesetConfig.userAgent,
});
