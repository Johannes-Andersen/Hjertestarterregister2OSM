import type { OverpassElements } from "@repo/overpass-sdk";
import type { NewSyncIssue, SyncRunMode } from "@repo/sync-store";
import { reconcilerConfig } from "../../config.ts";
import type { ReconciliationChangePlan } from "../../plan/changePlan.ts";
import type { ReconciliationSummary } from "../../types/reconciliationSummary.ts";
import type { RegisterAed } from "../../types/registerAed.ts";
import { findNearbyAed } from "../../utils/findNearbyAed.ts";
import { mapRegisterAedToOsmTags } from "../../utils/mapRegisterAedToOsmTags.ts";

interface PlanCreateAedChangesArgs {
  mode: SyncRunMode;
  registerAedsById: Map<string, RegisterAed>;
  matchedRegisterIds: Set<string>;
  elementsForNearbyChecks: OverpassElements[];
  changePlan: ReconciliationChangePlan;
  summary: ReconciliationSummary;
  issues: NewSyncIssue[];
}

export const planCreateAedChanges = ({
  mode,
  registerAedsById,
  matchedRegisterIds,
  elementsForNearbyChecks,
  changePlan,
  summary,
  issues,
}: PlanCreateAedChangesArgs) => {
  for (const registerAed of registerAedsById.values()) {
    if (matchedRegisterIds.has(registerAed.ASSET_GUID)) continue;

    const nearby = findNearbyAed({
      coordinate: {
        lat: registerAed.SITE_LATITUDE,
        lon: registerAed.SITE_LONGITUDE,
      },
      elements: elementsForNearbyChecks,
      maxDistanceMeters: reconcilerConfig.nearbyAedDistanceMeters,
    });

    if (nearby) {
      summary.skippedCreateNearby++;
      issues.push({
        type: "skipped_create_nearby",
        severity: "warning",
        message: `Skipped create for register AED ${registerAed.ASSET_GUID}: nearby ${nearby.element.type} ${nearby.element.id} at ${nearby.distanceMeters.toFixed(1)}m.`,
        registerRef: registerAed.ASSET_GUID,
        osmNodeId:
          nearby.element.type === "node" ? nearby.element.id : undefined,
        details: {
          nearbyElementType: nearby.element.type,
          nearbyElementId: nearby.element.id,
          distanceMeters: Number(nearby.distanceMeters.toFixed(2)),
        },
      });
      console.warn(
        `Skipping create of register AED ${registerAed.ASSET_GUID}: found nearby ${nearby.element.type} ${nearby.element.id} (${nearby.distanceMeters.toFixed(1)}m)`,
      );
      continue;
    }

    const mappedTags = mapRegisterAedToOsmTags(registerAed);
    const createdNodeId = -1 * (summary.created + 1);

    changePlan.create.push({
      registerId: registerAed.ASSET_GUID,
      node: {
        id: createdNodeId,
        lat: registerAed.SITE_LATITUDE,
        lon: registerAed.SITE_LONGITUDE,
        version: 0,
        tags: { ...mappedTags },
      },
    });

    console.log(
      `${mode === "dry-run" ? "[dry] Would create" : "Planned create"} node for register AED ${registerAed.ASSET_GUID} at ${registerAed.SITE_LATITUDE},${registerAed.SITE_LONGITUDE}`,
    );

    summary.created++;
  }
};
