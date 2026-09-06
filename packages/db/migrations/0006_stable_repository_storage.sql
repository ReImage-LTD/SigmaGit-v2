-- Keep all existing object paths. New repositories get independent namespaces.
ALTER TABLE "repositories" ADD COLUMN "storage_owner_id" text;
--> statement-breakpoint
UPDATE "repositories" SET "storage_owner_id" = coalesce("organization_id"::text, "owner_id");
--> statement-breakpoint
ALTER TABLE "repositories" ALTER COLUMN "storage_owner_id" SET DEFAULT gen_random_uuid()::text;
--> statement-breakpoint
ALTER TABLE "repositories" ALTER COLUMN "storage_owner_id" SET NOT NULL;
