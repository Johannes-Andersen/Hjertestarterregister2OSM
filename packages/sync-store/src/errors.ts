interface SyncStoreErrorOptions {
  cause?: unknown;
  runId?: string;
}

export class SyncStoreError extends Error {
  readonly runId?: string;

  constructor(message: string, options: SyncStoreErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = "SyncStoreError";
    this.runId = options.runId;
  }
}
