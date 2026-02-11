export interface PlannedNode {
  id: number;
  lat: number;
  lon: number;
  version?: number;
  tags: Record<string, string | undefined>;
}

interface PlannedCreateChange {
  registerId: string;
  node: PlannedNode;
}

interface PlannedModifyChange {
  registerId: string;
  before: PlannedNode;
  after: PlannedNode;
  tagUpdates: Record<string, string | undefined>;
}

interface PlannedDeleteChange {
  registerId: string;
  node: PlannedNode;
}

export interface ChangePlan {
  create: PlannedCreateChange[];
  modify: PlannedModifyChange[];
  delete: PlannedDeleteChange[];
}

export const createChangePlan = (): ChangePlan => ({
  create: [],
  modify: [],
  delete: [],
});

export const hasPlannedChanges = (changePlan: ChangePlan) =>
  changePlan.create.length > 0 ||
  changePlan.modify.length > 0 ||
  changePlan.delete.length > 0;
