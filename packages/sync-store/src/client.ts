import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import type {
  NewSyncIssue,
  SyncIssueTypeCount,
  SyncOverviewStats,
  SyncRunIssueRecord,
  SyncRunMetrics,
  SyncRunMode,
  SyncRunRecord,
  SyncRunStatus,
} from "./types.ts";

type SyncSql = Sql<Record<string, never>>;

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

interface CompleteSyncRunInput {
  runId: string;
  status: Exclude<SyncRunStatus, "running">;
  finishedAt?: Date;
  errorMessage?: string;
  metrics?: Partial<SyncRunMetrics>;
}

interface ListSyncRunIssuesOptions {
  runId?: string;
  limit?: number;
}

interface ReplaceCurrentRunIssuesInput {
  runId: string;
  issues: NewSyncIssue[];
}

const defaultPoolSize = 5;

const defaultMetrics: SyncRunMetrics = {
  registryAeds: 0,
  osmAeds: 0,
  managedOsmAeds: 0,
  uniqueManagedOsmAeds: 0,
  linkedAeds: 0,
  updated: 0,
  created: 0,
  deleted: 0,
  skippedCreateNearby: 0,
  skippedDeleteNotAedOnly: 0,
  unchanged: 0,
};

const normalizeLimit = (
  value: number | undefined,
  fallback: number,
  max: number,
): number => {
  if (!Number.isFinite(value) || value === undefined) return fallback;
  const rounded = Math.trunc(value);
  if (rounded <= 0) return fallback;
  return Math.min(rounded, max);
};

const getConnectionStringFromEnv = (): string => {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) return databaseUrl;

  const planetscaleDatabaseUrl = process.env.PLANETSCALE_DATABASE_URL;
  if (planetscaleDatabaseUrl) return planetscaleDatabaseUrl;

  throw new Error(
    "Missing database URL. Set DATABASE_URL (or PLANETSCALE_DATABASE_URL) for sync-store.",
  );
};

const normalizeMetrics = (
  metrics: Partial<SyncRunMetrics> | undefined,
): SyncRunMetrics => ({
  registryAeds: metrics?.registryAeds ?? defaultMetrics.registryAeds,
  osmAeds: metrics?.osmAeds ?? defaultMetrics.osmAeds,
  managedOsmAeds: metrics?.managedOsmAeds ?? defaultMetrics.managedOsmAeds,
  uniqueManagedOsmAeds:
    metrics?.uniqueManagedOsmAeds ?? defaultMetrics.uniqueManagedOsmAeds,
  linkedAeds: metrics?.linkedAeds ?? defaultMetrics.linkedAeds,
  updated: metrics?.updated ?? defaultMetrics.updated,
  created: metrics?.created ?? defaultMetrics.created,
  deleted: metrics?.deleted ?? defaultMetrics.deleted,
  skippedCreateNearby:
    metrics?.skippedCreateNearby ?? defaultMetrics.skippedCreateNearby,
  skippedDeleteNotAedOnly:
    metrics?.skippedDeleteNotAedOnly ?? defaultMetrics.skippedDeleteNotAedOnly,
  unchanged: metrics?.unchanged ?? defaultMetrics.unchanged,
});

const toJsonValue = (value: Record<string, unknown> | undefined): JsonValue => {
  try {
    return JSON.parse(JSON.stringify(value ?? {})) as JsonValue;
  } catch {
    return {};
  }
};

const selectSyncRunColumns = (sql: SyncSql) => sql`
  id,
  started_at as "startedAt",
  finished_at as "finishedAt",
  status,
  mode,
  error_message as "errorMessage",
  registry_aeds_count as "registryAeds",
  osm_aeds_count as "osmAeds",
  managed_osm_aeds_count as "managedOsmAeds",
  unique_managed_osm_aeds_count as "uniqueManagedOsmAeds",
  linked_aeds_count as "linkedAeds",
  updated_count as "updated",
  created_count as "created",
  deleted_count as "deleted",
  skipped_create_nearby_count as "skippedCreateNearby",
  skipped_delete_not_aed_only_count as "skippedDeleteNotAedOnly",
  unchanged_count as "unchanged",
  created_at as "createdAt",
  updated_at as "updatedAt"
`;

const selectIssueColumns = (sql: SyncSql) => sql`
  id,
  run_id as "runId",
  issue_type as "issueType",
  severity,
  message,
  register_ref as "registerRef",
  osm_node_id as "osmNodeId",
  details,
  created_at as "createdAt",
  updated_at as "updatedAt"
`;

declare global {
  var __syncStoreSql__: SyncSql | undefined;
}

export const getSyncStoreSql = (): SyncSql => {
  if (!globalThis.__syncStoreSql__) {
    globalThis.__syncStoreSql__ = postgres(getConnectionStringFromEnv(), {
      ssl: "require",
      max: defaultPoolSize,
      connect_timeout: 20,
      idle_timeout: 30,
      prepare: false,
    });
  }

  return globalThis.__syncStoreSql__;
};

export const closeSyncStore = async (): Promise<void> => {
  if (!globalThis.__syncStoreSql__) return;
  await globalThis.__syncStoreSql__.end({ timeout: 5 });
  globalThis.__syncStoreSql__ = undefined;
};

export const startSyncRun = async ({
  mode,
  startedAt = new Date(),
}: {
  mode: SyncRunMode;
  startedAt?: Date;
}): Promise<SyncRunRecord> => {
  const sql = getSyncStoreSql();
  const runId = randomUUID();

  const [row] = await sql<SyncRunRecord[]>`
    INSERT INTO sync_runs (
      id,
      started_at,
      status,
      mode
    ) VALUES (
      ${runId},
      ${startedAt},
      ${"running"},
      ${mode}
    )
    RETURNING ${selectSyncRunColumns(sql)}
  `;

  if (!row) {
    throw new Error("Failed to create sync run record.");
  }

  return row;
};

