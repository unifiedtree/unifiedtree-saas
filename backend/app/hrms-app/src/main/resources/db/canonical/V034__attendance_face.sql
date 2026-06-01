-- ============================================================================
-- V034 - canonical face enrollment + verification tables (attendance schema)
-- ============================================================================
-- Stores per-employee face enrollment state, encrypted embedding templates,
-- and an append-only audit of every verification attempt.
--
-- NEVER stores raw face images here. Raw images, if temporarily retained
-- for debugging, live in private R2 with an encryption key; this schema
-- only carries the R2 path + retention metadata, never the bytes.
--
-- Embeddings are stored as opaque bytea ciphertext (AES-GCM) so a DB dump
-- on its own does not reveal biometric data. Encryption key lives in env
-- UNIFIEDTREE_FACE_ENCRYPTION_KEY (32 random bytes, base64) and is rotated
-- via the model_version column.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Per-employee face enrollment lifecycle
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance.face_enrollments (
    id                  UUID            PRIMARY KEY,
    tenant_id           UUID            NOT NULL,
    employee_id         UUID            NOT NULL,
    /* PENDING -> ACTIVE -> NEEDS_REENROLLMENT -> LOCKED -> REVOKED */
    status              VARCHAR(30)     NOT NULL DEFAULT 'PENDING',
    samples_required    INT             NOT NULL DEFAULT 5,
    samples_captured    INT             NOT NULL DEFAULT 0,
    /* Locks after N consecutive failed verifications; manager unlocks. */
    consecutive_failures INT            NOT NULL DEFAULT 0,
    locked_at           TIMESTAMPTZ,
    locked_reason       VARCHAR(255),
    enrolled_at         TIMESTAMPTZ,
    enrolled_by         UUID,
    revoked_at          TIMESTAMPTZ,
    revoked_by          UUID,
    revoked_reason      VARCHAR(255),
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
    version             BIGINT          NOT NULL DEFAULT 0,
    CONSTRAINT uq_face_enrollments_employee UNIQUE (tenant_id, employee_id),
    CONSTRAINT ck_face_enrollments_status
        CHECK (status IN ('PENDING','ACTIVE','NEEDS_REENROLLMENT','LOCKED','REVOKED'))
);

CREATE INDEX IF NOT EXISTS idx_face_enrollments_tenant ON attendance.face_enrollments (tenant_id);
CREATE INDEX IF NOT EXISTS idx_face_enrollments_status ON attendance.face_enrollments (tenant_id, status);

ALTER TABLE attendance.face_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance.face_enrollments FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'attendance' AND tablename = 'face_enrollments'
      AND policyname = 'tenant_isolation_face_enrollments'
  ) THEN
    CREATE POLICY tenant_isolation_face_enrollments ON attendance.face_enrollments
        USING (tenant_id = current_tenant_id());
  END IF;
END $$;

COMMENT ON TABLE attendance.face_enrollments IS
    'One row per employee. Owns the per-employee enrollment lifecycle, '
    'sample counters, and failure-lockout state. Embedding ciphertext '
    'lives in the child face_embedding_templates table so a single '
    'enrollment can have multiple templates across model versions.';

-- ---------------------------------------------------------------------------
-- 2. Encrypted embedding templates (1..N per enrollment)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance.face_embedding_templates (
    id                  UUID            PRIMARY KEY,
    tenant_id           UUID            NOT NULL,
    enrollment_id       UUID            NOT NULL
        REFERENCES attendance.face_enrollments(id) ON DELETE CASCADE,
    employee_id         UUID            NOT NULL,
    /* Identifies which sample this template came from. */
    capture_angle       VARCHAR(30)     NOT NULL,
    sample_index        INT             NOT NULL,
    /* What model produced the embedding. Lets us re-embed against newer
       models without losing the old vector. */
    model_name          VARCHAR(50)     NOT NULL,
    model_version       VARCHAR(50)     NOT NULL,
    /* Ciphertext bytes (AES-GCM 256). Layout: 12-byte nonce || ciphertext || 16-byte tag */
    encrypted_embedding BYTEA           NOT NULL,
    embedding_dim       INT             NOT NULL,
    /* Quality and liveness scores at capture time, 0..1 */
    quality_score       NUMERIC(4,3),
    liveness_score      NUMERIC(4,3),
    /* Optional reference to the temporary raw image in R2 (only if
       FACE_RAW_IMAGE_RETENTION_DAYS > 0 for this tenant). Never a public URL. */
    raw_image_r2_key    VARCHAR(255),
    raw_image_expires_at TIMESTAMPTZ,
    is_active           BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
    CONSTRAINT ck_face_templates_capture_angle
        CHECK (capture_angle IN ('FRONT','LEFT_30','RIGHT_30','UP_15','VARIED_LIGHT'))
);

CREATE INDEX IF NOT EXISTS idx_face_templates_tenant
    ON attendance.face_embedding_templates (tenant_id);
CREATE INDEX IF NOT EXISTS idx_face_templates_employee_active
    ON attendance.face_embedding_templates (tenant_id, employee_id, is_active);
CREATE INDEX IF NOT EXISTS idx_face_templates_enrollment
    ON attendance.face_embedding_templates (enrollment_id);

