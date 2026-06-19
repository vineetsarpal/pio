CREATE TABLE "audit_snapshots" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"policy_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"policy_id" text NOT NULL,
	"kind" text NOT NULL,
	"reference" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_events" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"policy_id" text NOT NULL,
	"kind" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_snapshots" ADD CONSTRAINT "audit_snapshots_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_snapshots_id_unique" ON "audit_snapshots" USING btree ("id");--> statement-breakpoint
CREATE INDEX "audit_snapshots_policy_id_idx" ON "audit_snapshots" USING btree ("policy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_policy_kind_reference_unique" ON "payment_events" USING btree ("policy_id","kind","reference");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_one_payout_request_per_policy" ON "payment_events" USING btree ("policy_id") WHERE kind = 'payout_requested';--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_one_payout_per_policy" ON "payment_events" USING btree ("policy_id") WHERE kind = 'payout_issued';--> statement-breakpoint
CREATE INDEX "payment_events_policy_id_idx" ON "payment_events" USING btree ("policy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_events_id_unique" ON "workflow_events" USING btree ("id");--> statement-breakpoint
CREATE INDEX "workflow_events_policy_id_idx" ON "workflow_events" USING btree ("policy_id");