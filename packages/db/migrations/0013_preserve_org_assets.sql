CREATE FUNCTION preserve_organization_assets_on_user_delete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org_id uuid;
DECLARE replacement_id text;
BEGIN
  FOR org_id IN
    SELECT o.id FROM organizations o WHERE
      EXISTS (SELECT 1 FROM organization_members m WHERE m.organization_id = o.id AND m.user_id = OLD.id AND m.role = 'owner')
      OR EXISTS (SELECT 1 FROM repositories r WHERE r.organization_id = o.id AND r.owner_id = OLD.id)
    ORDER BY o.id FOR UPDATE
  LOOP
    SELECT m.user_id INTO replacement_id FROM organization_members m
      WHERE m.organization_id = org_id AND m.role = 'owner' AND m.user_id <> OLD.id
      ORDER BY m.user_id LIMIT 1;
    IF replacement_id IS NULL THEN
      RAISE EXCEPTION 'Transfer organization ownership before deleting this account'
        USING ERRCODE = '23514', CONSTRAINT = 'organization_requires_owner';
    END IF;
    UPDATE repositories SET owner_id = replacement_id WHERE organization_id = org_id AND owner_id = OLD.id;
  END LOOP;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER users_preserve_organization_assets BEFORE DELETE ON users
FOR EACH ROW EXECUTE FUNCTION preserve_organization_assets_on_user_delete();
