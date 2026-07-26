CREATE TABLE "aed" (
	"asset_id" integer PRIMARY KEY NOT NULL,
	"asset_guid" text NOT NULL,
	"site_name" text NOT NULL,
	"site_address" text NOT NULL,
	"site_latitude" double precision NOT NULL,
	"site_longitude" double precision NOT NULL,
	"site_floor_number" double precision,
	"site_post_code" text,
	"site_post_area" text,
	"site_description" text,
	"is_mobile" boolean NOT NULL,
	"created_date" timestamp with time zone NOT NULL,
	"modified_date" timestamp with time zone NOT NULL,
	"active_from_date" timestamp with time zone,
	"active_to_date" timestamp with time zone,
	"opening_hours_limited" boolean NOT NULL,
	"opening_hours_closed_holidays" boolean NOT NULL,
	"opening_hours" jsonb NOT NULL,
	"deletedAt" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "aed_asset_guid_unique" UNIQUE("asset_guid"),
	CONSTRAINT "aed_asset_id_check" CHECK ("aed"."asset_id" > 0),
	CONSTRAINT "aed_site_latitude_check" CHECK ("aed"."site_latitude" BETWEEN -90 AND 90),
	CONSTRAINT "aed_site_longitude_check" CHECK ("aed"."site_longitude" BETWEEN -180 AND 180)
);
--> statement-breakpoint
CREATE TABLE "aed_registry_event_outbox" (
	"event_id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"asset_id" integer NOT NULL,
	"asset_guid" text NOT NULL,
	"source" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "aed_registry_event_outbox_asset_id_check" CHECK ("aed_registry_event_outbox"."asset_id" > 0),
	CONSTRAINT "aed_registry_event_outbox_event_type_check" CHECK ("aed_registry_event_outbox"."event_type" IN ('aed.created', 'aed.updated', 'aed.deleted')),
	CONSTRAINT "aed_registry_event_outbox_source_check" CHECK ("aed_registry_event_outbox"."source" IN ('full-sync', 'incremental-sync'))
);
--> statement-breakpoint
CREATE TABLE "aed_registry_sync_state" (
	"singleton_id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"last_full_sync_at" timestamp with time zone,
	"last_incremental_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "aed_registry_sync_state_singleton_check" CHECK ("aed_registry_sync_state"."singleton_id" = 1)
);
--> statement-breakpoint
CREATE INDEX "aed_deleted_at_idx" ON "aed" USING btree ("deletedAt");--> statement-breakpoint
CREATE INDEX "aed_modified_date_idx" ON "aed" USING btree ("modified_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "aed_registry_event_outbox_pending_idx" ON "aed_registry_event_outbox" USING btree ("created_at") WHERE "aed_registry_event_outbox"."published_at" IS NULL;