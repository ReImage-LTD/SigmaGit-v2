-- Optimize DB usage: make full-text search_vector columns GENERATED + populated,
-- and add missing foreign-key indexes for reverse lookups on junction tables.
-- Idempotent: safe to re-run.

-- ============================================================================
-- 1. search_vector: convert the four unused plain tsvector columns into
--    GENERATED ALWAYS AS (...) STORED columns so the existing GIN indexes
--    (repositories_search_idx, issues_search_idx, pull_requests_search_idx,
--    discussions_search_idx) actually index real data. The columns were never
--    populated, so dropping/recreating loses nothing.
--    Uses the immutable 2-arg to_tsvector('english', ...) form required by
--    STORED generated columns. Weight A = title/name, B = body/description.
-- ============================================================================

-- repositories (name + description)
DROP INDEX IF EXISTS "repositories_search_idx";
ALTER TABLE "repositories" DROP COLUMN IF EXISTS "search_vector";
ALTER TABLE "repositories" ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("name", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("description", '')), 'B')
  ) STORED;
CREATE INDEX "repositories_search_idx" ON "repositories" USING gin ("search_vector");

-- issues (title + body)
DROP INDEX IF EXISTS "issues_search_idx";
ALTER TABLE "issues" DROP COLUMN IF EXISTS "search_vector";
ALTER TABLE "issues" ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("body", '')), 'B')
  ) STORED;
CREATE INDEX "issues_search_idx" ON "issues" USING gin ("search_vector");

-- pull_requests (title + body)
DROP INDEX IF EXISTS "pull_requests_search_idx";
ALTER TABLE "pull_requests" DROP COLUMN IF EXISTS "search_vector";
ALTER TABLE "pull_requests" ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("body", '')), 'B')
  ) STORED;
CREATE INDEX "pull_requests_search_idx" ON "pull_requests" USING gin ("search_vector");

-- discussions (title + body)
DROP INDEX IF EXISTS "discussions_search_idx";
ALTER TABLE "discussions" DROP COLUMN IF EXISTS "search_vector";
ALTER TABLE "discussions" ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("body", '')), 'B')
  ) STORED;
CREATE INDEX "discussions_search_idx" ON "discussions" USING gin ("search_vector");

-- ============================================================================
-- 2. Missing FK indexes for reverse lookups. The composite PK already covers
--    the leading column, so only the trailing column needs an index.
-- ============================================================================
CREATE INDEX IF NOT EXISTS "accounts_user_id_idx" ON "accounts" ("user_id");
CREATE INDEX IF NOT EXISTS "issue_labels_label_id_idx" ON "issue_labels" ("label_id");
CREATE INDEX IF NOT EXISTS "issue_assignees_user_id_idx" ON "issue_assignees" ("user_id");
CREATE INDEX IF NOT EXISTS "pr_labels_label_id_idx" ON "pr_labels" ("label_id");
CREATE INDEX IF NOT EXISTS "pr_assignees_user_id_idx" ON "pr_assignees" ("user_id");
CREATE INDEX IF NOT EXISTS "pr_reviewers_user_id_idx" ON "pr_reviewers" ("user_id");
CREATE INDEX IF NOT EXISTS "gist_stars_gist_id_idx" ON "gist_stars" ("gist_id");