ALTER TABLE attendance.face_embedding_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance.face_embedding_templates FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'attendance' AND tablename = 'face_embedding_templates'
      AND policyname = 'tenant_isolation_face_templates'
  ) THEN
    CREATE POLICY tenant_isolation_face_templates ON attendance.face_embedding_templates
        USING (tenant_id = current_tenant_id());
  END IF;
END $$;

COMMENT ON COLUMN attendance.face_embedding_templates.encrypted_embedding IS
    'AES-GCM-256 ciphertext of the L2-normalized float32 embedding vector. '
    'Decryption key: UNIFIEDTREE_FACE_ENCRYPTION_KEY env var. '
    'Layout: 12-byte nonce || ciphertext || 16-byte tag.';

-- ---------------------------------------------------------------------------
-- 3. Append-only audit of every verification attempt
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance.face_verification_events (
    id                  UUID            PRIMARY KEY,
    tenant_id           UUID            NOT NULL,
    employee_id         UUID            NOT NULL,
    /* PUNCH_IN, PUNCH_OUT, ENROLLMENT_SAMPLE, MANUAL_TEST */
    purpose             VARCHAR(30)     NOT NULL,
    /* PASS, FAIL_MULTIPLE_FACES, FAIL_NO_FACE, FAIL_LOW_QUALITY,
       FAIL_LIVENESS, FAIL_MATCH, FAIL_NOT_ENROLLED, FAIL_LOCKED,
       FAIL_WORKER_UNAVAILABLE, FAIL_OTHER */
    result              VARCHAR(40)     NOT NULL,
    reason              VARCHAR(255),
    match_score         NUMERIC(4,3),
    quality_score       NUMERIC(4,3),
    liveness_score      NUMERIC(4,3),
    model_name          VARCHAR(50),
    model_version       VARCHAR(50),
    /* Coarse-grained match score bucket for admin views (do not expose
       the raw float to non-privileged users). */
    score_bucket        VARCHAR(20),
    challenge_type      VARCHAR(30),
    device_fingerprint  VARCHAR(120),
    latitude            NUMERIC(9,6),
    longitude           NUMERIC(9,6),
    /* Worker latency in milliseconds, for the metrics dashboard. */
    worker_latency_ms   INT,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
    CONSTRAINT ck_face_events_purpose
        CHECK (purpose IN ('PUNCH_IN','PUNCH_OUT','ENROLLMENT_SAMPLE','MANUAL_TEST')),
    CONSTRAINT ck_face_events_result
        CHECK (result IN
            ('PASS','FAIL_MULTIPLE_FACES','FAIL_NO_FACE','FAIL_LOW_QUALITY',
             'FAIL_LIVENESS','FAIL_MATCH','FAIL_NOT_ENROLLED','FAIL_LOCKED',
             'FAIL_WORKER_UNAVAILABLE','FAIL_OTHER'))
);

CREATE INDEX IF NOT EXISTS idx_face_events_tenant_time
    ON attendance.face_verification_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_face_events_employee_time
    ON attendance.face_verification_events (tenant_id, employee_id, created_at DESC);

ALTER TABLE attendance.face_verification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance.face_verification_events FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'attendance' AND tablename = 'face_verification_events'
      AND policyname = 'tenant_isolation_face_events'
  ) THEN
    CREATE POLICY tenant_isolation_face_events ON attendance.face_verification_events
        USING (tenant_id = current_tenant_id());
  END IF;
END $$;

COMMENT ON TABLE attendance.face_verification_events IS
    'Append-only audit. One row per verification attempt (enrollment '
    'sample or punch-in). NEVER contains image bytes or embedding '
    'plaintext. Match score is also exposed only as a coarse bucket '
    'in admin views.';

-- ---------------------------------------------------------------------------
-- 4. Permissions (gate the admin/manager surfaces from V021 onwards)
-- ---------------------------------------------------------------------------
INSERT INTO rbac.permissions (code, display_name, module) VALUES
    ('attendance.face.enroll.self',   'Enroll own face',                       'attendance'),
    ('attendance.face.verify.self',   'Verify own face for punch-in',          'attendance'),
    ('attendance.face.admin.read',    'View face enrollment + event metadata', 'attendance'),
    ('attendance.face.admin.reset',   'Reset / re-enroll an employee face',    'attendance')
ON CONFLICT (code) DO NOTHING;

-- Grant all employees self-enrollment + self-verification.
INSERT INTO rbac.role_permissions (role_id, permission_code) VALUES
    ('00000000-0000-0000-0000-000000000004', 'attendance.face.enroll.self'),
    ('00000000-0000-0000-0000-000000000004', 'attendance.face.verify.self')
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- SUPER_ADMIN superset, per V017 contract.
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT '00000000-0000-0000-0000-000000000001', code
  FROM rbac.permissions
 WHERE code IN ('attendance.face.enroll.self','attendance.face.verify.self',
                'attendance.face.admin.read','attendance.face.admin.reset')
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- HR_MANAGER gets the admin surfaces; managers can reset employees' faces.
INSERT INTO rbac.role_permissions (role_id, permission_code) VALUES
    ('00000000-0000-0000-0000-000000000002', 'attendance.face.admin.read'),
    ('00000000-0000-0000-0000-000000000002', 'attendance.face.admin.reset')
ON CONFLICT (role_id, permission_code) DO NOTHING;
