interface SyncStoreErrorOptions {
  cause?: unknown;
  runId?: string | undefined;
}

export class SyncStoreError extends Error {
  readonly runId: string | undefined;

  constructor(message: string, options: SyncStoreErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = "SyncStoreError";
    this.runId = options.runId;
  }
}
