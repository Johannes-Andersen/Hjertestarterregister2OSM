import type { ReconciliationSummary } from "../types/reconciliationSummary.ts";

export const createReconciliationSummary = (): ReconciliationSummary => ({
  updated: 0,
  created: 0,
  deleted: 0,
  skippedCreateNearby: 0,
  skippedDeleteNotAedOnly: 0,
  unchanged: 0,
});
