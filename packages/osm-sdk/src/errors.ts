interface OsmSdkErrorOptions {
  status?: number;
  statusText?: string;
  url?: string;
  nodeId?: number;
  responseBody?: unknown;
  cause?: unknown;
}

export class OsmSdkError extends Error {
  readonly status?: number;
  readonly statusText?: string;
  readonly url?: string;
  readonly nodeId?: number;
  readonly responseBody?: unknown;

  constructor(message: string, options: OsmSdkErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = "OsmSdkError";
    this.status = options.status;
    this.statusText = options.statusText;
    this.url = options.url;
    this.nodeId = options.nodeId;
    this.responseBody = options.responseBody;
  }
}
