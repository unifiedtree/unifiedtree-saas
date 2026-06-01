-- =============================================================================
-- MODULE: hrms-performance
-- Tables: review_cycles, goals, performance_reviews
-- Purpose: OKR/goal management and 360-degree performance review workflow.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TABLE: review_cycles
-- A named appraisal period (e.g. "H1 2025", "Annual 2025").
-- self_review_deadline: last date employees can submit self-assessment.
-- manager_review_deadline: last date managers can submit their rating.
-- Only one cycle per company should have is_active=true (enforced by app).
-- -----------------------------------------------------------------------------
CREATE TABLE review_cycles (
    id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID          NOT NULL,
    company_id              UUID          NOT NULL,  -- → companies.id
    name                    VARCHAR(200)  NOT NULL,  -- e.g. 'Annual Review 2025'
    start_date              DATE          NOT NULL,
    end_date                DATE          NOT NULL,
    self_review_deadline    DATE,
    manager_review_deadline DATE,
    is_active               BOOLEAN       NOT NULL DEFAULT true,
    year                    INT           NOT NULL,
    created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by              VARCHAR(255),
    updated_by              VARCHAR(255),
    version                 BIGINT        NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_review_cycles_company ON review_cycles (company_id, is_active);

-- -----------------------------------------------------------------------------
-- TABLE: goals
-- Individual OKR / KPI goal for an employee.
-- Can be linked to a review_cycle (for formal appraisals) or standalone (continuous).
-- is_company_goal: company-wide goal cascaded to the employee by HR.
-- status: NOT_STARTED | IN_PROGRESS | COMPLETED | CANCELLED | OVERDUE
-- weightage_percent: percentage contribution to overall performance score (sum should = 100).
-- -----------------------------------------------------------------------------
CREATE TABLE goals (
    id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID          NOT NULL,
    employee_id      UUID          NOT NULL,  -- → employees.id
    review_cycle_id  UUID          REFERENCES review_cycles(id),  -- NULL = standalone goal
    title            VARCHAR(300)  NOT NULL,
    description      TEXT,
    target_value     DOUBLE PRECISION,         -- quantitative target (e.g. 95 for 95% uptime)
    achieved_value   DOUBLE PRECISION,         -- actual achieved value (filled by employee)
    weightage_percent INT          DEFAULT 100,
    status           VARCHAR(30)   NOT NULL DEFAULT 'NOT_STARTED',  -- NOT_STARTED | IN_PROGRESS | COMPLETED | CANCELLED | OVERDUE
    due_date         DATE,
    category         VARCHAR(30),              -- e.g. TECHNICAL | LEADERSHIP | PROCESS | BUSINESS
    is_company_goal  BOOLEAN       DEFAULT false,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by       VARCHAR(255),
    updated_by       VARCHAR(255),
    version          BIGINT        NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_goals_employee ON goals (employee_id, status);
CREATE INDEX IF NOT EXISTS idx_goals_cycle    ON goals (review_cycle_id);

COMMENT ON COLUMN goals.weightage_percent IS 'Contribution to overall score. All active goals for a review cycle should sum to 100.';
COMMENT ON COLUMN goals.is_company_goal   IS 'True when HR cascades a company-wide objective to employees.';

-- -----------------------------------------------------------------------------
-- TABLE: performance_reviews
-- One review record per (review_cycle, employee, reviewer, feedback_type).
-- feedback_type: SELF | MANAGER | PEER | UPWARD | HR
-- status: DRAFT | SUBMITTED | ACKNOWLEDGED
-- overall_rating: numeric score (e.g. 1.0–5.0 scale, configured per company).
-- reviewer_id = employee_id for SELF reviews.
-- -----------------------------------------------------------------------------
CREATE TABLE performance_reviews (
    id               UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID             NOT NULL,
    review_cycle_id  UUID             NOT NULL REFERENCES review_cycles(id),
    employee_id      UUID             NOT NULL,  -- → employees.id (person being reviewed)
    reviewer_id      UUID             NOT NULL,  -- → employees.id (person doing the review)
    feedback_type    VARCHAR(30)      NOT NULL,  -- SELF | MANAGER | PEER | UPWARD | HR
    overall_rating   DOUBLE PRECISION,            -- 1.0–5.0 (scale configurable per company)
    status           VARCHAR(30)      NOT NULL DEFAULT 'DRAFT',  -- DRAFT | SUBMITTED | ACKNOWLEDGED
    self_comment     TEXT,
    manager_comment  TEXT,
    hr_comment       TEXT,
    submitted_at     TIMESTAMPTZ,
    acknowledged_at  TIMESTAMPTZ,
    created_at       TIMESTAMPTZ      NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ      NOT NULL DEFAULT now(),
    created_by       VARCHAR(255),
    updated_by       VARCHAR(255),
    version          BIGINT           NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_reviews_employee ON performance_reviews (employee_id);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewer ON performance_reviews (reviewer_id, status);

COMMENT ON COLUMN performance_reviews.feedback_type IS 'SELF = employee reviews themselves; UPWARD = employee reviews manager.';
