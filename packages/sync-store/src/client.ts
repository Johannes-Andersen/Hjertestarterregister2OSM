import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import * as z from "zod";
import { SyncStoreError } from "./errors.ts";
import type {
  NewSyncIssue,
  SyncIssueTypeCount,
  SyncOverviewRunData,
  SyncOverviewStats,
  SyncRunIssueListItem,
  SyncRunListItem,
  SyncRunMetrics,
  SyncRunMode,
  SyncRunRecord,
  SyncStoreClientOptions,
} from "./types.ts";
import { getClampedLimit } from "./utils.ts";

const configSchema = z.object({
  connectionString: z.string().trim().min(1),
  maxConnections: z.int().positive().default(5),
  connectTimeoutSeconds: z.number().positive().default(20),
  idleTimeoutSeconds: z.number().positive().default(30),
});

const metricsSchema = z.object({
  registryAeds: z.int().nonnegative().default(0),
  osmAeds: z.int().nonnegative().default(0),
  linkedAeds: z.int().nonnegative().default(0),
  updated: z.int().nonnegative().default(0),
  created: z.int().nonnegative().default(0),
  deleted: z.int().nonnegative().default(0),
  skippedCreateNearby: z.int().nonnegative().default(0),
  skippedDeleteNotAedOnly: z.int().nonnegative().default(0),
  unchanged: z.int().nonnegative().default(0),
});

export class SyncStoreClient {
  private readonly sql: Sql;

  constructor(options: SyncStoreClientOptions) {
    const config = configSchema.parse(options);
    this.sql = postgres(config.connectionString, {
      ssl: "require",
      max: config.maxConnections,
      connect_timeout: config.connectTimeoutSeconds,
      idle_timeout: config.idleTimeoutSeconds,
      prepare: false,
    });
  }

  async startRun({ mode }: { mode: SyncRunMode }): Promise<{ id: string }> {
    const id = randomUUID();

    const [row] = await this.sql<{ id: string }[]>`
      INSERT INTO sync_runs (id, started_at, status, mode)
      VALUES (${id}, NOW(), 'running', ${mode})
      RETURNING id
    `;

    if (!row) {
      throw new SyncStoreError("Failed to create sync run.");
    }

    return row;
  }

  async completeRun(input: {
    runId: string;
    status: "success" | "failed";
    errorMessage?: string;
    metrics?: Partial<SyncRunMetrics>;
  }): Promise<void> {
    const m = metricsSchema.parse(input.metrics ?? {});

    const [row] = await this.sql<{ id: string }[]>`
      UPDATE sync_runs SET
        status = ${input.status},
        finished_at = NOW(),
        error_message = ${input.errorMessage ?? null},
        registry_aeds_count = ${m.registryAeds},
        osm_aeds_count = ${m.osmAeds},
        linked_aeds_count = ${m.linkedAeds},
        updated_count = ${m.updated},
        created_count = ${m.created},
        deleted_count = ${m.deleted},
        skipped_create_nearby_count = ${m.skippedCreateNearby},
        skipped_delete_not_aed_only_count = ${m.skippedDeleteNotAedOnly},
        unchanged_count = ${m.unchanged},
        updated_at = NOW()
      WHERE id = ${input.runId}
      RETURNING id
    `;

    if (!row) {
      throw new SyncStoreError(`Sync run ${input.runId} not found.`, {
        runId: input.runId,
      });
    }
  }

  async replaceRunIssues(input: {
    runId: string;
    issues: NewSyncIssue[];
  }): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`DELETE FROM sync_run_issues`;

