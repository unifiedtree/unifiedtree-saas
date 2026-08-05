-- ============================================================================
-- V086 - Sellable module PLANS (the 9 merged website products) + Razorpay
--        PAYMENTS ledger. Workspace creation is now paid-first.
-- ============================================================================
-- The website used to render 12 modules from a hardcoded data/modules.ts file.
-- Product now wants 9 merged, DB-driven products, priced, with a paid signup:
--
--   1. HR & Employees        (bundles hrms + attendance + payroll + leave)  AVAILABLE  Rs 40/mo
--   2. Accounting & Inventory(bundles accounting + inventory)               LAUNCHING_SOON
--   3. CRM                                                                  LAUNCHING_SOON
--   4. Purchase                                                             LAUNCHING_SOON
--   5. Sales                                                                LAUNCHING_SOON
--   6. Projects                                                             LAUNCHING_SOON
--   7. Manufacturing                                                        LAUNCHING_SOON
--   8. Point of Sale                                                        LAUNCHING_SOON
--   9. Reports & BI                                                         LAUNCHING_SOON
--
-- We do NOT touch platform.module_catalog (the FUNCTIONAL module keys that
-- tenant_modules.module_key references) so existing tenants keep working. A
-- plan's included_modules[] lists which catalog keys it activates on purchase.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. module_plans: the sellable products shown on the website pricing page.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.module_plans (
    key               VARCHAR(50)    PRIMARY KEY,
    display_name      VARCHAR(100)   NOT NULL,
    tagline           VARCHAR(200),                 -- sub-captions e.g. "Attendance - Payroll"
    description       TEXT,
    category          VARCHAR(50),
    icon              VARCHAR(50),                  -- lucide icon name (frontend hint)
    color             VARCHAR(20),
    -- price_inr is the monthly price PER SEAT (per user). Billed amount is
    -- price_inr * seats. HR & Employees = Rs 40 / user / month.
    price_inr         NUMERIC(12,2)  NOT NULL DEFAULT 0,
    price_model       VARCHAR(10)    NOT NULL DEFAULT 'PER_SEAT'
                        CHECK (price_model IN ('PER_SEAT', 'FLAT')),
    -- AVAILABLE = purchasable now; LAUNCHING_SOON = shown locked, not purchasable.
    status            VARCHAR(20)    NOT NULL DEFAULT 'LAUNCHING_SOON'
                        CHECK (status IN ('AVAILABLE', 'LAUNCHING_SOON', 'RETIRED')),
    sort_order        INT            NOT NULL DEFAULT 0,
    features          JSONB          NOT NULL DEFAULT '[]'::jsonb,
    -- Functional platform.module_catalog keys this plan unlocks when purchased.
    included_modules  TEXT[]         NOT NULL DEFAULT '{}',
    created_at        TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ    NOT NULL DEFAULT now()
);

COMMENT ON TABLE platform.module_plans IS
    'Sellable website products (merged from the 12 functional modules). '
    'Priced, DB-driven; drives the pricing page and paid signup. '
    'included_modules[] maps a plan to the functional module_catalog keys it activates.';

