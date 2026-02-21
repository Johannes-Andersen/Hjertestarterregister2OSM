import { syncStore } from "../clients/syncStore.ts";
import { reconcilerConfig } from "../config.ts";
import { addNew } from "../tasks/reconciliation/addNew.ts";
import { aedExtraction } from "../tasks/reconciliation/aedExtraction.ts";
import { deleteRemoved } from "../tasks/reconciliation/deleteRemoved.ts";
import { loadOverpassData } from "../tasks/reconciliation/loadOverpassData.ts";
import { loadRegistryData } from "../tasks/reconciliation/loadRegistryData.ts";
import { resolveDuplicates } from "../tasks/reconciliation/resolveDuplicates.ts";
import { updateExisting } from "../tasks/reconciliation/updateExisting.ts";
import { uploadChanges } from "../tasks/reconciliation/uploadChanges.ts";
import {
  mergeChangePlans,
  writeChangeFiles,
} from "../tasks/reconciliation/writeChangeFiles.ts";
import { logger } from "../utils/logger.ts";
import { toErrorMessage } from "../utils/toErrorMessage.ts";

interface ReconciliationOptions {
  runId: string;
}

export const reconciliation = async ({ runId }: ReconciliationOptions) => {
  try {
    const mode = reconcilerConfig.mode;
    const log = logger.child({ job: "reconciliation", runId, mode });
    log.info({ reconcilerConfig }, "Starting reconciliation run");

    const run = await syncStore.startRun({ mode, runId });

    log.info({ run }, "Reconciliation started");

    const registryAssets = await loadRegistryData({ logger: log, runId });
    const overpassElements = await loadOverpassData({ logger: log, runId });

    if (overpassElements.length === 0)
      throw new Error(
        "No AEDs returned from Overpass. Aborting run to prevent bad changes.",
      );

    const extractionResult = await aedExtraction({
      logger: log,
      runId,
      overpassElements,
    });

    const deleteResult = await deleteRemoved({
      logger: log,
      runId,
      overpassElements,
      registryAssets,
    });

    const dedupeResult = await resolveDuplicates({
      logger: log,
      runId,
      overpassElements,
      registryAssets,
    });

    const updateResult = await updateExisting({
      logger: log,
      runId,
      overpassElements,
      registryAssets,
    });

    const addResult = await addNew({
      logger: log,
      runId,
      overpassElements,
      registryAssets,
    });

    const allResults = [
      extractionResult,
      deleteResult,
      dedupeResult,
      updateResult,
      addResult,
    ];

    const metrics = {
      created: allResults.reduce((sum, r) => sum + r.create.length, 0),
      updated: allResults.reduce((sum, r) => sum + r.modify.length, 0),
      deleted: allResults.reduce((sum, r) => sum + r.delete.length, 0),
    };

    log.info({ metrics }, "Task metrics collected");

    await syncStore.addRunMetric({
      runId: run.id,
      metrics,
    });

    // Safety check: abort if deletes exceed the configured fraction of OSM AEDs
    const totalOsmAeds = overpassElements.length;
    if (totalOsmAeds > 0) {
      const deleteFraction = metrics.deleted / totalOsmAeds;
      if (deleteFraction > reconcilerConfig.maxDeleteFraction) {
        throw new Error(
          `Delete fraction ${(deleteFraction * 100).toFixed(1)}% (${metrics.deleted}/${totalOsmAeds}) exceeds max allowed ${(reconcilerConfig.maxDeleteFraction * 100).toFixed(1)}%. Aborting run to prevent bad changes.`,
        );
      }
    }

    const combinedChangePlan = mergeChangePlans(allResults);

    await writeChangeFiles({
      logger: log,
      changePlan: combinedChangePlan,
    });

    if (mode === "live") {
      await uploadChanges({
        logger: log,
        runId,
        changePlan: combinedChangePlan,
      });
    } else {
      log.info("Dry-run mode — skipping upload to OSM");
    }

    await syncStore.completeRun({
      runId: run.id,
      status: "success",
    });

    log.info("Reconciliation completed successfully");
  } catch (err) {
    logger.error({ err }, "Failed to start reconciliation run");

    try {
      logger.debug("Attempting to mark reconciliation run as failed");
      await syncStore.completeRun({
        errorMessage: toErrorMessage(err),
        runId: runId,
        status: "failed",
      });
    } catch (err) {
      logger.error({ err }, "Failed to mark reconciliation run as failed");
    }

    throw err;
  }
};
