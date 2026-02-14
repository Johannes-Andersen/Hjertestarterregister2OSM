import { OsmApiClient } from "@repo/osm-sdk";
import { changesetConfig } from "../config.ts";

export const osmClient = new OsmApiClient({
  apiUrl: "https://api.openstreetmap.org",
  bearerToken: process.env.OSM_AUTH_TOKEN,
  changesetTags: changesetConfig.commonTags,
  userAgent: "hjertestarterregister2osm/0.1",
});
