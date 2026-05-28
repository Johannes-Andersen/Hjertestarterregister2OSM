import type { PublicRegistryAsset } from "@repo/hjertestarterregister-sdk";
import { type AedRow, transformAedForStorage } from "./transformAed.ts";
import { validateAedData } from "./validateAed.ts";

interface PreparedAeds {
  aeds: AedRow[];
  foundAssetIds: number[];
  invalid: number;
}

const getAssetId = (asset: PublicRegistryAsset): number | null =>
  Number.isInteger(asset.ASSET_ID) && asset.ASSET_ID > 0
    ? asset.ASSET_ID
    : null;

export const prepareAedsForStorage = (
  assets: PublicRegistryAsset[],
): PreparedAeds => {
  const aeds: AedRow[] = [];
  const foundAssetIds = new Set<number>();
  let invalid = 0;

  for (const asset of assets) {
    const assetId = getAssetId(asset);
    if (assetId !== null) foundAssetIds.add(assetId);

    try {
      const validatedAsset = validateAedData(asset);
      aeds.push(transformAedForStorage(validatedAsset));
    } catch (error) {
      invalid++;
      console.error("Validation failed for asset:", asset, "Error:", error);
    }
  }

  return { aeds, foundAssetIds: [...foundAssetIds], invalid };
};