      for (const issue of input.issues) {
        await tx`
          INSERT INTO sync_run_issues (
            id, run_id, issue_type, severity, message,
            register_ref, osm_node_id, details
          ) VALUES (
            ${randomUUID()},
            ${input.runId},
            ${issue.type},
            ${issue.severity},
            ${issue.message},
            ${issue.registerRef ?? null},
            ${issue.osmNodeId ?? null},
            ${tx.json(JSON.parse(JSON.stringify(issue.details ?? {})))}
          )
        `;
      }
    });
  }

  async getRunById(runId: string): Promise<SyncRunRecord | null> {
    const [row] = await this.sql<SyncRunRecord[]>`
      SELECT
        id,
        started_at as "startedAt",
        finished_at as "finishedAt",
        status,
        mode,
        error_message as "errorMessage",
        linked_aeds_count as "linkedAeds",
        updated_count as "updated",
        created_count as "created",
        deleted_count as "deleted",
        skipped_create_nearby_count as "skippedCreateNearby",
        skipped_delete_not_aed_only_count as "skippedDeleteNotAedOnly",
        unchanged_count as "unchanged"
      FROM sync_runs
      WHERE id = ${runId}
      LIMIT 1
    `;

    return row ?? null;
  }

  async listRunIssues(
    options: { runId?: string; limit?: number } = {},
  ): Promise<SyncRunIssueListItem[]> {
    const limit = getClampedLimit({
      limit: options.limit,
      fallback: 400,
      max: 1000,
    });

    if (options.runId) {
      return this.sql<SyncRunIssueListItem[]>`
        SELECT
          run_id as "runId",
          issue_type as "issueType",
          severity,
          message,
          register_ref as "registerRef",
          osm_node_id as "osmNodeId",
          created_at as "createdAt"
        FROM sync_run_issues
        WHERE run_id = ${options.runId}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
    }

    return this.sql<SyncRunIssueListItem[]>`
      SELECT
        run_id as "runId",
        issue_type as "issueType",
        severity,
        message,
        register_ref as "registerRef",
        osm_node_id as "osmNodeId",
        created_at as "createdAt"
      FROM sync_run_issues
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  }

  async listRecentRuns(limit?: number): Promise<SyncRunListItem[]> {
    const normalizedLimit = getClampedLimit({
      limit,
      fallback: 30,
      max: 200,
    });

    return this.sql<SyncRunListItem[]>`
      SELECT
        id,
        started_at as "startedAt",
        finished_at as "finishedAt",
        status,
        mode,
        updated_count as "updated",
        created_count as "created",
        deleted_count as "deleted",
        skipped_create_nearby_count as "skippedCreateNearby",
        skipped_delete_not_aed_only_count as "skippedDeleteNotAedOnly",
        unchanged_count as "unchanged"
      FROM sync_runs
      ORDER BY started_at DESC
      LIMIT ${normalizedLimit}
    `;
  }

  async listIssueTypeCounts(): Promise<SyncIssueTypeCount[]> {
    return this.sql<SyncIssueTypeCount[]>`
      SELECT
        issue_type as "issueType",
        COUNT(*)::int as "count"
      FROM sync_run_issues
      GROUP BY issue_type
      ORDER BY "count" DESC, "issueType" ASC
    `;
  }

  async getOverviewStats(): Promise<SyncOverviewStats> {
    const [latestRun, latestSuccessfulRun, issueTotals] = await Promise.all([
      this.sql<SyncOverviewRunData[]>`
        SELECT
          finished_at as "finishedAt",
          status,
          registry_aeds_count as "registryAeds",
          osm_aeds_count as "osmAeds",
          linked_aeds_count as "linkedAeds"
        FROM sync_runs
        ORDER BY started_at DESC
        LIMIT 1
      `,
      this.sql<SyncOverviewRunData[]>`
        SELECT
          finished_at as "finishedAt",
          status,
          registry_aeds_count as "registryAeds",
          osm_aeds_count as "osmAeds",
          linked_aeds_count as "linkedAeds"
        FROM sync_runs
        WHERE status = 'success'
        ORDER BY finished_at DESC NULLS LAST
        LIMIT 1
      `,
      this.sql<{ issueCount: number }[]>`
        SELECT COUNT(*)::int as "issueCount"
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
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
