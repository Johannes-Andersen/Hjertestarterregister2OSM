import type { SyncRunMode } from "@repo/sync-store";
import { osmClient } from "../clients/osmClient.ts";
import { changesetConfig, reconcilerConfig } from "../config.ts";
import {
  hasPlannedChanges,
  type ReconciliationChangePlan,
  toOsmChangePlan,
} from "../plan/changePlan.ts";
import { writePlannedChangeFiles } from "../plan/writePlannedChangeFiles.ts";

interface ExecuteChangePlanArgs {
  mode: SyncRunMode;
  changePlan: ReconciliationChangePlan;
}

export const executeChangePlan = async ({
  mode,
  changePlan,
}: ExecuteChangePlanArgs): Promise<void> => {
  if (!hasPlannedChanges(changePlan)) {
    if (mode === "dry-run") {
      console.log("[dry] No planned changes to export");
      return;
    }

    console.log("[live] No changes to upload");
    return;
  }

  if (mode === "dry-run") {
    const outputPaths = await writePlannedChangeFiles({
      changePlan,
      oscOutputPath: reconcilerConfig.previewOscOutputPath,
      geojsonOutputPath: reconcilerConfig.previewGeojsonOutputPath,
    });

    console.log("[dry] Wrote planned changes for review:");
    console.log(`- ${outputPaths.oscPath}`);
    console.log(`- ${outputPaths.geojsonPath}`);
    return;
  }

  const appliedChanges = await osmClient.applyBatchedChanges({
    changePlan: toOsmChangePlan(changePlan),
    commentSubject: changesetConfig.commentSubject,
  });
  const changesetCount = Object.keys(appliedChanges.changesets).length;

  console.log(
    `[live] Applied ${changesetCount} changesets from planned changes`,
  );
};
