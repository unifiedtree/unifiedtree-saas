-- Pre-create hrms_app as a LOGIN role so the app DataSource can connect as it.
-- Permissions are granted by Flyway V025. This script runs at PostgreSQL container
-- startup (before Spring context) so HikariCP can authenticate on first connection.
CREATE ROLE hrms_app LOGIN PASSWORD 'hrms_app_test' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE;
