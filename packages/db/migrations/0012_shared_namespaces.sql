CREATE TABLE "namespace_reservations" (
  "name" text PRIMARY KEY,
  "entity_type" text NOT NULL,
  "entity_id" text NOT NULL
);
--> statement-breakpoint
-- Fail on existing collisions rather than silently assigning somebody else's name.
INSERT INTO namespace_reservations (name, entity_type, entity_id)
SELECT lower(username), 'user', id FROM users
UNION ALL
SELECT lower(name), 'organization', id::text FROM organizations;
--> statement-breakpoint
CREATE FUNCTION reserve_profile_namespace() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE namespace_name text;
DECLARE kind text;
BEGIN
  kind := CASE WHEN TG_TABLE_NAME = 'users' THEN 'user' ELSE 'organization' END;
  IF TG_OP = 'DELETE' THEN
    DELETE FROM namespace_reservations WHERE entity_type = kind AND entity_id = OLD.id::text;
    RETURN OLD;
  END IF;
  namespace_name := lower(CASE WHEN kind = 'user' THEN to_jsonb(NEW)->>'username' ELSE to_jsonb(NEW)->>'name' END);
  IF TG_OP = 'UPDATE' THEN
    DELETE FROM namespace_reservations WHERE entity_type = kind AND entity_id = OLD.id::text;
  END IF;
  INSERT INTO namespace_reservations (name, entity_type, entity_id) VALUES (namespace_name, kind, NEW.id::text);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER users_reserve_namespace BEFORE INSERT OR UPDATE OF username OR DELETE ON users
FOR EACH ROW EXECUTE FUNCTION reserve_profile_namespace();
--> statement-breakpoint
CREATE TRIGGER organizations_reserve_namespace BEFORE INSERT OR UPDATE OF name OR DELETE ON organizations
FOR EACH ROW EXECUTE FUNCTION reserve_profile_namespace();
