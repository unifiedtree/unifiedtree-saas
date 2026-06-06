-- ============================================================================
-- V052 - module catalog: make the 12 canonical (website pricing) modules
--        available so a free signup auto-activates whatever a workspace
--        selected, instead of parking the selection as REQUESTED forever.
-- ============================================================================
-- The 12 canonical keys are exactly the website pricing ids:
--   hrms, attendance, payroll, accounting, inventory, crm,
--   purchase, sales, projects, manufacturing, pos, reports
--
-- BUILT today:        hrms, attendance.
-- COMING-SOON (live): the other 10 are productized as static screens, but
--                     must still be selectable/activatable at signup.
--
-- V002 originally seeded only hrms/attendance/leave as is_available=TRUE and
-- a different (legacy) key set. This forward migration is idempotent and only
-- touches the 12 canonical keys: it upserts name/description/availability and
-- leaves every other catalog row (e.g. leave, recruitment) untouched.
--
-- Do NOT edit the already-applied V002 migration.
-- ============================================================================

INSERT INTO platform.module_catalog (key, display_name, description, category, is_available) VALUES
    ('hrms',          'HRMS',          'Human resources, employee directory and org structure.', 'Core',          TRUE),
    ('attendance',    'Attendance',    'Attendance, time tracking and shifts.',                  'Core',          TRUE),
    ('payroll',       'Payroll',       'Payroll processing and compensation.',                   'Finance',       TRUE),
    ('accounting',    'Accounting',    'Accounting, ledgers, invoices and payments.',            'Finance',       TRUE),
    ('inventory',     'Inventory',     'Stock, warehouses and inventory movements.',             'Operations',    TRUE),
    ('crm',           'CRM',           'Leads, deals and customer relationship management.',      'Sales',         TRUE),
    ('purchase',      'Purchase',      'Purchase orders, vendors and procurement.',              'Operations',    TRUE),
    ('sales',         'Sales',         'Sales orders, quotations and fulfilment.',               'Sales',         TRUE),
    ('projects',      'Projects',      'Project planning, tasks and timesheets.',                'Operations',    TRUE),
    ('manufacturing', 'Manufacturing', 'Bill of materials, work orders and production.',         'Operations',    TRUE),
    ('pos',           'POS',           'Point of sale and retail checkout.',                     'Sales',         TRUE),
    ('reports',       'Reports',       'Cross-module reporting and analytics.',                  'Insights',      TRUE)
ON CONFLICT (key) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description  = COALESCE(EXCLUDED.description, platform.module_catalog.description),
    category     = COALESCE(EXCLUDED.category, platform.module_catalog.category),
    is_available = TRUE;
