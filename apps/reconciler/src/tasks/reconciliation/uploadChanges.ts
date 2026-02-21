import type { ChangePlan } from "@repo/osm-sdk";
import type { Logger } from "pino";
import { osmClient } from "../../clients/osmClient.ts";
import { changesetConfig } from "../../config.ts";

interface UploadChangesOptions {
  logger: Logger;
  runId: string;
  changePlan: ChangePlan;
}

interface UploadChangesResult {
  createCount: number;
  modifyCount: number;
  deleteCount: number;
}

export const uploadChanges = async ({
  logger,
  runId,
  changePlan,
}: UploadChangesOptions): Promise<UploadChangesResult> => {
  const log = logger.child({ task: "uploadChanges", runId });

  const hasChanges =
    changePlan.create.length > 0 ||
    changePlan.modify.length > 0 ||
    changePlan.delete.length > 0;

  if (!hasChanges) {
    log.info("No changes to upload");
    return { createCount: 0, modifyCount: 0, deleteCount: 0 };
  }

  log.info(
    {
      creates: changePlan.create.length,
      modifies: changePlan.modify.length,
      deletes: changePlan.delete.length,
    },
    "Uploading changes to OSM",
  );

  const result = await osmClient.applyBatchedChanges({
    changePlan,
    commentSubject: changesetConfig.commentSubject,
  });

  log.info(
    {
      changesets: result.changesets,
      createCount: result.createCount,
      modifyCount: result.modifyCount,
      deleteCount: result.deleteCount,
    },
    "Changes uploaded to OSM successfully",
  );

  return {
    createCount: result.createCount,
    modifyCount: result.modifyCount,
    deleteCount: result.deleteCount,
  };
};
