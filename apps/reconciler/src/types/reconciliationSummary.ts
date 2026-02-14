export interface ReconciliationSummary {
  updated: number;
  created: number;
  deleted: number;
  skippedCreateNearby: number;
  skippedDeleteNotAedOnly: number;
  unchanged: number;
}
