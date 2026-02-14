import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import * as z from "zod";
import { SyncStoreError } from "./errors.ts";
import type {
  NewSyncIssue,
  SyncRunMetrics,
  SyncRunMode,
  SyncStoreClientOptions,
} from "./types.ts";

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

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
