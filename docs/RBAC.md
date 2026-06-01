# Role-Based Access Control (RBAC)

## Role Hierarchy

UnifiedTree defines five built-in roles in descending order of privilege:

| Role | Description |
|---|---|
| `SUPER_ADMIN` | UnifiedTree internal staff; cross-tenant access to all resources |
| `ADMIN` | Tenant administrator; full access within their workspace |
| `MANAGER` | Module-level management; can approve, configure, and report |
| `EMPLOYEE` | Standard user; read/write access to own records |
| `VIEWER` | Read-only access; cannot create or modify any records |

Roles are stored in the `roles` table per tenant. Each role has a set of permissions assigned in the `role_permissions` join table. Users can hold a single role per tenant.

## Permission Code Format

All permissions follow the format:

```
{module}:{resource}:{action}
```

- `module` — the ERP module key (`hrms`, `crm`, `accounts`, `payroll`, `inventory`, `procurement`, `projects`, `helpdesk`, `analytics`, `platform`)
- `resource` — the entity or feature (`employees`, `leaves`, `invoices`, `tickets`, etc.)
- `action` — the operation (`read`, `create`, `update`, `delete`, `approve`, `export`)

Examples:
- `hrms:employees:read`
- `hrms:leaves:approve`
- `crm:deals:delete`
- `accounts:invoices:export`

## Seeded Permissions (52 total)

| Module | Permissions |
|---|---|
| **hrms** | `employees:read`, `employees:create`, `employees:update`, `employees:delete`, `leaves:read`, `leaves:create`, `leaves:approve`, `attendance:read`, `attendance:update` |
| **crm** | `leads:read`, `leads:create`, `leads:update`, `leads:delete`, `deals:read`, `deals:create`, `deals:update`, `customers:read`, `customers:create`, `customers:update` |
| **accounts** | `invoices:read`, `invoices:create`, `invoices:update`, `invoices:delete`, `invoices:export`, `payments:read`, `payments:create`, `expenses:read`, `expenses:create`, `expenses:approve` |
| **payroll** | `payslips:read`, `payslips:generate`, `payroll:approve`, `payroll:export` |
| **inventory** | `items:read`, `items:create`, `items:update`, `stock:read`, `stock:adjust` |
| **procurement** | `purchase-orders:read`, `purchase-orders:create`, `purchase-orders:approve`, `vendors:read`, `vendors:create` |
| **projects** | `projects:read`, `projects:create`, `tasks:read`, `tasks:create`, `tasks:update`, `time-entries:read`, `time-entries:create` |
| **helpdesk** | `tickets:read`, `tickets:create`, `tickets:assign`, `tickets:close` |
| **analytics** | `reports:read`, `reports:export`, `dashboards:read` |
| **platform** | `users:read`, `users:invite`, `roles:read`, `roles:update`, `modules:read` |

## Checking Permissions in Java

Use Spring Security's method-level security with a custom `PermissionEvaluator`:

```java
@RestController
@RequestMapping("/api/v1/hrms/employees")
public class EmployeeController {

    @GetMapping
    @PreAuthorize("hasPermission(null, 'hrms:employees:read')")
    public Page<EmployeeDto> list(Pageable pageable) { ... }

    @PostMapping
    @PreAuthorize("hasPermission(null, 'hrms:employees:create')")
    public EmployeeDto create(@Valid @RequestBody CreateEmployeeRequest req) { ... }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasPermission(null, 'hrms:employees:delete')")
    public void delete(@PathVariable UUID id) { ... }
}
```

The custom `NexusPermissionEvaluator` checks whether the authenticated user's role (resolved from the JWT `role` claim) has the requested permission in the `role_permissions` table — with the result cached in Redis for the duration of the session.

## Checking Permissions in React

### Hook

```tsx
import { usePermission } from '@/platform/shared/hooks/usePermission';

function EmployeeActions({ employee }) {
  const canDelete = usePermission('hrms:employees:delete');

  return (
    <div>
      {canDelete && (
        <Button variant="destructive" onClick={() => deleteEmployee(employee.id)}>
          Delete
        </Button>
      )}
    </div>
  );
}
```

### Gate Component

```tsx
import { PermissionGate } from '@/platform/shared/components/PermissionGate';

function EmployeePage() {
  return (
    <div>
      <EmployeeList />
      <PermissionGate permission="hrms:employees:create">
        <CreateEmployeeButton />
      </PermissionGate>
    </div>
  );
}
```

`usePermission` reads from `authStore.permissions` (an array populated from the JWT `permissions` claim on login). The backend always validates independently — the frontend check is purely for UX.

## Adding a New Permission

Follow these four steps:

**1. Write a Flyway migration** (`V{n}__add_{module}_{resource}_{action}_permission.sql`):

```sql
INSERT INTO permissions (id, code, module_key, description)
VALUES (uuid_generate_v4(), 'crm:contacts:merge', 'crm', 'Merge duplicate CRM contacts')
ON CONFLICT (code) DO NOTHING;

-- Grant to ADMIN and MANAGER roles (adjust as appropriate)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name IN ('ADMIN', 'MANAGER')
  AND p.code = 'crm:contacts:merge'
ON CONFLICT DO NOTHING;
```

**2. Add the constant** to `packages/shared-types/src/permissions.ts`:

```typescript
export const PERMISSIONS = {
  // ... existing
  CRM_CONTACTS_MERGE: 'crm:contacts:merge',
} as const;
```

**3. Use the constant** in both Java (`@PreAuthorize`) and React (`usePermission` / `<PermissionGate>`).

**4. Add the permission** to `RBAC.md` permission table (this file) so the seed list stays current.
