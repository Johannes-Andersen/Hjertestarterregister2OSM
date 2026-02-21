import type { SyncRunMode } from "@repo/sync-store";
import { osmClient } from "../clients/osmClient.ts";
import { changesetConfig, reconcilerConfig } from "../config.ts";
import { reconciliationLogger } from "../utils/logger.ts";
import {
  hasPlannedChanges,
  type ReconciliationChangePlan,
  toOsmChangePlan,
} from "./plan/changePlan.ts";
import { writePlannedChangeFiles } from "./plan/writePlannedChangeFiles.ts";

interface ExecuteChangePlanArgs {
  mode: SyncRunMode;
  changePlan: ReconciliationChangePlan;
}

const log = reconciliationLogger.child({ module: "executeChangePlan" });

export const executeChangePlan = async ({
  mode,
  changePlan,
}: ExecuteChangePlanArgs): Promise<void> => {
  if (!hasPlannedChanges(changePlan)) {
    log.info("No changes to upload");
    return;
  }

  const outputPaths = await writePlannedChangeFiles({
    changePlan,
    oscOutputPath: reconcilerConfig.previewOscOutputPath,
    geojsonOutputPath: reconcilerConfig.previewGeojsonOutputPath,
  });

  log.info(outputPaths, "Wrote planned changes to disk");

  if (mode === "dry-run") return; // Skip applying changes in dry-run mode

  const appliedChanges = await osmClient.applyBatchedChanges({
    changePlan: toOsmChangePlan(changePlan),
    commentSubject: changesetConfig.commentSubject,
  });

  log.info(appliedChanges, "Applied batched changeset from planned changes");
};