export const completeSyncRun = async ({
  runId,
  status,
  finishedAt = new Date(),
  errorMessage,
  metrics,
}: CompleteSyncRunInput): Promise<SyncRunRecord> => {
  const sql = getSyncStoreSql();
  const resolvedMetrics = normalizeMetrics(metrics);

  const [row] = await sql<SyncRunRecord[]>`
    UPDATE sync_runs
    SET
      status = ${status},
      finished_at = ${finishedAt},
      error_message = ${errorMessage ?? null},
      registry_aeds_count = ${resolvedMetrics.registryAeds},
      osm_aeds_count = ${resolvedMetrics.osmAeds},
      managed_osm_aeds_count = ${resolvedMetrics.managedOsmAeds},
      unique_managed_osm_aeds_count = ${resolvedMetrics.uniqueManagedOsmAeds},
      linked_aeds_count = ${resolvedMetrics.linkedAeds},
      updated_count = ${resolvedMetrics.updated},
      created_count = ${resolvedMetrics.created},
      deleted_count = ${resolvedMetrics.deleted},
      skipped_create_nearby_count = ${resolvedMetrics.skippedCreateNearby},
      skipped_delete_not_aed_only_count = ${resolvedMetrics.skippedDeleteNotAedOnly},
      unchanged_count = ${resolvedMetrics.unchanged},
      updated_at = NOW()
    WHERE id = ${runId}
    RETURNING ${selectSyncRunColumns(sql)}
  `;

  if (!row) {
    throw new Error(`Failed to update sync run ${runId}.`);
  }

  return row;
};

export const replaceCurrentRunIssues = async ({
  runId,
  issues,
}: ReplaceCurrentRunIssuesInput): Promise<void> => {
  const sql = getSyncStoreSql();

  await sql.begin(async (tx) => {
    await tx`
      DELETE FROM sync_run_issues
    `;

    for (const issue of issues) {
      await tx`
        INSERT INTO sync_run_issues (
          id,
          run_id,
          issue_type,
          severity,
          message,
          register_ref,
          osm_node_id,
          details
        ) VALUES (
          ${randomUUID()},
          ${runId},
          ${issue.type},
          ${issue.severity},
          ${issue.message},
          ${issue.registerRef ?? null},
          ${issue.osmNodeId ?? null},
          ${tx.json(toJsonValue(issue.details))}
        )
      `;
    }
  });
};

export const getSyncRunById = async (
  runId: string,
): Promise<SyncRunRecord | null> => {
  const sql = getSyncStoreSql();

  const [row] = await sql<SyncRunRecord[]>`
    SELECT ${selectSyncRunColumns(sql)}
    FROM sync_runs
    WHERE id = ${runId}
    LIMIT 1
  `;

  return row ?? null;
};

export const listRecentSyncRuns = async (
  limit?: number,
): Promise<SyncRunRecord[]> => {
  const sql = getSyncStoreSql();
  const normalizedLimit = normalizeLimit(limit, 30, 200);

  return sql<SyncRunRecord[]>`
    SELECT ${selectSyncRunColumns(sql)}
    FROM sync_runs
    ORDER BY started_at DESC
    LIMIT ${normalizedLimit}
  `;
};

export const listSyncRunIssues = async (
  options: ListSyncRunIssuesOptions = {},
): Promise<SyncRunIssueRecord[]> => {
  const sql = getSyncStoreSql();
  const normalizedLimit = normalizeLimit(options.limit, 200, 1000);

  if (options.runId) {
    return sql<SyncRunIssueRecord[]>`
      SELECT ${selectIssueColumns(sql)}
      FROM sync_run_issues
      WHERE run_id = ${options.runId}
      ORDER BY created_at DESC
      LIMIT ${normalizedLimit}
    `;
  }

  return sql<SyncRunIssueRecord[]>`
    SELECT ${selectIssueColumns(sql)}
    FROM sync_run_issues
    ORDER BY created_at DESC
    LIMIT ${normalizedLimit}
  `;
};

export const listIssueTypeCounts = async (): Promise<SyncIssueTypeCount[]> => {
  const sql = getSyncStoreSql();

  return sql<SyncIssueTypeCount[]>`
    SELECT
      issue_type as "issueType",
      COUNT(*)::int as "count"
    FROM sync_run_issues
    GROUP BY issue_type
    ORDER BY "count" DESC, "issueType" ASC
  `;
};

export const getSyncOverviewStats = async (): Promise<SyncOverviewStats> => {
  const sql = getSyncStoreSql();

  const [latestRun, latestSuccessfulRun, issueTotals] = await Promise.all([
    sql<SyncRunRecord[]>`
      SELECT ${selectSyncRunColumns(sql)}
      FROM sync_runs
      ORDER BY started_at DESC
      LIMIT 1
    `,
    sql<SyncRunRecord[]>`
      SELECT ${selectSyncRunColumns(sql)}
      FROM sync_runs
      WHERE status = ${"success"}
      ORDER BY finished_at DESC NULLS LAST
      LIMIT 1
    `,
    sql<{ issueCount: number }[]>`
      SELECT
        COUNT(*)::int as "issueCount"
      FROM sync_run_issues
    `,
  ]);

  const currentIssueCount = issueTotals[0]?.issueCount ?? 0;

  return {
    latestRun: latestRun[0] ?? null,
    latestSuccessfulRun: latestSuccessfulRun[0] ?? null,
    openIssueCount: currentIssueCount,
    totalIssueCount: currentIssueCount,
  };
};
