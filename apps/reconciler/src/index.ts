import {
  HjertestarterregisterApiClient,
  type RegistryAsset,
} from "@repo/hjertestarterregister-api";
import { OSM } from "@repo/osm-sdk";
import type { OverpassNode } from "@repo/overpass-sdk";
import {
  closeSyncStore,
  completeSyncRun,
  type NewSyncIssue,
  replaceCurrentRunIssues,
  type SyncRunMetrics,
  type SyncRunMode,
  startSyncRun,
} from "@repo/sync-store";
import { changesetConfig, reconcilerConfig } from "./config.ts";
import { createChangePlan, hasPlannedChanges } from "./dryRun/changePlan.ts";
import { writeDryRunChangeFiles } from "./dryRun/writeChangeFiles.ts";
import { getOsmAeds } from "./overpass/getOsmAeds.ts";
import type { RegisterAed } from "./register/type.ts";
import { addAeds } from "./tasks/addAeds.ts";
import { deleteAeds } from "./tasks/deleteAeds.ts";
import { createReconciliationSummary } from "./tasks/types.ts";
import { updateAeds } from "./tasks/updateAeds.ts";
import { filterDuplicates } from "./utils/filterDuplicates.ts";
import { isManagedAed } from "./utils/isManagedAed.ts";
import { isOverpassNode } from "./utils/isOverpassNode.ts";

const defaultRegisterMaxRows = 50000;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const mapRegistryAssetToRegisterAed = (
  asset: RegistryAsset,
): RegisterAed | null => {
  const guid =
    typeof asset.ASSET_GUID === "string" ? asset.ASSET_GUID.trim() : "";
  if (!guid) return null;

  const lat = asset.SITE_LATITUDE;
  const lon = asset.SITE_LONGITUDE;
  if (!isFiniteNumber(lat) || !isFiniteNumber(lon)) return null;

  return {
    ...asset,
    ASSET_GUID: guid,
    SITE_LATITUDE: lat,
    SITE_LONGITUDE: lon,
  };
};

interface OsmAedResult {
  filteredAedNodes: ReturnType<typeof filterDuplicates>["uniqueNodes"];
  elements: Awaited<ReturnType<typeof getOsmAeds>>["elements"];
  stats: Pick<
    SyncRunMetrics,
    "osmAeds" | "managedOsmAeds" | "uniqueManagedOsmAeds"
  >;
}

const captureUnlinkedNodeIssues = ({
  unmanagedAedNodes,
  issues,
}: {
  unmanagedAedNodes: OverpassNode[];
  issues: NewSyncIssue[];
}) => {
  for (const element of unmanagedAedNodes) {
    issues.push({
      type: "osm_node_missing_ref",
      severity: "warning",
      message: `Node ${element.id} is missing ref:hjertestarterregister.`,
      osmNodeId: element.id,
      details: {
        tags: element.tags ?? {},
      },
    });
  }
};

const osmAeds = async ({
  issues,
}: {
  issues: NewSyncIssue[];
}): Promise<OsmAedResult> => {
  const { elements } = await getOsmAeds();

  console.log(`Found ${elements.length} AED elements`);

  const aedNodes = elements.filter(isOverpassNode);
  if (!aedNodes.length) throw new Error("No AED nodes found");

  console.log(`Found ${aedNodes.length} AED nodes`);

  const managedAedNodes = aedNodes.filter(isManagedAed);
  const unmanagedAedNodes = aedNodes.filter((node) => !isManagedAed(node));

  captureUnlinkedNodeIssues({
    unmanagedAedNodes,
    issues,
  });

  console.log(`Found ${managedAedNodes.length} managed AED nodes`);

  const duplicateFilterResult = filterDuplicates(managedAedNodes);
  const filteredAedNodes = duplicateFilterResult.uniqueNodes;

  for (const duplicate of duplicateFilterResult.duplicates) {
    issues.push({
      type: "osm_duplicate_register_ref",
      severity: "error",
      message: `Duplicate ref:hjertestarterregister=${duplicate.ref} found on nodes ${duplicate.nodeIds.join(", ")}.`,
      registerRef: duplicate.ref,
      details: {
        nodeIds: duplicate.nodeIds,
      },
    });
  }

  console.log(`Found ${filteredAedNodes.length} unique managed AED nodes`);

  return {
    filteredAedNodes,
    elements,
    stats: {
      osmAeds: aedNodes.length,
      managedOsmAeds: managedAedNodes.length,
      uniqueManagedOsmAeds: filteredAedNodes.length,
    },
  };
};

const getRegisterAedsById = (aeds: RegistryAsset[]) => {
  const registerAedsById = new Map<string, RegisterAed>();
  const duplicateRefs = new Set<string>();

  for (const asset of aeds) {
    const registerAed = mapRegistryAssetToRegisterAed(asset);
    if (!registerAed) continue;

    if (registerAedsById.has(registerAed.ASSET_GUID)) {
      duplicateRefs.add(registerAed.ASSET_GUID);
      console.error(
        `Duplicate AED ref ${registerAed.ASSET_GUID} in register. Skipping duplicate entry.`,
      );
      continue;
    }

    registerAedsById.set(registerAed.ASSET_GUID, registerAed);
  }

  return {
    registerAedsById,
    duplicateRefs: [...duplicateRefs].sort((left, right) =>
      left.localeCompare(right),
    ),
  };
};

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") return error;

  return "Unknown reconciler error";
};

