import type { ReconciliationSummary } from "../types/reconciliationSummary.ts";

export const createReconciliationSummary = (): ReconciliationSummary => ({
  updated: 0,
  created: 0,
  deleted: 0,
  registryAeds: 0,
});
