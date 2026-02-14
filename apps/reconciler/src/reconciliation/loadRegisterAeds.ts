import type { RegistryAsset } from "@repo/hjertestarterregister-sdk";
import type { NewSyncIssue } from "@repo/sync-store";
import { type RegisterAed, toRegisterAed } from "../types/registerAed.ts";

interface RegisterAedSnapshot {
  registerAedsById: Map<string, RegisterAed>;
  issues: NewSyncIssue[];
}

export const loadRegisterAeds = (
  assets: RegistryAsset[],
): RegisterAedSnapshot => {
  const registerAedsById = new Map<string, RegisterAed>();

  for (const asset of assets) {
    const registerAed = toRegisterAed(asset);
    if (!registerAed) continue;

    registerAedsById.set(registerAed.ASSET_GUID, registerAed);
  }

  // TODO: Implement outside of Norway checks
  const issues: NewSyncIssue[] = [];

  if (issues.length > 0) {
    console.error(
      `Found ${issues.length} issues while loading register AEDs:`,
      issues.map((issue) => `- ${issue.type}`).join("\n"),
    );
  }

  return {
    registerAedsById,
    issues,
  };
};
