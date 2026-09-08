-- Run against an isolated database with the migrations applied. Always rolls back.
BEGIN;
INSERT INTO users (id, username, name, email) VALUES ('namespace-test-user', 'namespace-test-alice', 'Test', 'namespace-test@example.com');
DO $$ BEGIN
  BEGIN
    INSERT INTO organizations (name, display_name) VALUES ('NAMESPACE-TEST-ALICE', 'Collision');
    RAISE EXCEPTION 'cross-type namespace collision was allowed';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;
INSERT INTO organizations (name, display_name) VALUES ('namespace-test-acme', 'Acme');
DO $$ BEGIN
  BEGIN
    UPDATE users SET username = 'NAMESPACE-TEST-ACME' WHERE id = 'namespace-test-user';
    RAISE EXCEPTION 'rename collision was allowed';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;
DELETE FROM organizations WHERE name = 'namespace-test-acme';
UPDATE users SET username = 'namespace-test-acme' WHERE id = 'namespace-test-user';
ROLLBACK;