const main = async () => {
  const mode: SyncRunMode = reconcilerConfig.dryRun ? "dry-run" : "live";
  const run = await startSyncRun({ mode });
  const issues: NewSyncIssue[] = [];
  const metrics: Partial<SyncRunMetrics> = {};
  let issuesPersisted = false;

  const authHeader = process.env.OSM_AUTH_HEADER?.trim() || undefined;
  const authToken = process.env.OSM_AUTH_TOKEN?.trim() || undefined;

  OSM.configure({
    apiUrl: process.env.OSM_API_URL,
    authHeader,
    bearerToken: authHeader ? undefined : authToken,
    changesetTags: changesetConfig.commonTags,
  });

  console.log(
    `Running reconciler in ${reconcilerConfig.dryRun ? "dry-run" : "live"} mode`,
  );

  try {
    const { filteredAedNodes, elements, stats } = await osmAeds({ issues });
    metrics.osmAeds = stats.osmAeds;
    metrics.managedOsmAeds = stats.managedOsmAeds;
    metrics.uniqueManagedOsmAeds = stats.uniqueManagedOsmAeds;

    const elementsForNearbyChecks = [...elements];

    const registerClient = new HjertestarterregisterApiClient({
      clientId: process.env.HJERTESTARTERREGISTER_CLIENT_ID || "",
      clientSecret: process.env.HJERTESTARTERREGISTER_CLIENT_SECRET || "",
      baseUrl: process.env.HJERTESTARTERREGISTER_API_BASE_URL,
      oauthTokenUrl: process.env.HJERTESTARTERREGISTER_OAUTH_TOKEN_URL,
    });
    const registerResponse = await registerClient.searchAssets({
      max_rows: defaultRegisterMaxRows,
    });
    const { registerAedsById, duplicateRefs } = getRegisterAedsById(
      registerResponse.ASSETS,
    );
    metrics.registryAeds = registerAedsById.size;

    for (const duplicateRef of duplicateRefs) {
      issues.push({
        type: "registry_duplicate_register_ref",
        severity: "error",
        message: `Duplicate register ref ${duplicateRef} found in source registry payload.`,
        registerRef: duplicateRef,
      });
    }

    const matchedRegisterIds = new Set<string>();
    const changePlan = createChangePlan();

    console.log(`Found ${registerAedsById.size} unique AEDs in register`);

    const summary = createReconciliationSummary();

    await deleteAeds({
      filteredAedNodes,
      registerAedsById,
      changePlan,
      summary,
      issues,
    });

    await updateAeds({
      filteredAedNodes,
      registerAedsById,
      matchedRegisterIds,
      elementsForNearbyChecks,
      changePlan,
      summary,
    });

    await addAeds({
      registerAedsById,
      matchedRegisterIds,
      elementsForNearbyChecks,
      changePlan,
      summary,
      issues,
    });

    if (hasPlannedChanges(changePlan)) {
      if (reconcilerConfig.dryRun) {
        const outputPaths = await writeDryRunChangeFiles({
          changePlan,
          oscOutputPath: reconcilerConfig.dryRunOscOutputPath,
          geojsonOutputPath: reconcilerConfig.dryRunGeojsonOutputPath,
        });

        console.log("[dry] Wrote planned changes for review:");
        console.log(`- ${outputPaths.oscPath}`);
        console.log(`- ${outputPaths.geojsonPath}`);
      } else {
        const appliedBatches = await OSM.applyBatchedChanges({
          changePlan,
          maxDistanceMeters: reconcilerConfig.changesetBatchDistanceMeters,
        });

        console.log(
          `[live] Applied ${appliedBatches.length} changesets from planned changes`,
        );
      }
    } else if (reconcilerConfig.dryRun) {
      console.log("[dry] No planned changes to export");
    } else {
      console.log("[live] No changes to upload");
    }

    metrics.linkedAeds = matchedRegisterIds.size;
    metrics.updated = summary.updated;
    metrics.created = summary.created;
    metrics.deleted = summary.deleted;
    metrics.skippedCreateNearby = summary.skippedCreateNearby;
    metrics.skippedDeleteNotAedOnly = summary.skippedDeleteNotAedOnly;
    metrics.unchanged = summary.unchanged;

    await replaceCurrentRunIssues({
      runId: run.id,
      issues,
    });
    issuesPersisted = true;

    await completeSyncRun({
      runId: run.id,
      status: "success",
      metrics,
    });

    console.log("Reconciliation summary:", summary);
    console.log(`Stored run ${run.id} with ${issues.length} issues.`);
  } catch (error) {
    const errorMessage = toErrorMessage(error);

    if (!issuesPersisted) {
      try {
        await replaceCurrentRunIssues({
          runId: run.id,
          issues,
        });
        issuesPersisted = true;
      } catch (storeIssueError) {
        console.error("Failed to persist run issues:", storeIssueError);
      }
    }

    try {
      await completeSyncRun({
        runId: run.id,
        status: "failed",
        errorMessage,
        metrics,
      });
    } catch (storeRunError) {
      console.error("Failed to mark run as failed:", storeRunError);
    }

    throw error;
  } finally {
    try {
      await closeSyncStore();
    } catch (closeError) {
      console.error("Failed to close sync-store connection:", closeError);
    }
  }
};

main().catch((error) => {
  console.error("Reconciler failed:", error);
  process.exitCode = 1;
});
