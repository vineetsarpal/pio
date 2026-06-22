CREATE TABLE "pricing_jobs" (
	"quote_id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "pricing_jobs_pending_created_idx" ON "pricing_jobs" USING btree ("status","created_at");