import { Agent, Headers, RetryAgent } from "undici";
import * as z from "zod";
import { HjertestarterregisterApiError } from "./errors.ts";
import type {
  ApiMessageResponse,
  ApiSuccessResponse,
  AssetListResponse,
  AssetMutationResponse,
  AssetUpsertPayload,
  CreateMessagePayload,
  HjertestarterregisterApiClientOptions,
  OAuthAccessTokenResponse,
  RequestOptions,
  SearchAssetsParams,
  SinceDateParams,
} from "./types.ts";
import {
  applyQuery,
  getErrorMessage,
  getGuidSegment,
  isRecord,
  normalizeRequestBody,
  parseApiMessage,
} from "./utils.ts";

const tokenSafetyWindowMs = 60_000;

const configSchema = z.object({
  baseUrl: z
    .string()
    .trim()
    .default("https://hjertestarterregister.113.no/ords/api/v1/")
    .transform((v) => (v.endsWith("/") ? v : `${v}/`)),
  oauthTokenUrl: z
    .string()
    .trim()
    .default("https://hjertestarterregister.113.no/ords/api/oauth/token"),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  maxRetries: z.int().nonnegative().default(3),
});

export class HjertestarterregisterApiClient {
  readonly baseUrl: string;
  readonly oauthTokenUrl: URL;

  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly dispatcher: RetryAgent;

  private cachedToken?: string;
  private cachedTokenExpiresAtMs?: number;
  private pendingTokenPromise?: Promise<string>;

