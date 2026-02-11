export interface ReconciliationSummary {
  updated: number;
  created: number;
  deleted: number;
  skippedCreateNearby: number;
  skippedDeleteNotAedOnly: number;
  unchanged: number;
}

export const createReconciliationSummary = (): ReconciliationSummary => ({
  updated: 0,
  created: 0,
  deleted: 0,
  skippedCreateNearby: 0,
  skippedDeleteNotAedOnly: 0,
  unchanged: 0,
});
