package com.unifiedtree.attendance.face.service;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * Multi-statement writes for the face module. Lives in its own bean so
 * the {@code @Transactional} proxy applies (the
 * {@link com.unifiedtree.security.tenant.TenantAwareDataSource} relies on
 * a real proxied call to issue {@code SET LOCAL app.tenant_id}).
 */
@Component
public class FaceWriter {

    private final JdbcTemplate jdbc;

    public FaceWriter(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    @Transactional
    public UUID upsertPendingEnrollment(UUID tenantId, UUID employeeId, int samplesRequired) {
        UUID newId = UUID.randomUUID();
        // Invalidate any previously captured templates for this employee 
        // so they don't block the new capture sequence on a restart.
        jdbc.update("UPDATE attendance.face_embedding_templates SET is_active = FALSE " +
                    "WHERE tenant_id = ? AND employee_id = ?", tenantId, employeeId);

        jdbc.update("""
            INSERT INTO attendance.face_enrollments
                (id, tenant_id, employee_id, status, samples_required, samples_captured,
                 consecutive_failures, created_at, updated_at, version)
            VALUES (?, ?, ?, 'PENDING', ?, 0, 0, now(), now(), 0)
            ON CONFLICT (tenant_id, employee_id) DO UPDATE
            SET status = CASE
                  WHEN attendance.face_enrollments.status = 'LOCKED'
                    THEN attendance.face_enrollments.status
                  ELSE 'PENDING' END,
                samples_captured = CASE
                  WHEN attendance.face_enrollments.status = 'LOCKED'
                    THEN attendance.face_enrollments.samples_captured
                  ELSE 0 END,
                enrolled_at = CASE
                  WHEN attendance.face_enrollments.status = 'LOCKED'
                    THEN attendance.face_enrollments.enrolled_at
                  ELSE NULL END,
                enrolled_by = CASE
                  WHEN attendance.face_enrollments.status = 'LOCKED'
                    THEN attendance.face_enrollments.enrolled_by
                  ELSE NULL END,
                revoked_at = CASE
                  WHEN attendance.face_enrollments.status = 'LOCKED'
                    THEN attendance.face_enrollments.revoked_at
                  ELSE NULL END,
                revoked_by = CASE
                  WHEN attendance.face_enrollments.status = 'LOCKED'
                    THEN attendance.face_enrollments.revoked_by
                  ELSE NULL END,
                revoked_reason = CASE
                  WHEN attendance.face_enrollments.status = 'LOCKED'
                    THEN attendance.face_enrollments.revoked_reason
                  ELSE NULL END,
                consecutive_failures = CASE
                  WHEN attendance.face_enrollments.status = 'LOCKED'
                    THEN attendance.face_enrollments.consecutive_failures
                  ELSE 0 END,
                updated_at = now()
            """, newId, tenantId, employeeId, samplesRequired);
        return jdbc.queryForObject(
            "SELECT id FROM attendance.face_enrollments WHERE tenant_id = ? AND employee_id = ?",
            UUID.class, tenantId, employeeId);
    }

    @Transactional
    public void insertEmbeddingTemplate(UUID tenantId, UUID enrollmentId, UUID employeeId,
                                        String captureAngle, int sampleIndex,
                                        String modelName, String modelVersion,
                                        byte[] encryptedEmbedding, int embeddingDim,
                                        Double qualityScore, Double livenessScore,
                                        String r2Key, Instant r2ExpiresAt) {
        jdbc.update("""
            INSERT INTO attendance.face_embedding_templates
                (id, tenant_id, enrollment_id, employee_id, capture_angle, sample_index,
                 model_name, model_version, encrypted_embedding, embedding_dim,
                 quality_score, liveness_score, raw_image_r2_key, raw_image_expires_at,
                 is_active, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, now())
            """, UUID.randomUUID(), tenantId, enrollmentId, employeeId,
                captureAngle, sampleIndex, modelName, modelVersion,
                encryptedEmbedding, embeddingDim,
                qualityScore, livenessScore,
                r2Key, r2ExpiresAt == null ? null : Timestamp.from(r2ExpiresAt));

        jdbc.update("""
            UPDATE attendance.face_enrollments
               SET samples_captured = samples_captured + 1,
                   updated_at = now(),
                   version = version + 1
             WHERE id = ?
            """, enrollmentId);
    }

    @Transactional
    public void markEnrollmentActive(UUID enrollmentId, UUID actingUserId) {
        jdbc.update("""
            UPDATE attendance.face_enrollments
               SET status = 'ACTIVE',
                   enrolled_at = now(),
                   enrolled_by = ?,
                   consecutive_failures = 0,
                   updated_at = now(),
                   version = version + 1
             WHERE id = ?
            """, actingUserId, enrollmentId);
    }

    @Transactional
    public void recordVerificationEvent(UUID tenantId, UUID employeeId,
                                        String purpose, String result, String reason,
                                        Double matchScore, Double qualityScore, Double livenessScore,
                                        String modelName, String modelVersion,
                                        String scoreBucket, String challengeType,
                                        String deviceFingerprint,
                                        Double latitude, Double longitude,
                                        Integer workerLatencyMs) {
        jdbc.update("""
            INSERT INTO attendance.face_verification_events
                (id, tenant_id, employee_id, purpose, result, reason,
                 match_score, quality_score, liveness_score,
                 model_name, model_version, score_bucket, challenge_type,
                 device_fingerprint, latitude, longitude, worker_latency_ms, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now())
            """, UUID.randomUUID(), tenantId, employeeId, purpose, result, reason,
                matchScore, qualityScore, livenessScore,
                modelName, modelVersion, scoreBucket, challengeType,
                deviceFingerprint, latitude, longitude, workerLatencyMs);
    }

    /** Per-employee failure counter with lockout at N. */
    @Transactional
    public void bumpFailureCounter(UUID tenantId, UUID employeeId, int lockAt, String lockReason) {
        jdbc.update("""
            UPDATE attendance.face_enrollments
               SET consecutive_failures = consecutive_failures + 1,
                   status = CASE
                     WHEN consecutive_failures + 1 >= ? THEN 'LOCKED'
                     ELSE status
                   END,
                   locked_at = CASE
                     WHEN consecutive_failures + 1 >= ? AND locked_at IS NULL THEN now()
                     ELSE locked_at
                   END,
                   locked_reason = CASE
                     WHEN consecutive_failures + 1 >= ? THEN ?
                     ELSE locked_reason
                   END,
                   updated_at = now(),
                   version = version + 1
             WHERE tenant_id = ? AND employee_id = ?
            """, lockAt, lockAt, lockAt, lockReason, tenantId, employeeId);
    }

    @Transactional
    public void resetFailureCounter(UUID tenantId, UUID employeeId) {
        jdbc.update("""
            UPDATE attendance.face_enrollments
               SET consecutive_failures = 0,
                   updated_at = now(),
                   version = version + 1
             WHERE tenant_id = ? AND employee_id = ?
            """, tenantId, employeeId);
    }

    /**
     * Auto-unlock an aged-out lock: restore a LOCKED enrolment to ACTIVE and
     * reset the failure counter, KEEPING the enrolled templates (unlike
     * {@link #adminReset} which wipes them). Only touches rows still LOCKED, so
     * it's a safe no-op if the row was reset/re-enrolled in the meantime.
     */
    @Transactional
    public void clearLock(UUID tenantId, UUID employeeId) {
        jdbc.update("""
            UPDATE attendance.face_enrollments
               SET status = 'ACTIVE',
                   consecutive_failures = 0,
                   locked_at = NULL,
                   locked_reason = NULL,
                   updated_at = now(),
                   version = version + 1
             WHERE tenant_id = ? AND employee_id = ? AND status = 'LOCKED'
            """, tenantId, employeeId);
    }

    @Transactional
    public void adminReset(UUID tenantId, UUID employeeId, UUID actingAdminId, String reason) {
        // Revoke existing templates; the next enrollment-start call recreates the row.
        jdbc.update("UPDATE attendance.face_embedding_templates SET is_active = FALSE "
                  + "WHERE tenant_id = ? AND employee_id = ?", tenantId, employeeId);
        jdbc.update("""
            UPDATE attendance.face_enrollments
               SET status = 'REVOKED',
                   revoked_at = now(),
                   revoked_by = ?,
                   revoked_reason = ?,
                   locked_at = NULL,
                   locked_reason = NULL,
                   consecutive_failures = 0,
                   samples_captured = 0,
                   updated_at = now(),
                   version = version + 1
             WHERE tenant_id = ? AND employee_id = ?
            """, actingAdminId, reason, tenantId, employeeId);
    }

    /**
     * Whether a face is on record before a new enrollment starts: one that
     * works, is locked or is due for re-enrollment, or one an earlier start
     * or an HR reset already took out of use (revoked_at, see
     * {@link #markReplacing}). A first enrollment, even after an abandoned
     * try, has none.
     */
    public boolean hadEnrolledFace(UUID tenantId, UUID employeeId) {
        return Boolean.TRUE.equals(jdbc.query("""
            SELECT status IN ('ACTIVE', 'NEEDS_REENROLLMENT', 'LOCKED') OR revoked_at IS NOT NULL
              FROM attendance.face_enrollments
             WHERE tenant_id = ? AND employee_id = ?
            """, rs -> rs.next() && rs.getBoolean(1), tenantId, employeeId));
    }

    /**
     * Notes on a just-started enrollment that it replaces an earlier face (the
     * start has already taken that face out of use), so the audit entry at the
     * end can say so. Nothing else reads the revoked_* columns.
     */
    @Transactional
    public void markReplacing(UUID tenantId, UUID employeeId) {
        jdbc.update("""
            UPDATE attendance.face_enrollments
               SET revoked_at = now(),
                   revoked_reason = 'Replaced by a new enrollment'
             WHERE tenant_id = ? AND employee_id = ? AND status = 'PENDING'
            """, tenantId, employeeId);
    }

    /**
     * One audit.events row for a finished face enrollment, written the way the
     * access audit writes its rows: who did it, whose face, and whether it
     * replaced an earlier one (noted on the row when it started, see
     * {@link #markReplacing}). The entry points at the person's employee
     * record when the login has one, so the Audit logs page names and links
     * them.
     */
    @Transactional
    public void recordEnrollmentAudit(UUID tenantId, UUID loginId, UUID actorId) {
        boolean replaced = Boolean.TRUE.equals(jdbc.query("""
            SELECT revoked_at IS NOT NULL FROM attendance.face_enrollments
             WHERE tenant_id = ? AND employee_id = ?
            """, rs -> rs.next() && rs.getBoolean(1), tenantId, loginId));
        Map<String, Object> who = jdbc.queryForMap("""
            SELECT uc.employee_id,
                   COALESCE(NULLIF(btrim(concat_ws(' ', e.first_name, e.last_name)), ''),
                            NULLIF(btrim(uc.display_name), ''), uc.email) AS name
              FROM auth.user_credentials uc
              LEFT JOIN hrms.employees e ON e.id = uc.employee_id
             WHERE uc.id = ? AND uc.tenant_id = ?
            """, loginId, tenantId);
        UUID employeeId = who.get("employee_id") == null ? null : UUID.fromString(who.get("employee_id").toString());
        String name = String.valueOf(who.get("name"));
        boolean self = loginId.equals(actorId);
        String summary = self
                ? (replaced ? "Re-enrolled their own face. The earlier face record was replaced."
                            : "Enrolled their own face for face punch-in.")
                : (replaced ? "Re-enrolled " + name + "'s face. The earlier face record was replaced."
                            : "Enrolled " + name + "'s face for face punch-in.");
        jdbc.update("""
                INSERT INTO audit.events
                    (id, tenant_id, occurred_at, occurred_date, actor_user_id, actor_email,
                     module, action, entity_type, entity_id, summary)
                VALUES (gen_random_uuid(), ?, now(), (now() AT TIME ZONE 'Asia/Kolkata')::date, ?,
                        (SELECT email FROM auth.user_credentials WHERE id = ?),
                        'attendance', ?, ?, ?, ?)
                """,
                tenantId, actorId, actorId,
                replaced ? "FACE_REENROLLED" : "FACE_ENROLLED",
                employeeId != null ? "employee" : "user",
                employeeId != null ? employeeId : loginId,
                summary);
    }
}
