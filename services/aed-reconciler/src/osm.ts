import { OsmApiClient, type OsmNode, OsmSdkError } from "@repo/osm-sdk";
import pkg from "../package.json" with { type: "json" };
import { env } from "./config.ts";
import type { LatLon } from "./geo.ts";
import { logger } from "./logger.ts";

const log = logger.child({ module: "osm" });

export const osm = new OsmApiClient({
  apiUrl: env.OSM_API_URL,
  bearerToken: env.OSM_AUTH_TOKEN,
  userAgent: env.OSM_USER_AGENT,
  changesetTags: {
    created_by: `hjertestarterregister2osm v${pkg.version}`,
    source: "Hjertestarterregisteret",
    "source:url": "https://hjertestarterregister.113.no",
    bot: "yes",
    "import:page": "Import/Catalogue/AED_import_for_Norway",
  },
});

/** Fetch the current node; `null` only when it genuinely no longer exists. */
export const fetchLiveNode = async (
  nodeId: number,
): Promise<OsmNode | null> => {
  try {
    const node = await osm.getNodeFeature(nodeId);
    return node.visible === false ? null : node;
  } catch (error) {
    // 404/410 means the node is truly gone/deleted — a legitimate skip. Anything
    // else (rate limit, 5xx, network, misconfigured OSM_API_URL) is a real
    // failure; surface it instead of masking it as "not found", which would
    // silently drop a valid edit.
    if (
      error instanceof OsmSdkError &&
      (error.status === 404 || error.status === 410)
    ) {
      return null;
    }
    log.error({ nodeId, err: error }, "Failed to fetch live OSM node");
    throw error;
  }
};

export const nodeLocation = (node: OsmNode): LatLon => ({
  lat: node.lat,
  lon: node.lon,
});

/** Whether the node is part of any way or relation (deleting it would corrupt them). */
export const nodeIsInUse = async (nodeId: number): Promise<boolean> => {
  const [ways, relations] = await Promise.all([
    osm.getWaysForNode(nodeId),
    osm.getRelationsForNode(nodeId),
  ]);
  return ways.length > 0 || relations.length > 0;
};
