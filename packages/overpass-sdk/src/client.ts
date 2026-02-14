import { Agent, Headers, RetryAgent } from "undici";
import * as z from "zod";
import { OverpassSdkError } from "./errors.ts";
import type {
  OverpassQueryOptions,
  OverpassResponse,
  OverpassSdkClientOptions,
} from "./types.ts";

const configSchema = z.object({
  apiUrl: z
    .url({ protocol: /^https?$/, hostname: z.regexes.domain })
    .default("https://overpass-api.de/api/interpreter"),
  maxRetries: z.int().nonnegative().default(5),
  minRetryDelayMs: z.number().positive().default(500),
  userAgent: z.string().min(3).default("overpass-sdk"),
});

export class OverpassApiClient {
  private readonly dispatcher: RetryAgent;
  private readonly apiUrl: string;
  private readonly userAgent: string;

  constructor(options: OverpassSdkClientOptions = {}) {
    const config = configSchema.parse(options);
    this.apiUrl = config.apiUrl;
    this.userAgent = config.userAgent;

    this.dispatcher = new RetryAgent(new Agent(), {
      maxRetries: config.maxRetries,
      minTimeout: config.minRetryDelayMs,
      methods: [
        // Added POST since Overpass API uses POST for queries
        "POST",
        "GET",
        "HEAD",
        "OPTIONS",
        "PUT",
        "DELETE",
        "TRACE",
      ],
      errorCodes: [
        // Needed due to some Overpass servers responding with incorrect Content-Length headers on error
        "UND_ERR_REQ_CONTENT_LENGTH_MISMATCH",
        "ECONNRESET",
        "ECONNREFUSED",
        "ENOTFOUND",
        "ENETDOWN",
        "ENETUNREACH",
        "EHOSTDOWN",
        "EHOSTUNREACH",
        "EPIPE",
      ],
      throwOnError: false,
      retry: (error, context, callback) => {
        const {
          state,
          opts: { retryOptions },
        } = context;

        const maxRetries = retryOptions?.maxRetries || config.maxRetries;
        const minTimeout = retryOptions?.minTimeout || config.minRetryDelayMs;
        const timeoutFactor = retryOptions?.timeoutFactor || 2;
        const maxTimeout = retryOptions?.maxTimeout || 30_000;

        const errorCode = (error as { code?: string }).code;
        const statusCode = (error as { statusCode?: number }).statusCode;

        console.warn(
          `[overpass-sdk] retry ${state.counter}/${maxRetries} ` +
            `(code=${errorCode ?? "-"} status=${statusCode ?? "-"}) ` +
            `${error.message}`,
        );

        if (state.counter >= maxRetries) return callback(error);

        const delayMs = Math.min(
          minTimeout * timeoutFactor ** state.counter,
          maxTimeout,
        );

        state.counter++;
        setTimeout(() => callback(null), delayMs);
      },
    });
  }

  async query<TResponse = OverpassResponse>(
    queryText: string,
    options: OverpassQueryOptions = {},
  ): Promise<TResponse> {
    const normalizedQuery = queryText.trim();
    if (!normalizedQuery)
      throw new OverpassSdkError("Overpass query must be a non-empty string.");

    const requestUrl = new URL(this.apiUrl);

    const headers = new Headers({
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": this.userAgent,
    });
    if (options.headers)
      for (const [key, value] of new Headers(options.headers)) {
        headers.set(key, value);
      }

    let statusCode: number;
    let text: string;
    try {
      const response = await this.dispatcher.request({
        origin: requestUrl.origin,
        path: requestUrl.pathname + requestUrl.search,
        method: "POST",
        headers,
        body: new URLSearchParams({ data: normalizedQuery }).toString(),
        signal: options.signal ?? undefined,
      });

      statusCode = response.statusCode;
      text = await response.body.text();
    } catch (error) {
      if (options.signal?.aborted) {
        throw new OverpassSdkError("Overpass request was aborted.", {
          url: requestUrl,
          cause: error,
        });
      }
      throw new OverpassSdkError(
        error instanceof Error ? error.message : "Overpass request failed.",
        { url: requestUrl, cause: error },
      );
    }

    const isOk = statusCode >= 200 && statusCode < 300;

    let payload: unknown;
    if (text.trim()) {
      try {
        payload = JSON.parse(text);
      } catch {
        if (isOk) {
          throw new OverpassSdkError(
            "Overpass response body was not valid JSON.",
            { status: statusCode, url: requestUrl, responseBody: text },
          );
        }
        payload = text;
      }
    } else {
      payload = {};
    }

    if (!isOk)
      throw new OverpassSdkError(
        `Overpass request failed with status ${statusCode}.`,
        { status: statusCode, url: requestUrl, responseBody: payload },
      );

    return payload as TResponse;
  }
}
