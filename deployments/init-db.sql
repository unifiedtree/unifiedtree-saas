-- UnifiedTree Database Initialization
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- Create additional schemas for module isolation (future use)
-- CREATE SCHEMA IF NOT EXISTS hrms;
-- CREATE SCHEMA IF NOT EXISTS crm;
-- CREATE SCHEMA IF NOT EXISTS accounts;

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE unifiedtree TO nexus;
GRANT ALL ON SCHEMA public TO nexus;
