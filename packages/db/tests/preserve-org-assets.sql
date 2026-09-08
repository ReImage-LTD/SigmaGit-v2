BEGIN;
INSERT INTO users (id, username, name, email) VALUES
 ('org-delete-test-a', 'org-delete-test-a', 'A', 'org-delete-a@example.com'),
 ('org-delete-test-b', 'org-delete-test-b', 'B', 'org-delete-b@example.com');
INSERT INTO organizations (id, name, display_name) VALUES ('00000000-0000-0000-0000-000000000099', 'org-delete-test', 'Test');
INSERT INTO organization_members (organization_id, user_id, role) VALUES
 ('00000000-0000-0000-0000-000000000099', 'org-delete-test-a', 'owner'),
 ('00000000-0000-0000-0000-000000000099', 'org-delete-test-b', 'owner');
INSERT INTO repositories (name, owner_id, organization_id) VALUES ('retained', 'org-delete-test-a', '00000000-0000-0000-0000-000000000099');
DELETE FROM users WHERE id = 'org-delete-test-a';
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM repositories WHERE name = 'retained' AND owner_id = 'org-delete-test-b') THEN
   RAISE EXCEPTION 'Organization repository was not preserved';
 END IF;
 BEGIN
   DELETE FROM users WHERE id = 'org-delete-test-b';
   RAISE EXCEPTION 'Last owner deletion was allowed';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;
ROLLBACK;
