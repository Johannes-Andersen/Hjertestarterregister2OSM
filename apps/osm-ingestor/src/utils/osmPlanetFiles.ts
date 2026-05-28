import { readdir, rm } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = fileURLToPath(new URL("../../", import.meta.url));

const compactTimestamp = (date: Date): string =>
  date
    .toISOString()
    .replaceAll(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");

const archiveStem = (latestPath: string): string => {
  const filename = basename(latestPath, extname(latestPath));
  if (filename.endsWith("-latest")) return filename.slice(0, -"-latest".length);
  if (filename.endsWith("_latest")) return filename.slice(0, -"_latest".length);
  return filename;
};

export const resolveOsmPlanetPath = (filePath: string): string =>
  isAbsolute(filePath) ? filePath : join(appRoot, filePath);

export const buildDownloadedPlanetPath = ({
  latestPath,
  remoteLastModified,
}: {
  latestPath: string;
  remoteLastModified: Date | null;
}): string => {
  const directory = dirname(latestPath);
  const extension = extname(latestPath) || ".pbf";
  const timestamp = compactTimestamp(remoteLastModified ?? new Date());
  return join(directory, `${archiveStem(latestPath)}-${timestamp}${extension}`);
};

export const pruneOldPlanetFiles = async ({
  latestPath,
  retainDownloads,
}: {
  latestPath: string;
  retainDownloads: number;
}): Promise<void> => {
  const directory = dirname(latestPath);
  const latestFilename = basename(latestPath);
  const stem = archiveStem(latestPath);
  const extension = extname(latestPath) || ".pbf";
  const archivePrefix = `${stem}-`;

  const entries = await readdir(directory, { withFileTypes: true });
  const planetFiles = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter(
      (filename) =>
        filename !== latestFilename &&
        filename.startsWith(archivePrefix) &&
        filename.endsWith(extension),
    )
    .sort()
    .reverse();

  for (const filename of planetFiles.slice(retainDownloads)) {
    const path = join(directory, filename);
    await rm(path, { force: true });
    console.log(`Removed old OSM planet file: ${path}`);
  }
};
