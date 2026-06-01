-- =============================================================================
-- MODULE: hrms-expense
-- Tables: expense_policies, expense_claims, expense_items
-- Purpose: Employee expense reimbursement — policy definition, claim submission,
--          manager approval, and finance reimbursement workflow.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TABLE: expense_policies
-- Per-company rules for each expense category.
-- category (ExpenseCategory): TRAVEL | FOOD | ACCOMMODATION | COMMUNICATION |
--   OFFICE_SUPPLIES | MEDICAL | TRAINING | ENTERTAINMENT | OTHER
-- max_amount_per_claim: NULL = no limit.
-- -----------------------------------------------------------------------------
CREATE TABLE expense_policies (
    id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                 UUID          NOT NULL,
    company_id                UUID          NOT NULL,  -- → companies.id
    name                      VARCHAR(200)  NOT NULL,
    category                  VARCHAR(50)   NOT NULL,  -- TRAVEL | FOOD | ACCOMMODATION | COMMUNICATION | OFFICE_SUPPLIES | MEDICAL | TRAINING | ENTERTAINMENT | OTHER
    max_amount_per_claim      NUMERIC(15,2),            -- NULL = unlimited
    requires_receipt          BOOLEAN       DEFAULT true,
    requires_manager_approval BOOLEAN       DEFAULT true,
    requires_hr_approval      BOOLEAN       DEFAULT false,
    is_active                 BOOLEAN       DEFAULT true,
    created_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by                VARCHAR(255),
    updated_by                VARCHAR(255),
    version                   BIGINT        NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_expense_policies_company ON expense_policies (company_id, is_active);

-- -----------------------------------------------------------------------------
-- TABLE: expense_claims
-- An employee's reimbursement claim (header record).
-- status: DRAFT | SUBMITTED | APPROVED | REJECTED | REIMBURSED
-- total_amount: sum of all expense_items.amount (maintained by the app).
-- reimbursed_at: set by Finance after bank transfer.
-- -----------------------------------------------------------------------------
CREATE TABLE expense_claims (
    id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID          NOT NULL,
    employee_id      UUID          NOT NULL,  -- → employees.id (claimant)
    company_id       UUID          NOT NULL,  -- → companies.id
    title            VARCHAR(300)  NOT NULL,
    total_amount     NUMERIC(15,2) NOT NULL,
    currency         VARCHAR(10)   DEFAULT 'INR',
    status           VARCHAR(30)   NOT NULL DEFAULT 'DRAFT',  -- DRAFT | SUBMITTED | APPROVED | REJECTED | REIMBURSED
    submitted_at     TIMESTAMPTZ,
    approver_id      UUID,                    -- → employees.id (manager who approves)
    approved_at      TIMESTAMPTZ,
    approver_comment TEXT,
    reimbursed_at    TIMESTAMPTZ,             -- set by Finance after payment
    notes            TEXT,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by       VARCHAR(255),
    updated_by       VARCHAR(255),
    version          BIGINT        NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_expense_claims_employee ON expense_claims (employee_id, status);
CREATE INDEX IF NOT EXISTS idx_expense_claims_approver ON expense_claims (approver_id, status);
CREATE INDEX IF NOT EXISTS idx_expense_claims_company  ON expense_claims (company_id, status);

-- -----------------------------------------------------------------------------
-- TABLE: expense_items
-- Individual line items within an expense claim.
-- category: same ExpenseCategory enum as expense_policies.
-- receipt_url: object storage path for uploaded receipt image/PDF.
-- Cascades delete with the parent claim.
-- -----------------------------------------------------------------------------
CREATE TABLE expense_items (
    id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID          NOT NULL,
    claim_id      UUID          NOT NULL REFERENCES expense_claims(id) ON DELETE CASCADE,
    category      VARCHAR(50)   NOT NULL,  -- TRAVEL | FOOD | ACCOMMODATION | COMMUNICATION | OFFICE_SUPPLIES | MEDICAL | TRAINING | ENTERTAINMENT | OTHER
    description   TEXT,
    amount        NUMERIC(15,2) NOT NULL,
    expense_date  DATE          NOT NULL,
    receipt_url   TEXT,                    -- object storage path (generate signed URL per request)
    merchant_name VARCHAR(200),
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by    VARCHAR(255),
    updated_by    VARCHAR(255),
    version       BIGINT        NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_expense_items_claim ON expense_items (claim_id);

COMMENT ON COLUMN expense_items.receipt_url IS 'Object storage path. Generate pre-signed URL per request; do not expose raw path.';
