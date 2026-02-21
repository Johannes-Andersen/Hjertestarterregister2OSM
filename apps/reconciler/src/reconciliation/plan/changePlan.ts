import type {
  ChangePlan as OsmChangePlan,
  PlannedCreateChange,
  PlannedDeleteChange,
  PlannedModifyChange,
  PlannedNode,
} from "@repo/osm-sdk";

export type { PlannedNode };

type RegisterScopedCreateChange = PlannedCreateChange & {
  registerId: string;
};

type RegisterScopedModifyChange = PlannedModifyChange & {
  registerId: string;
};

type RegisterScopedDeleteChange = PlannedDeleteChange & {
  registerId: string;
};

export interface ReconciliationChangePlan {
  create: RegisterScopedCreateChange[];
  modify: RegisterScopedModifyChange[];
  delete: RegisterScopedDeleteChange[];
}

export const createReconciliationChangePlan = (): ReconciliationChangePlan => ({
  create: [],
  modify: [],
  delete: [],
});

export const hasPlannedChanges = (changePlan: ReconciliationChangePlan) =>
  changePlan.create.length > 0 ||
  changePlan.modify.length > 0 ||
  changePlan.delete.length > 0;

export const toOsmChangePlan = (
  changePlan: ReconciliationChangePlan,
): OsmChangePlan => ({
  create: changePlan.create.map(
    ({ registerId: _registerId, ...change }) => change,
  ),
  modify: changePlan.modify.map(
    ({ registerId: _registerId, ...change }) => change,
  ),
  delete: changePlan.delete.map(
    ({ registerId: _registerId, ...change }) => change,
  ),
});
