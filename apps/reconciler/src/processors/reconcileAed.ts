import type { Logger } from "pino";
import { sql } from "../clients/postgresClient.ts";

interface RegistryAed {
  asset_id: number;
  asset_guid: string;
  site_name: string;
  site_latitude: number;
  site_longitude: number;
}

interface OsmAed {
  element_type: string;
  element_id: number;
  latitude: number;
  longitude: number;
  tags: Record<string, string>;
}

export const reconcileAed = async (
  assetId: number,
  log: Logger,
): Promise<void> => {
  const aedLog = log.child({ assetId });

  const [registryAed] = await sql<RegistryAed[]>`
    SELECT asset_id, asset_guid, site_name, site_latitude, site_longitude
    FROM aed
    WHERE asset_id = ${assetId}
      AND "deletedAt" IS NULL
  `;

  if (!registryAed) {
    aedLog.warn("Registry AED not found or deleted; skipping reconciliation");
    return;
  }

  aedLog.info(
    {
      assetGuid: registryAed.asset_guid,
      siteName: registryAed.site_name,
      latitude: registryAed.site_latitude,
      longitude: registryAed.site_longitude,
    },
    "Found registry AED",
  );

  const [osmAed] = await sql<OsmAed[]>`
    SELECT element_type, element_id, latitude, longitude, tags
    FROM osm_aed
    WHERE tags->>'ref:hjertestarterregister' = ${registryAed.asset_guid}
      AND "deletedAt" IS NULL
  `;

  if (!osmAed) {
    aedLog.info(
      { assetGuid: registryAed.asset_guid },
      "No matching OSM node found for registry AED",
    );
    return;
  }

  aedLog.info(
    {
      assetGuid: registryAed.asset_guid,
      registryAed: {
        assetId: registryAed.asset_id,
        siteName: registryAed.site_name,
        latitude: registryAed.site_latitude,
        longitude: registryAed.site_longitude,
      },
      osmAed: {
        elementType: osmAed.element_type,
        elementId: osmAed.element_id,
        latitude: osmAed.latitude,
        longitude: osmAed.longitude,
        tags: osmAed.tags,
      },
    },
    "Matched registry AED with OSM node",
  );
};
