ALTER TABLE "repositories" ADD COLUMN "star_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
LOCK TABLE "stars" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
UPDATE repositories SET star_count = counts.total FROM (SELECT repository_id, count(*)::int AS total FROM stars GROUP BY repository_id) counts WHERE repositories.id = counts.repository_id;
--> statement-breakpoint
CREATE FUNCTION sigmagit_update_star_count() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE repositories SET star_count = star_count + 1 WHERE id = NEW.repository_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE repositories SET star_count = star_count - 1 WHERE id = OLD.repository_id;
  ELSIF OLD.repository_id IS DISTINCT FROM NEW.repository_id THEN
    PERFORM id FROM repositories WHERE id IN (OLD.repository_id, NEW.repository_id) ORDER BY id FOR UPDATE;
    UPDATE repositories SET star_count = star_count - 1 WHERE id = OLD.repository_id;
    UPDATE repositories SET star_count = star_count + 1 WHERE id = NEW.repository_id;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER stars_count_change AFTER INSERT OR DELETE OR UPDATE OF repository_id ON stars FOR EACH ROW EXECUTE FUNCTION sigmagit_update_star_count();
--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_user_read_created_idx" ON "notifications" USING btree ("user_id","read","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "repositories_visibility_stars_idx" ON "repositories" USING btree ("visibility","star_count" DESC NULLS LAST,"id" DESC NULLS LAST);