  constructor(options: HjertestarterregisterApiClientOptions) {
    const config = configSchema.parse(options);
    this.baseUrl = config.baseUrl;
    this.oauthTokenUrl = new URL(config.oauthTokenUrl);
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;

    this.dispatcher = new RetryAgent(new Agent(), {
      maxRetries: config.maxRetries,
      throwOnError: false,
      retry: (error, context, callback) => {
        const {
          state,
          opts: { retryOptions },
        } = context;

        const maxRetries = retryOptions?.maxRetries || config.maxRetries;
        const minTimeout = retryOptions?.minTimeout || 1000;
        const timeoutFactor = retryOptions?.timeoutFactor || 2;
        const maxTimeout = retryOptions?.maxTimeout || 30_000;

        const errorCode = (error as { code?: string }).code;
        const statusCode = (error as { statusCode?: number }).statusCode;

        console.warn(
          `[hjertestarterregister-sdk] retry ${state.counter}/${maxRetries} ` +
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

  async searchAssets(
    params: SearchAssetsParams = {},
  ): Promise<AssetListResponse> {
    return this.request<AssetListResponse>({
      method: "GET",
      path: "assets/search/",
      query: params,
    });
  }

  async searchDeletedAssets(
    params: SinceDateParams = {},
  ): Promise<AssetListResponse> {
    return this.request<AssetListResponse>({
      method: "GET",
      path: "assets/deleted/",
      query: params,
    });
  }

  async searchInactiveAssets(
    params: SinceDateParams = {},
  ): Promise<AssetListResponse> {
    return this.request<AssetListResponse>({
      method: "GET",
      path: "assets/inactive/",
      query: params,
    });
  }

  async getMyAssets(): Promise<AssetListResponse> {
    return this.request<AssetListResponse>({
      method: "GET",
      path: "assets/",
    });
  }

  async getAsset(guid: string): Promise<AssetListResponse> {
    return this.request<AssetListResponse>({
      method: "GET",
      path: `assets/${getGuidSegment(guid)}`,
    });
  }

  async activateAsset(
    guid: string,
    body: Record<string, unknown> = { dummy: 42 },
  ): Promise<ApiMessageResponse> {
    return this.request<ApiMessageResponse>({
      method: "PUT",
      path: `assets/${getGuidSegment(guid)}/active`,
      body,
    });
  }

  async deactivateAsset(
    guid: string,
    body: Record<string, unknown> = { dummy: 42 },
  ): Promise<ApiMessageResponse> {
    return this.request<ApiMessageResponse>({
      method: "PUT",
      path: `assets/${getGuidSegment(guid)}/inactive`,
      body,
    });
  }

  async deleteAsset(
    guid: string,
    body: Record<string, unknown> = { dummy: 42 },
  ): Promise<AssetMutationResponse> {
    return this.request<AssetMutationResponse>({
      method: "DELETE",
      path: `assets/${getGuidSegment(guid)}`,
      body,
    });
  }

  async createAsset(
    payload: AssetUpsertPayload,
  ): Promise<AssetMutationResponse> {
    return this.request<AssetMutationResponse>({
      method: "POST",
      path: "assets/",
      body: payload,
    });
  }

  async updateAsset(
    guid: string,
    payload: AssetUpsertPayload,
  ): Promise<AssetMutationResponse> {
    return this.request<AssetMutationResponse>({
      method: "PUT",
      path: `assets/${getGuidSegment(guid)}`,
      body: payload,
    });
  }

  async createMessage(
    guid: string,
    payload: CreateMessagePayload,
  ): Promise<AssetMutationResponse> {
    return this.request<AssetMutationResponse>({
      method: "POST",
      path: `assets/${getGuidSegment(guid)}/message`,
      body: payload,
    });
  }

  private async request<TResponse extends ApiSuccessResponse>({
    method,
    path,
    query,
    body,
  }: RequestOptions): Promise<TResponse> {
    const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
    const url = new URL(normalizedPath, this.baseUrl);
    applyQuery(url, query);

    const bearerToken = await this.getAccessToken();
    const headers = new Headers({
      Accept: "application/json",
      Authorization: `Bearer ${bearerToken}`,
    });

    let requestBody: string | undefined;
    if (body) {
      headers.set("Content-Type", "application/json");
      requestBody = JSON.stringify(normalizeRequestBody(body));
    }

    const { statusCode, body: responseBody } = await this.dispatcher.request({
      origin: url.origin,
      path: url.pathname + url.search,
      method,
      headers,
      body: requestBody,
    });

    const text = await responseBody.text();
    const payload = this.parseJsonText(text, statusCode, url.toString());
    const parsedMessage = parseApiMessage(payload);
    const isOk = statusCode >= 200 && statusCode < 300;

    if (!isOk) {
      throw new HjertestarterregisterApiError(
        getErrorMessage(
          parsedMessage,
          `Request failed with status ${statusCode}.`,
        ),
        {
          status: statusCode,
          url: url.toString(),
          apiError: parsedMessage.apiError,
          apiMessage: parsedMessage.apiMessage,
          responseBody: payload,
        },
      );
    }

    if (parsedMessage.apiError) {
      throw new HjertestarterregisterApiError(
        getErrorMessage(parsedMessage, "API returned an error payload."),
        {
          status: statusCode,
          url: url.toString(),
          apiError: parsedMessage.apiError,
          apiMessage: parsedMessage.apiMessage,
          responseBody: payload,
        },
      );
    }

    if (!isRecord(payload)) {
      throw new HjertestarterregisterApiError(
        "API returned a non-object JSON payload.",
        {
          status: statusCode,
          url: url.toString(),
          responseBody: payload,
        },
      );
    }

    console.log(`Successful ${method} request to ${url.pathname}`);

    return payload as TResponse;
  }

  private async getAccessToken(): Promise<string> {
    if (
      this.cachedToken &&
      this.cachedTokenExpiresAtMs !== undefined &&
      Date.now() < this.cachedTokenExpiresAtMs - tokenSafetyWindowMs
    ) {
      return this.cachedToken;
    }

    if (this.pendingTokenPromise) return this.pendingTokenPromise;

    this.pendingTokenPromise = this.requestAccessToken()
      .then((tokenResponse) => {
        this.cachedToken = tokenResponse.access_token;
        this.cachedTokenExpiresAtMs =
          Date.now() + tokenResponse.expires_in * 1000;
        return tokenResponse.access_token;
      })
      .finally(() => {
        this.pendingTokenPromise = undefined;
      });

    return this.pendingTokenPromise;
  }

  private async requestAccessToken(): Promise<OAuthAccessTokenResponse> {
    const authorization = `Basic ${btoa(`${this.clientId}:${this.clientSecret}`)}`;

    const { statusCode, body } = await this.dispatcher.request({
      origin: this.oauthTokenUrl.origin,
      path: this.oauthTokenUrl.pathname,
      method: "POST",
      headers: new Headers({
        Accept: "application/json",
        Authorization: authorization,
        "Content-Type": "application/x-www-form-urlencoded",
      }),
      body: new URLSearchParams({
        grant_type: "client_credentials",
      }).toString(),
    });

    const text = await body.text();
    const oauthUrl = this.oauthTokenUrl.toString();
    const payload = this.parseJsonText(text, statusCode, oauthUrl);
    const parsedMessage = parseApiMessage(payload);
    const isOk = statusCode >= 200 && statusCode < 300;

    if (!isOk) {
      throw new HjertestarterregisterApiError(
        getErrorMessage(
          parsedMessage,
          `OAuth token request failed with status ${statusCode}.`,
        ),
        {
          status: statusCode,
          url: oauthUrl,
          apiError: parsedMessage.apiError,
          apiMessage: parsedMessage.apiMessage,
          responseBody: payload,
        },
      );
    }

    if (
      !isRecord(payload) ||
      typeof payload.access_token !== "string" ||
      typeof payload.token_type !== "string" ||
      typeof payload.expires_in !== "number"
    ) {
      throw new HjertestarterregisterApiError(
        "OAuth token response did not match expected structure.",
        {
          status: statusCode,
          url: oauthUrl,
          responseBody: payload,
        },
      );
    }

    return {
      access_token: payload.access_token,
      token_type: payload.token_type,
      expires_in: payload.expires_in,
    };
  }

  private parseJsonText(
    text: string,
    statusCode: number,
    url: string,
  ): unknown {
    if (!text.trim()) return {};

    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new HjertestarterregisterApiError(
        "Response body was not valid JSON.",
        { status: statusCode, url, responseBody: text },
      );
    }
  }
}
