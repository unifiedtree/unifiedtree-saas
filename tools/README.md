# UnifiedTree Developer Tools

A collection of Node.js scripts for development, validation, and code generation tasks.

---

## `module-health-check.js`

Validates that all expected backend modules exist and have a `pom.xml` file present.

**Usage:**
```bash
node tools/module-health-check.js
```

**What it checks:**
- Scans all 14 expected backend modules under `backend/platform`, `backend/modules`, and `backend/services`
- Reports `[OK]` for each module whose `pom.xml` is present
- Reports `[MISSING]` for each module that is absent
- Exits with code `1` if any modules are missing (CI-friendly)

---

## `check-tenant-isolation.js`

Scans backend Java source files for bare `findAll()` calls that may bypass tenant-scoped filtering, potentially leaking cross-tenant data.

**Usage:**
```bash
node tools/check-tenant-isolation.js
```

**What it checks:**
- Searches all `.java` files under `backend/` for unqualified `findAll()` calls
- Reports files that should be reviewed to ensure they extend `TenantAwareRepository` or filter by `tenantId`
- Requires `grep` on the host system (Linux/macOS/WSL). Prints a note on Windows if grep is unavailable.

**Best practice:**
All tenant-aware repositories should either:
- Extend `TenantAwareRepository<T, ID>` (auto-injects tenant filter)
- Use `findByTenantId(String tenantId, ...)` naming convention
- Apply `@TenantFilter` annotation (if using Hibernate Filters)

---

## `generate-flyway-migration.js`

Generates a new Flyway SQL migration file with an auto-incremented version number, placed in the standard migration directory.

**Usage:**
```bash
node tools/generate-flyway-migration.js "add user preferences table"
node tools/generate-flyway-migration.js "create_audit_log_indexes"
```

**Output:**
Creates a file like `V042__add_user_preferences_table.sql` in:
```
backend/app/erp-app/src/main/resources/db/migration/
```

The generated file includes a standard header with migration name, description, and creation date.

**Notes:**
- Version numbers are zero-padded to 3 digits (e.g., `V001`, `V042`, `V100`)
- The description is slugified automatically (spaces → underscores, special chars removed)
- If the migration directory doesn't exist, it is created automatically
- Always review the generated file and add your SQL before committing

---

## Running all checks (CI pipeline)

```bash
node tools/module-health-check.js && node tools/check-tenant-isolation.js
```
