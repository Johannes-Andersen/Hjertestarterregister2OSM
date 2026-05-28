import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { runtimeEnv } from "../config.ts";

export interface OsmPlanetRemoteMetadata {
  sourceUrl: string;
  etag: string | null;
  lastModified: Date | null;
  contentLength: number | null;
}

export interface DownloadOsmPlanetFileOptions {
  sourceUrl: string;
  targetPath: string;
}

const parseHttpDate = (value: string | null): Date | null => {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date;
};

const parseContentLength = (value: string | null): number | null => {
  if (!value) return null;

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
};

const request = async (
  url: string,
  options: RequestInit,
): Promise<Response> => {
  const response = await fetch(url, {
    ...options,
    headers: {
      "User-Agent": runtimeEnv.OSM_USER_AGENT,
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`OSM planet request failed ${response.status}: ${url}`);
  }

  return response;
};

export const osmPlanetClient = {
  async getRemoteMetadata(
    sourceUrl = runtimeEnv.OSM_PLANET_URL,
  ): Promise<OsmPlanetRemoteMetadata> {
    const response = await request(sourceUrl, { method: "HEAD" });

    return {
      sourceUrl,
      etag: response.headers.get("etag"),
      lastModified: parseHttpDate(response.headers.get("last-modified")),
      contentLength: parseContentLength(response.headers.get("content-length")),
    };
  },

  async downloadFile({
    sourceUrl,
    targetPath,
  }: DownloadOsmPlanetFileOptions): Promise<void> {
    const response = await request(sourceUrl, { method: "GET" });
    if (!response.body) {
      throw new Error(`OSM planet response has no body: ${sourceUrl}`);
    }

    await mkdir(dirname(targetPath), { recursive: true });

    const partialPath = `${targetPath}.part`;
    const writeStream = createWriteStream(partialPath);
    const reader = response.body.getReader();

    try {
      while (true) {
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
      reader.releaseLock();
    }
  },
};
