import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Logger } from "pino";
import { env } from "../config.ts";

const appRoot = fileURLToPath(new URL("../../", import.meta.url));

export interface PlanetMetadata {
  sourceUrl: string;
  etag: string | null;
  lastModified: Date | null;
  contentLength: number | null;
}

const parseHttpDate = (value: string | null): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const parseContentLength = (value: string | null): number | null => {
  const parsed = value ? Number(value) : NaN;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
};

const request = async (
  url: string,
  method: "HEAD" | "GET",
  signal?: AbortSignal,
): Promise<Response> => {
  const response = await fetch(url, {
    method,
    headers: { "User-Agent": env.OSM_USER_AGENT },
    signal,
  });
  if (!response.ok) {
    throw new Error(`OSM planet request failed ${response.status}: ${url}`);
  }
  return response;
};

export const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
};

export const getPlanetMetadata = async (
  sourceUrl: string,
  signal?: AbortSignal,
): Promise<PlanetMetadata> => {
  const response = await request(sourceUrl, "HEAD", signal);
  return {
    sourceUrl,
    etag: response.headers.get("etag"),
    lastModified: parseHttpDate(response.headers.get("last-modified")),
    contentLength: parseContentLength(response.headers.get("content-length")),
  };
};

export const downloadPlanet = async ({
  sourceUrl,
  targetPath,
  signal,
}: {
  sourceUrl: string;
  targetPath: string;
  signal?: AbortSignal;
}): Promise<void> => {
  const response = await request(sourceUrl, "GET", signal);
  if (!response.body) {
    throw new Error(`OSM planet response has no body: ${sourceUrl}`);
  }

  await mkdir(dirname(targetPath), { recursive: true });
  const partialPath = `${targetPath}.part`;
  const writeStream = createWriteStream(partialPath);
  const reader = response.body.getReader();

  const onAbort = () => {
    reader.cancel(signal?.reason ?? new Error("Aborted")).catch(() => {});
    writeStream.destroy(new Error("OSM planet download aborted"));
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    while (true) {
      if (signal?.aborted) throw new Error("OSM planet download aborted");
      const { done, value } = await reader.read();
      if (done) break;
      if (!writeStream.write(value)) await once(writeStream, "drain");
    }
    writeStream.end();
    await once(writeStream, "finish");
    await rename(partialPath, targetPath);
  } catch (error) {
    writeStream.destroy();
    await rm(partialPath, { force: true });
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
};

export const resolvePlanetPath = (filePath: string): string =>
  isAbsolute(filePath) ? filePath : join(appRoot, filePath);

const archiveStem = (latestPath: string): string => {
  const name = basename(latestPath, extname(latestPath));
  return name.replace(/[-_]latest$/, "");
};

const compactTimestamp = (date: Date): string =>
  date
    .toISOString()
    .replaceAll(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");

export const buildDownloadPath = ({
  latestPath,
  lastModified,
}: {
  latestPath: string;
  lastModified: Date | null;
}): string => {
  const extension = extname(latestPath) || ".pbf";
  const timestamp = compactTimestamp(lastModified ?? new Date());
  return join(
    dirname(latestPath),
    `${archiveStem(latestPath)}-${timestamp}${extension}`,
  );
};

export const pruneOldPlanets = async ({
  latestPath,
  retain,
  logger,
}: {
  latestPath: string;
  retain: number;
  logger: Logger;
}): Promise<void> => {
  const directory = dirname(latestPath);
  const extension = extname(latestPath) || ".pbf";
  const prefix = `${archiveStem(latestPath)}-`;
  const latestName = basename(latestPath);

  const entries = await readdir(directory, { withFileTypes: true });
  const archives = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter(
      (name) =>
        name !== latestName &&
        name.startsWith(prefix) &&
        name.endsWith(extension),
    )
    .sort()
    .reverse();

  for (const name of archives.slice(retain)) {
    const path = join(directory, name);
    await rm(path, { force: true });
    logger.info({ path }, "Removed old OSM planet file");
  }
};
