CREATE TABLE "osm_sync_state" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"replication_sequence" bigint,
	"replication_timestamp" timestamp with time zone,
	"replication_base_url" text,
	"planet_source_url" text,
	"planet_file_path" text,
	"planet_etag" text,
	"planet_last_modified" timestamp with time zone,
	"planet_content_length" bigint,
	"planet_imported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "osm_sync_state_singleton_check" CHECK ("osm_sync_state"."id" = 1),
	CONSTRAINT "osm_sync_state_replication_sequence_check" CHECK ("osm_sync_state"."replication_sequence" IS NULL OR "osm_sync_state"."replication_sequence" >= 0)
);
--> statement-breakpoint
CREATE TABLE "osm_aed" (
	"element_type" text NOT NULL,
	"element_id" bigint NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"version" integer,
	"changeset" bigint,
	"uid" bigint,
	"user_name" text,
	"osm_timestamp" timestamp with time zone,
	"tags" jsonb NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "osm_aed_element_type_element_id_pk" PRIMARY KEY("element_type","element_id"),
	CONSTRAINT "osm_aed_element_type_check" CHECK ("osm_aed"."element_type" = 'node'),
	CONSTRAINT "osm_aed_element_id_check" CHECK ("osm_aed"."element_id" > 0),
	CONSTRAINT "osm_aed_latitude_check" CHECK ("osm_aed"."latitude" BETWEEN -90 AND 90),
	CONSTRAINT "osm_aed_longitude_check" CHECK ("osm_aed"."longitude" BETWEEN -180 AND 180)
);
--> statement-breakpoint
CREATE TABLE "osm_aed_history" (
	"history_id" bigserial PRIMARY KEY NOT NULL,
	"element_type" text NOT NULL,
	"element_id" bigint NOT NULL,
	"version" integer NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"changeset" bigint,
	"uid" bigint,
	"user_name" text,
	"osm_timestamp" timestamp with time zone,
	"tags" jsonb NOT NULL,
	"is_aed" boolean NOT NULL,
	"is_deleted" boolean NOT NULL,
	"source" text NOT NULL,
	"replication_sequence" bigint,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "osm_aed_history_element_version_unique" UNIQUE("element_type","element_id","version"),
	CONSTRAINT "osm_aed_history_element_type_check" CHECK ("osm_aed_history"."element_type" = 'node'),
	CONSTRAINT "osm_aed_history_element_id_check" CHECK ("osm_aed_history"."element_id" > 0),
	CONSTRAINT "osm_aed_history_version_check" CHECK ("osm_aed_history"."version" > 0),
	CONSTRAINT "osm_aed_history_source_check" CHECK ("osm_aed_history"."source" IN ('planet', 'minute'))
);
--> statement-breakpoint
CREATE INDEX "osm_aed_deleted_at_idx" ON "osm_aed" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "osm_aed_osm_timestamp_idx" ON "osm_aed" USING btree ("osm_timestamp" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "osm_aed_tags_gin_idx" ON "osm_aed" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "osm_aed_history_element_idx" ON "osm_aed_history" USING btree ("element_type","element_id","version" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "osm_aed_history_timestamp_idx" ON "osm_aed_history" USING btree ("osm_timestamp" DESC NULLS LAST);