-- Service contracts already shipped in the API, but their tables were absent
-- from the canonical migration history. Keep this additive for existing tenants.
CREATE TABLE IF NOT EXISTS payroll.bank_profiles (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, company_id UUID NOT NULL,
 profile_name VARCHAR(120) NOT NULL, bank_format VARCHAR(40) NOT NULL,
 corporate_id VARCHAR(60), debit_account_no VARCHAR(60) NOT NULL, ifsc VARCHAR(20) NOT NULL,
 is_default BOOLEAN NOT NULL DEFAULT false, is_active BOOLEAN NOT NULL DEFAULT true,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 created_by VARCHAR(255), updated_by VARCHAR(255), version BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_profile_default ON payroll.bank_profiles(tenant_id,company_id) WHERE is_default AND is_active;
CREATE TABLE IF NOT EXISTS payroll.disbursement_batches (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, company_id UUID NOT NULL,
 run_id UUID NOT NULL REFERENCES payroll.runs(id), bank_profile_id UUID NOT NULL REFERENCES payroll.bank_profiles(id),
 batch_reference VARCHAR(100) NOT NULL, total_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
 beneficiary_count INT NOT NULL DEFAULT 0, status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
 file_generated_at TIMESTAMPTZ, posted_at TIMESTAMPTZ, paid_at TIMESTAMPTZ, payment_reference VARCHAR(255), notes TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 created_by VARCHAR(255), updated_by VARCHAR(255), version BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_disbursement_active_run_bank ON payroll.disbursement_batches(tenant_id,run_id,bank_profile_id) WHERE status <> 'CANCELLED';
CREATE TABLE IF NOT EXISTS payroll.disbursement_batch_lines (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
 batch_id UUID NOT NULL REFERENCES payroll.disbursement_batches(id), employee_id UUID NOT NULL,
 beneficiary_name VARCHAR(255), account_no TEXT, ifsc VARCHAR(20), amount NUMERIC(18,2) NOT NULL DEFAULT 0,
 status VARCHAR(40) NOT NULL, failure_reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(batch_id,employee_id)
);
CREATE TABLE IF NOT EXISTS advance_mgmt.advance_recovery_schedule (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
 advance_request_id UUID NOT NULL REFERENCES advance_mgmt.advance_requests(id), installment_no INT NOT NULL,
 scheduled_month DATE NOT NULL, scheduled_amount NUMERIC(18,2) NOT NULL,
 status VARCHAR(30) NOT NULL DEFAULT 'PENDING', payroll_run_id UUID REFERENCES payroll.runs(id),
 recovered_amount NUMERIC(18,2), recovered_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 version BIGINT NOT NULL DEFAULT 0, UNIQUE(advance_request_id,installment_no)
);
CREATE INDEX IF NOT EXISTS idx_advance_schedule_month ON advance_mgmt.advance_recovery_schedule(tenant_id,scheduled_month,status);
CREATE TABLE IF NOT EXISTS advance_mgmt.advance_ledger_entries (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
 advance_request_id UUID NOT NULL REFERENCES advance_mgmt.advance_requests(id), entry_type VARCHAR(30) NOT NULL,
 amount NUMERIC(18,2) NOT NULL, balance_after NUMERIC(18,2) NOT NULL,
 payroll_run_id UUID REFERENCES payroll.runs(id), reference VARCHAR(255), notes TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by VARCHAR(255)
);
CREATE INDEX IF NOT EXISTS idx_advance_ledger_request ON advance_mgmt.advance_ledger_entries(tenant_id,advance_request_id,created_at);
CREATE TABLE IF NOT EXISTS expense_mgmt.reimbursement_batches (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, company_id UUID NOT NULL,
 batch_reference VARCHAR(100) NOT NULL, cutoff_date DATE NOT NULL, status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
 total_amount NUMERIC(18,2) NOT NULL DEFAULT 0, claim_count INT NOT NULL DEFAULT 0,
 posted_at TIMESTAMPTZ, paid_at TIMESTAMPTZ, payment_reference VARCHAR(255), notes TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 created_by VARCHAR(255), updated_by VARCHAR(255), version BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_reimbursement_draft_cutoff ON expense_mgmt.reimbursement_batches(tenant_id,company_id,cutoff_date) WHERE status = 'DRAFT';
CREATE TABLE IF NOT EXISTS expense_mgmt.reimbursement_batch_items (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
 batch_id UUID NOT NULL REFERENCES expense_mgmt.reimbursement_batches(id),
 claim_id UUID NOT NULL REFERENCES expense_mgmt.expense_claims(id), employee_id UUID NOT NULL,
 amount NUMERIC(18,2) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(batch_id,claim_id)
);
ALTER TABLE performance_mgmt.performance_reviews
 ADD COLUMN IF NOT EXISTS reviewer_type VARCHAR(30) NOT NULL DEFAULT 'MANAGER',
 ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ,
 ADD COLUMN IF NOT EXISTS reminder_count INT NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS performance_mgmt.appraisal_reviewer_assignments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
 cycle_id UUID NOT NULL REFERENCES performance_mgmt.review_cycles(id), reviewee_id UUID NOT NULL, reviewer_id UUID NOT NULL,
 reviewer_type VARCHAR(30) NOT NULL, status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
 review_id UUID REFERENCES performance_mgmt.performance_reviews(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), version BIGINT NOT NULL DEFAULT 0,
 UNIQUE(cycle_id,reviewee_id,reviewer_id,reviewer_type)
);

DO $$
DECLARE table_path TEXT; role_name TEXT;
BEGIN
 FOREACH table_path IN ARRAY ARRAY['payroll.bank_profiles','payroll.disbursement_batches','payroll.disbursement_batch_lines',
  'advance_mgmt.advance_recovery_schedule','advance_mgmt.advance_ledger_entries',
  'expense_mgmt.reimbursement_batches','expense_mgmt.reimbursement_batch_items','performance_mgmt.appraisal_reviewer_assignments'] LOOP
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY',table_path);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY',table_path);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s',table_path);
  EXECUTE format('CREATE POLICY tenant_isolation ON %s USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',table_path);
  FOREACH role_name IN ARRAY ARRAY['ut_app','hrms_app','app_user'] LOOP
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO %I',table_path,role_name);
   END IF;
  END LOOP;
 END LOOP;
END $$;