-- ----------------------------------------------------------------------------
-- 2. payments: Razorpay order/payment ledger. One row per checkout attempt.
--    Order lifecycle: CREATED -> PAID (signature+capture verified) -> CONSUMED
--    (a workspace was created from it). CONSUMED is the idempotency guard so a
--    single paid order can never spawn two workspaces.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.payments (
    id                   UUID           PRIMARY KEY,
    razorpay_order_id    VARCHAR(64)    NOT NULL UNIQUE,
    razorpay_payment_id  VARCHAR(64),
    amount_inr           NUMERIC(12,2)  NOT NULL,          -- rupees (not paise) = per-seat price * seats
    seats                INT            NOT NULL DEFAULT 1, -- number of users billed
    currency             VARCHAR(10)    NOT NULL DEFAULT 'INR',
    status               VARCHAR(20)    NOT NULL DEFAULT 'CREATED'
                           CHECK (status IN ('CREATED', 'PAID', 'FAILED', 'CONSUMED')),
    plan_keys            TEXT[]         NOT NULL,          -- module_plans.key[] purchased
    subdomain            VARCHAR(63),
    contact_email        VARCHAR(255),
    tenant_id            UUID,                             -- set once the workspace is created
    signature_verified   BOOLEAN        NOT NULL DEFAULT FALSE,
    created_at           TIMESTAMPTZ    NOT NULL DEFAULT now(),
    paid_at              TIMESTAMPTZ,
    consumed_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payments_order   ON platform.payments(razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_payments_status  ON platform.payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_email   ON platform.payments(contact_email);

COMMENT ON TABLE platform.payments IS
    'Razorpay checkout ledger for paid workspace signup. status CONSUMED = a '
    'workspace has already been created from this order (idempotency guard).';

-- ----------------------------------------------------------------------------
-- 3. Seed the 9 plans. Idempotent upsert so re-running only refreshes content.
--    price_inr and status are the levers product will tweak later (via an admin
--    screen), never hardcoded in the frontend again.
-- ----------------------------------------------------------------------------
INSERT INTO platform.module_plans
    (key, display_name, tagline, description, category, icon, color, price_inr, status, sort_order, features, included_modules)
VALUES
    ('hr-employees', 'HR & Employees', 'Attendance - Payroll',
     'Complete workforce management: employee lifecycle, face and geo-fenced attendance, and India-compliant payroll in one module.',
     'Human Resources', 'Users', '#0F6E56', 40, 'AVAILABLE', 1,
     '["Employee records and digital profiles","Org chart with department hierarchy","Face recognition and GPS geo-fenced attendance","Offline attendance that syncs when back online","Shift, roster and overtime tracking","Leave and holiday management","Automated payroll with PF, ESI and TDS","Payslip generation and distribution","Employee self-service portal"]'::jsonb,
     ARRAY['hrms','attendance','payroll','leave']),

    ('accounting-inventory', 'Accounting & Inventory', 'Ledgers - Stock',
     'GST-ready accounting and real-time multi-warehouse inventory, together. Invoicing, P&L, stock valuation and batch tracking.',
     'Finance', 'BarChart2', '#F59E0B', 0, 'LAUNCHING_SOON', 2,
     '["GST invoicing and e-way bills","P&L, Balance Sheet and Cash Flow","Bank reconciliation (auto-match)","Multi-warehouse stock management","Batch, serial and expiry tracking","Stock valuation (FIFO / LIFO / Avg)"]'::jsonb,
     ARRAY['accounting','inventory']),

    ('crm', 'CRM', 'Leads - Deals',
     'Manage leads, pipelines and quotations. Convert prospects with automated follow-ups.',
     'Sales', 'Target', '#EF4444', 0, 'LAUNCHING_SOON', 3,
     '["Lead capture and qualification","Kanban sales pipeline","Quotation and proposal builder","Email and WhatsApp follow-up automation","Sales forecasting and reports"]'::jsonb,
     ARRAY['crm']),

    ('purchase', 'Purchase', 'Procurement - Vendors',
     'Streamline procurement from PO creation to GRN with 3-way matching.',
     'Operations', 'ShoppingCart', '#14B8A6', 0, 'LAUNCHING_SOON', 4,
     '["Purchase order creation and approval","Goods receipt note (GRN)","Vendor management and comparison","3-way matching (PO / GRN / Invoice)","Vendor performance analytics"]'::jsonb,
     ARRAY['purchase']),

    ('sales', 'Sales', 'Orders - Fulfilment',
     'Sales orders, delivery scheduling and dynamic pricing rules from order to dispatch.',
     'Sales', 'TrendingUp', '#F97316', 0, 'LAUNCHING_SOON', 5,
     '["Sales order management","Delivery scheduling and tracking","Price lists and discount rules","Customer portal access","Revenue analytics and targets"]'::jsonb,
     ARRAY['sales']),

    ('projects', 'Projects', 'Tasks - Timesheets',
     'Task boards, milestones, timesheets and Gantt charts to keep projects on track.',
     'Productivity', 'Kanban', '#06B6D4', 0, 'LAUNCHING_SOON', 6,
     '["Kanban and list task views","Milestones and Gantt chart","Time tracking and timesheets","Budget vs actuals tracking","Project billing and invoicing"]'::jsonb,
     ARRAY['projects']),

    ('manufacturing', 'Manufacturing', 'BOM - Work Orders',
     'Bill of Materials, work orders and MRP planning to run your shop floor from the browser.',
     'Operations', 'Settings', '#84CC16', 0, 'LAUNCHING_SOON', 7,
     '["Bill of Materials (multi-level)","Work orders and production planning","MRP - material requirements planning","Quality control checkpoints","Machine and workcenter scheduling"]'::jsonb,
     ARRAY['manufacturing']),

    ('pos', 'Point of Sale', 'Retail - Billing',
     'Offline-capable POS for retail and restaurants: instant billing, receipt printing and live sync.',
     'Sales', 'Monitor', '#A855F7', 0, 'LAUNCHING_SOON', 8,
     '["Touch-friendly POS interface","Offline mode - works without internet","Receipt and KOT printing","Multiple payment methods","End-of-day reports and cash management"]'::jsonb,
     ARRAY['pos']),

    ('reports', 'Reports & BI', 'Dashboards - KPIs',
     'Custom dashboards, KPI tracking and data exports - every metric leadership needs.',
     'Productivity', 'PieChart', '#0EA5E9', 0, 'LAUNCHING_SOON', 9,
     '["Drag-and-drop dashboard builder","Cross-module KPI tracking","Scheduled email reports","Excel, PDF, CSV exports","Real-time analytics engine"]'::jsonb,
     ARRAY['reports'])
ON CONFLICT (key) DO UPDATE SET
    display_name     = EXCLUDED.display_name,
    tagline          = EXCLUDED.tagline,
    description      = EXCLUDED.description,
    category         = EXCLUDED.category,
    icon             = EXCLUDED.icon,
    color            = EXCLUDED.color,
    price_inr        = EXCLUDED.price_inr,
    status           = EXCLUDED.status,
    sort_order       = EXCLUDED.sort_order,
    features         = EXCLUDED.features,
    included_modules = EXCLUDED.included_modules,
    updated_at       = now();

-- ----------------------------------------------------------------------------
-- 4. Grants. The app connects as ut_app (NOSUPERUSER / NOBYPASSRLS). These
--    platform.* tables are NOT RLS-protected (platform-global), so ut_app just
--    needs table DML. Mirrors the grant pattern in DEPLOY.md for new tables.
-- ----------------------------------------------------------------------------
-- Guarded so the migration also runs on databases that have no ut_app role
-- (integration-test containers, a fresh local dev DB). Same pattern as V084.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.module_plans TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.payments     TO ut_app;
    END IF;
END $$;
