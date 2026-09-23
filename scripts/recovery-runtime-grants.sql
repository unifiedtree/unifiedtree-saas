-- Local recovery database only: runtime uses a non-owner, non-superuser role
-- so PostgreSQL row-level security applies during API acceptance checks.
DO $$
DECLARE schema_name TEXT;
BEGIN
  FOR schema_name IN SELECT nspname FROM pg_namespace
    WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'
  LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO ut_app', schema_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO ut_app', schema_name);
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO ut_app', schema_name);
    EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA %I TO ut_app', schema_name);
  END LOOP;
END $$;
