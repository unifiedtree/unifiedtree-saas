package com.unifiedtree.attendance.face.service;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
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
}
