CREATE TABLE "dmca_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_id" text,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"copyright_holder" text NOT NULL,
	"copyright_holder_email" text NOT NULL,
	"copyright_holder_address" text NOT NULL,
	"copyright_holder_phone" text,
	"original_work_description" text NOT NULL,
	"original_work_url" text,
	"infringing_urls" text NOT NULL,
	"description" text NOT NULL,
	"sworn_statement" boolean NOT NULL,
	"perjury_statement" boolean NOT NULL,
	"signature" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"admin_notes" text,
	"resolved_by_id" text,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_listing_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"cover_letter" text,
	"resume_url" text,
	"linkedin_url" text,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"department" text,
	"location" text,
	"employment_type" text DEFAULT 'full_time' NOT NULL,
	"open" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "job_listings_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" text,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"reason" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"admin_notes" text,
	"resolved_by_id" text,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repositories" drop column "search_vector";
--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce("repositories"."name", '')), 'A') || setweight(to_tsvector('english', coalesce("repositories"."description", '')), 'B')) STORED;
--> statement-breakpoint
ALTER TABLE "discussions" drop column "search_vector";
--> statement-breakpoint
ALTER TABLE "discussions" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce("discussions"."title", '')), 'A') || setweight(to_tsvector('english', coalesce("discussions"."body", '')), 'B')) STORED;
--> statement-breakpoint
ALTER TABLE "issues" drop column "search_vector";
--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce("issues"."title", '')), 'A') || setweight(to_tsvector('english', coalesce("issues"."body", '')), 'B')) STORED;
--> statement-breakpoint
ALTER TABLE "pull_requests" drop column "search_vector";
--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce("pull_requests"."title", '')), 'A') || setweight(to_tsvector('english', coalesce("pull_requests"."body", '')), 'B')) STORED;
--> statement-breakpoint
ALTER TABLE "dmca_requests" ADD CONSTRAINT "dmca_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "dmca_requests" ADD CONSTRAINT "dmca_requests_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_job_listing_id_job_listings_id_fk" FOREIGN KEY ("job_listing_id") REFERENCES "public"."job_listings"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "dmca_requests_status_idx" ON "dmca_requests" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "dmca_requests_target_type_idx" ON "dmca_requests" USING btree ("target_type");
--> statement-breakpoint
CREATE INDEX "dmca_requests_created_at_idx" ON "dmca_requests" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "job_applications_job_listing_id_idx" ON "job_applications" USING btree ("job_listing_id");
--> statement-breakpoint
CREATE INDEX "job_applications_email_idx" ON "job_applications" USING btree ("email");
--> statement-breakpoint
CREATE INDEX "job_applications_status_idx" ON "job_applications" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "job_listings_slug_idx" ON "job_listings" USING btree ("slug");
--> statement-breakpoint
CREATE INDEX "job_listings_open_idx" ON "job_listings" USING btree ("open");
--> statement-breakpoint
CREATE INDEX "reports_status_idx" ON "reports" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "reports_target_type_idx" ON "reports" USING btree ("target_type");
--> statement-breakpoint
CREATE INDEX "reports_created_at_idx" ON "reports" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "verifications_expires_at_idx" ON "verifications" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "repositories_organization_id_idx" ON "repositories" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "repositories_owner_updated_idx" ON "repositories" USING btree ("owner_id","updated_at");
--> statement-breakpoint
CREATE INDEX "repositories_owner_visibility_updated_idx" ON "repositories" USING btree ("owner_id","visibility","updated_at");
--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "workflow_jobs_status_created_at_idx" ON "workflow_jobs" USING btree ("status","created_at");
--> statement-breakpoint
CREATE INDEX "runners_last_seen_at_idx" ON "runners" USING btree ("last_seen_at");
--> statement-breakpoint
CREATE INDEX "issue_labels_label_id_idx" ON "issue_labels" USING btree ("label_id");
--> statement-breakpoint
CREATE INDEX "pr_labels_label_id_idx" ON "pr_labels" USING btree ("label_id");
--> statement-breakpoint
CREATE INDEX "issue_assignees_user_id_idx" ON "issue_assignees" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "pr_assignees_user_id_idx" ON "pr_assignees" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "pr_reviewers_user_id_idx" ON "pr_reviewers" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "stars_repository_id_idx" ON "stars" USING btree ("repository_id");
--> statement-breakpoint
CREATE INDEX "gist_stars_gist_id_idx" ON "gist_stars" USING btree ("gist_id");
--> statement-breakpoint
CREATE INDEX "repositories_search_idx" ON "repositories" USING gin ("search_vector");
--> statement-breakpoint
CREATE INDEX "discussions_search_idx" ON "discussions" USING gin ("search_vector");
--> statement-breakpoint
CREATE INDEX "issues_search_idx" ON "issues" USING gin ("search_vector");
--> statement-breakpoint
CREATE INDEX "pull_requests_search_idx" ON "pull_requests" USING gin ("search_vector");
