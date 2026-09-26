package com.unifiedtree.attendance.face.service;

import com.unifiedtree.attendance.face.crypto.EmbeddingCipher;
import com.unifiedtree.attendance.face.dto.FaceDtos.AdminEnrollmentSummary;
import com.unifiedtree.attendance.face.dto.FaceDtos.AdminVerificationEvent;
import com.unifiedtree.attendance.face.dto.FaceDtos.CaptureAngle;
import com.unifiedtree.attendance.face.dto.FaceDtos.Challenge;
import com.unifiedtree.attendance.face.dto.FaceDtos.CheckinFaceResponse;
import com.unifiedtree.attendance.face.dto.FaceDtos.EnrollmentCompleteResponse;
import com.unifiedtree.attendance.face.dto.FaceDtos.EnrollmentSampleRequest;
import com.unifiedtree.attendance.face.dto.FaceDtos.EnrollmentSampleResponse;
import com.unifiedtree.attendance.face.dto.FaceDtos.EnrollmentStartRequest;
import com.unifiedtree.attendance.face.dto.FaceDtos.EnrollmentStartResponse;
import com.unifiedtree.attendance.face.dto.FaceDtos.EnrollmentStatus;
import com.unifiedtree.attendance.face.dto.FaceDtos.EnrollmentStatusResponse;
import com.unifiedtree.attendance.face.dto.FaceDtos.PersonEnrollmentStatusResponse;
import com.unifiedtree.attendance.face.dto.FaceDtos.VerifyRequest;
import com.unifiedtree.attendance.face.dto.FaceDtos.VerifyResponse;
import com.unifiedtree.attendance.face.worker.FaceWorkerClient;
import com.unifiedtree.notifications.events.FaceEnrollmentEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashSet;
import java.util.List;
import java.util.Random;
import java.util.Set;
import java.util.UUID;

/**
 * Canonical face module orchestrator. Owns the lifecycle around the
 * Python worker calls and the encrypted persistence in attendance.face_*.
 *
 * <p>FAIL CLOSED on every error path: worker unreachable, multiple faces,
 * low quality, mismatched embedding, locked enrollment - all translate
 * into a non-2xx response with an explicit error code so the mobile app
 * can show the right user-facing reason.
 */
@Service
public class FaceService {

    private static final Logger log = LoggerFactory.getLogger(FaceService.class);

    // 3-sample enrollment (was 5) — faster, less friction for employees. The
    // mobile app follows this CAPTURE_SEQUENCE dynamically, so no client change
    // is needed for the count. match-quorum default is 2 (see ctor): 2-of-3
    // templates must agree on verify — with only 3 samples a quorum of 3 would
    // demand a perfect match on every angle and reject genuine users.
    private static final int SAMPLES_REQUIRED = 3;
    private static final List<CaptureAngle> CAPTURE_SEQUENCE = List.of(
            CaptureAngle.FRONT, CaptureAngle.LEFT_30, CaptureAngle.RIGHT_30);

    private final JdbcTemplate jdbc;
    private final FaceWriter writer;
    private final FaceWorkerClient worker;
    private final EmbeddingCipher cipher;
    private final ApplicationEventPublisher eventPublisher;

    private final boolean enabled;
    private final double matchThreshold;
    private final double matchMeanGap;
    private final double matchTemplateGap;
    private final int matchQuorum;
    private final double minQuality;
    private final boolean requireLiveness;
    private final double livenessThreshold;
    private final int lockoutFailureCount;
    private final long lockoutCooldownMinutes;
    private final String modelName;
    private final String modelVersion;
    private final Random rng = new Random();

    public FaceService(JdbcTemplate jdbc,
                       FaceWriter writer,
                       FaceWorkerClient worker,
                       EmbeddingCipher cipher,
                       ApplicationEventPublisher eventPublisher,
                       @Value("${unifiedtree.face.enabled:true}") boolean enabled,
                       @Value("${unifiedtree.face.match-threshold:0.82}") double matchThreshold,
                       /* Best-vs-mean gap. The mean across all enrolled templates
                          must be >= matchThreshold - matchMeanGap. A stranger gets
                          one lucky template; the genuine user gets consistent
                          scores. Default 0.07 -> mean must be >= 0.75 at T=0.82. */
                       @Value("${unifiedtree.face.match-mean-gap:0.07}") double matchMeanGap,
                       /* Quorum slack: a template "agrees" if its score >=
                          matchThreshold - matchTemplateGap. Default 0.05. */
                       @Value("${unifiedtree.face.match-template-gap:0.05}") double matchTemplateGap,
                       /* Minimum number of agreeing templates needed for PASS.
                          With 5 enrolled samples and default 3, a stranger has
                          to fool the model on 3 of the 5 captured angles. */
                       @Value("${unifiedtree.face.match-quorum:2}") int matchQuorum,
                       @Value("${unifiedtree.face.min-quality:0.55}") double minQuality,
                       @Value("${unifiedtree.face.require-liveness:true}") boolean requireLiveness,
                       @Value("${unifiedtree.face.liveness-threshold:0.30}") double livenessThreshold,
                       @Value("${unifiedtree.face.lockout-failure-count:5}") int lockoutFailureCount,
                       /* A LOCKED enrolment auto-clears this many minutes after it
                          locked, so an employee is never stuck waiting for a
                          manager. 0 disables auto-unlock (manager-only). */
                       @Value("${unifiedtree.face.lockout-cooldown-minutes:30}") long lockoutCooldownMinutes,
                       @Value("${unifiedtree.face.model-name:sface}") String modelName,
                       @Value("${unifiedtree.face.model-version:sface-1.0}") String modelVersion) {
        this.jdbc = jdbc;
        this.writer = writer;
        this.worker = worker;
        this.cipher = cipher;
        this.eventPublisher = eventPublisher;
        this.enabled = enabled;
        this.matchThreshold = matchThreshold;
        this.matchMeanGap = Math.max(0.0, matchMeanGap);
        this.matchTemplateGap = Math.max(0.0, matchTemplateGap);
        this.matchQuorum = Math.max(1, matchQuorum);
        this.lockoutCooldownMinutes = Math.max(0, lockoutCooldownMinutes);
        this.minQuality = minQuality;
        this.requireLiveness = requireLiveness;
        this.livenessThreshold = livenessThreshold;
        this.lockoutFailureCount = Math.max(1, lockoutFailureCount);
        this.modelName = modelName;
        this.modelVersion = modelVersion;
    }

    // ---------------------------------------------------------------------
    // Status
    // ---------------------------------------------------------------------

    public EnrollmentStatusResponse getStatus(UUID tenantId, UUID employeeId) {
        return getStatus(tenantId, employeeId, employeeId);
    }

    /**
     * {@code actingUserId}: who is asking (the person themselves, or HR on
     * the web). A self-healed enrollment is recorded as finished by them.
     */
    private EnrollmentStatusResponse getStatus(UUID tenantId, UUID employeeId, UUID actingUserId) {
        EnrollmentRow row = loadEnrollment(tenantId, employeeId);
        if (row == null) {
            return new EnrollmentStatusResponse(
                    EnrollmentStatus.PENDING, SAMPLES_REQUIRED, 0,
                    CAPTURE_SEQUENCE, 0, false, null, null);
        }
        // Self-heal: if all samples were captured but the explicit
        // completeEnrollment call was missed/failed (leaving the row PENDING),
        // activate it here so the user is NOT bounced back into enrollment on
        // their next session. This makes "enroll once, then only verify" robust.
        EnrollmentStatus effectiveStatus = row.status;
        if (row.status == EnrollmentStatus.PENDING && row.samplesCaptured >= SAMPLES_REQUIRED) {
            try {
                writer.markEnrollmentActive(row.id, actingUserId);
                effectiveStatus = EnrollmentStatus.ACTIVE;
            } catch (Exception ignored) {
                // Non-fatal: fall back to the persisted status.
            }
            // It is finished now, so its audit entry is written here: a later
            // complete call finds it ACTIVE and doesn't write another.
            if (effectiveStatus == EnrollmentStatus.ACTIVE) {
                auditEnrollmentSafely(tenantId, employeeId, actingUserId);
            }
        }
        List<CaptureAngle> captured = capturedAngles(tenantId, employeeId);
        List<CaptureAngle> remaining = new ArrayList<>(CAPTURE_SEQUENCE);
        remaining.removeAll(captured);
        return new EnrollmentStatusResponse(
                effectiveStatus, SAMPLES_REQUIRED, row.samplesCaptured,
                remaining, row.consecutiveFailures,
                effectiveStatus == EnrollmentStatus.LOCKED,
                row.enrolledAt,
                effectiveStatus == EnrollmentStatus.LOCKED ? unlocksAt(row) : null);
    }

    /**
     * When a lock clears by itself: {@code lockoutCooldownMinutes} after it
     * locked (see {@link #stillLocked}), or null when auto-unlock is off.
     * Reported only: the row stays LOCKED until the next start or face check.
     */
    private Instant unlocksAt(EnrollmentRow row) {
        if (lockoutCooldownMinutes <= 0 || row.lockedAt() == null) return null;
        return row.lockedAt().plus(java.time.Duration.ofMinutes(lockoutCooldownMinutes));
    }

    // ---------------------------------------------------------------------
    // Someone else's face (HR / admin on the web)
    // ---------------------------------------------------------------------

    /**
     * The login whose face data belongs to an HR employee record, or null when
     * the record has no active sign-in. Face rows are keyed by the login (the
     * JWT subject the phone punches with), which is not always the employee
     * id. A record can carry more than one login (rare); the one whose id is
     * the employee id comes first, then the most recently used.
     */
    public UUID loginFor(UUID tenantId, UUID employeeId) {
        List<UUID> ids = jdbc.queryForList("""
            SELECT id FROM auth.user_credentials
             WHERE tenant_id = ? AND employee_id = ? AND is_active = TRUE
             ORDER BY (id = employee_id) DESC, last_login_at DESC NULLS LAST, created_at
            """, UUID.class, tenantId, employeeId);
        return ids.isEmpty() ? null : ids.get(0);
    }

    /** {@link #loginFor}, or a 409 the web shows as it is when there is none. */
    public UUID requireLoginFor(UUID tenantId, UUID employeeId) {
        UUID login = loginFor(tenantId, employeeId);
        if (login == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "FACE_NO_LOGIN:" + friendlyRejectionCopy("FACE_NO_LOGIN"));
        }
        return login;
    }

    /** {@code actingUserId}: the HR person asking (see {@link #getStatus(UUID, UUID, UUID)}). */
    public PersonEnrollmentStatusResponse personStatus(UUID tenantId, UUID employeeId, UUID actingUserId) {
        UUID login = loginFor(tenantId, employeeId);
        if (login == null) {
            return new PersonEnrollmentStatusResponse(false, EnrollmentStatus.PENDING,
                    SAMPLES_REQUIRED, 0, CAPTURE_SEQUENCE, false, null, null);
        }
        EnrollmentStatusResponse s = getStatus(tenantId, login, actingUserId);
        return new PersonEnrollmentStatusResponse(true, s.status(), s.samplesRequired(),
                s.samplesCaptured(), s.remainingAngles(), s.lockedRequiresManagerReset(), s.enrolledAt(),
                s.unlocksAt());
    }

    /**
     * HR starting (re-)enrollment for someone else. HR holds the reset
     * permission, which unlocks, so a locked enrollment is unlocked first and
     * then replaced like any other; everything else is the normal start.
     */
    public EnrollmentStartResponse adminStartEnrollment(UUID tenantId, UUID loginId, EnrollmentStartRequest req) {
        ensureEnabled();
        EnrollmentRow existing = loadEnrollment(tenantId, loginId);
        if (existing != null && existing.status() == EnrollmentStatus.LOCKED) {
            writer.clearLock(tenantId, loginId);
        }
        return startEnrollment(tenantId, loginId, req);
    }

    // ---------------------------------------------------------------------
    // Enrollment flow
    // ---------------------------------------------------------------------

    public EnrollmentStartResponse startEnrollment(UUID tenantId, UUID employeeId, EnrollmentStartRequest req) {
        ensureEnabled();
        EnrollmentRow existing = loadEnrollment(tenantId, employeeId);
        if (stillLocked(tenantId, employeeId, existing)) {
            // Notify the employee (in-app + push) that their enrollment is
            // locked and needs admin intervention. Best-effort — never
            // propagate; the primary failure signal to the caller is still
            // the FACE_LOCKED HTTP 403.
            publishFaceEventSafely(tenantId, employeeId, false,
                    "Face enrolment is locked. Please ask your manager to reset it.");
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "FACE_LOCKED:" + friendlyRejectionCopy("FACE_LOCKED"));
        }
        // Whether this replaces a face that was on record: noted on the row
        // (read before the start resets it) so the audit entry at the end says so.
        boolean replacing = hadEnrolledFaceSafely(tenantId, employeeId);
        UUID id = writer.upsertPendingEnrollment(tenantId, employeeId, SAMPLES_REQUIRED);
        if (replacing) {
            markReplacingSafely(tenantId, employeeId);
        }
        List<Challenge> challenges = randomChallenges();
        return new EnrollmentStartResponse(id, SAMPLES_REQUIRED, CAPTURE_SEQUENCE,
                challenges, worker.isHealthy() ? "worker-online" : "worker-offline");
    }

    public EnrollmentSampleResponse submitSample(UUID tenantId, UUID employeeId, EnrollmentSampleRequest req) {
        ensureEnabled();
        EnrollmentRow row = loadEnrollment(tenantId, employeeId);
        if (row == null || !row.id.equals(req.enrollmentId())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,
                    "FACE_ENROLLMENT_NOT_FOUND:" + friendlyRejectionCopy("FACE_ENROLLMENT_NOT_FOUND"));
        }
        if (stillLocked(tenantId, employeeId, row)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "FACE_LOCKED:" + friendlyRejectionCopy("FACE_LOCKED"));
        }

        // Reject duplicate angle.
        if (capturedAngles(tenantId, employeeId).contains(req.captureAngle())) {
            return new EnrollmentSampleResponse(false, req.captureAngle(),
                    row.samplesCaptured, SAMPLES_REQUIRED, null, null,
                    "DUPLICATE_ANGLE",
                    friendlyRejectionCopy("DUPLICATE_ANGLE"),
                    remainingAngles(tenantId, employeeId));
        }

        long t0 = System.currentTimeMillis();
        var result = worker.assessSample(new FaceWorkerClient.SampleRequest(
                req.imageBase64(),
                req.captureAngle().name(),
                req.challengePerformed() == null ? null : req.challengePerformed().name()));
        int latency = (int) (System.currentTimeMillis() - t0);

        if (!result.ok()) {
            writer.recordVerificationEvent(tenantId, employeeId,
                    "ENROLLMENT_SAMPLE", "FAIL_WORKER_UNAVAILABLE", result.error(),
                    null, null, null, modelName, modelVersion,
                    null, str(req.challengePerformed()), req.deviceFingerprint(),
                    null, null, latency);
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "FACE_WORKER_UNAVAILABLE:" + friendlyRejectionCopy("FACE_WORKER_UNAVAILABLE"));
        }

        Boolean faceDetected = result.boolField("face_detected");
        Boolean exactlyOne = result.boolField("exactly_one_face");
        Double quality = result.doubleField("quality_score");
        Double liveness = result.doubleField("liveness_score");
        String embeddingBase64 = result.stringField("embedding_base64");
        Integer dim = (Integer) result.get("embedding_dim");

        String resultCode = "PASS";
        if (faceDetected == null || !faceDetected) {
            resultCode = "FAIL_NO_FACE";
        } else if (exactlyOne != null && !exactlyOne) {
            resultCode = "FAIL_MULTIPLE_FACES";
        } else if (quality == null || quality < minQuality) {
            resultCode = "FAIL_LOW_QUALITY";
        } else if (requireLiveness && (liveness == null || liveness < livenessThreshold)) {
            resultCode = "FAIL_LIVENESS";
        } else if (embeddingBase64 == null || dim == null) {
            resultCode = "FAIL_OTHER";
        }
        String rejection = "PASS".equals(resultCode) ? null : friendlyRejectionCopy(resultCode);

        writer.recordVerificationEvent(tenantId, employeeId,
                "ENROLLMENT_SAMPLE", resultCode, rejection,
                null, quality, liveness, modelName, modelVersion,
                null, str(req.challengePerformed()), req.deviceFingerprint(),
                null, null, latency);

        if (!"PASS".equals(resultCode)) {
            return new EnrollmentSampleResponse(false, req.captureAngle(),
                    row.samplesCaptured, SAMPLES_REQUIRED, quality, liveness,
                    resultCode, rejection,
                    remainingAngles(tenantId, employeeId));
        }

        // Decode embedding (raw little-endian float32) and encrypt for storage.
        float[] embedding = decodeFloatVector(embeddingBase64, dim);
        byte[] envelope = cipher.encrypt(embedding);
        int sampleIndex = row.samplesCaptured + 1;
        writer.insertEmbeddingTemplate(tenantId, row.id, employeeId,
                req.captureAngle().name(), sampleIndex,
                modelName, modelVersion, envelope, dim,
                quality, liveness, null, null);

        int newCaptured = row.samplesCaptured + 1;
        return new EnrollmentSampleResponse(true, req.captureAngle(),
                newCaptured, SAMPLES_REQUIRED, quality, liveness, null, null,
                remainingAnglesAfter(req.captureAngle(),
                        remainingAngles(tenantId, employeeId)));
    }

    public EnrollmentCompleteResponse completeEnrollment(UUID tenantId, UUID employeeId, UUID actingUserId) {
        EnrollmentRow row = loadEnrollment(tenantId, employeeId);
        if (row == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,
                    "FACE_ENROLLMENT_NOT_FOUND:" + friendlyRejectionCopy("FACE_ENROLLMENT_NOT_FOUND"));
        }
        if (row.samplesCaptured < SAMPLES_REQUIRED) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "FACE_SAMPLES_INCOMPLETE:" + friendlyRejectionCopy("FACE_SAMPLES_INCOMPLETE"));
        }
        writer.markEnrollmentActive(row.id, actingUserId);
        // One audit entry per enrollment (the phone's success screen calls
        // complete a second time; that repeat finds the row ACTIVE already).
        if (row.status != EnrollmentStatus.ACTIVE) {
            auditEnrollmentSafely(tenantId, employeeId, actingUserId);
        }
        // Notify the employee that enrollment is done. Best-effort — a failed
        // notification never breaks the enrollment response.
        publishFaceEventSafely(tenantId, employeeId, true, null);
        return new EnrollmentCompleteResponse(EnrollmentStatus.ACTIVE, row.id,
                row.samplesCaptured, "Enrollment complete. You can now punch in with your face.");
    }

    /**
     * Audit log entry for a finished enrollment: who enrolled whose face, and
     * whether it replaced an earlier one. Best-effort, like the notification:
     * the face is enrolled either way.
     */
    private void auditEnrollmentSafely(UUID tenantId, UUID loginId, UUID actingUserId) {
        try {
            writer.recordEnrollmentAudit(tenantId, loginId, actingUserId);
        } catch (Exception ex) {
            log.warn("Face enrollment audit entry failed for employee={}: {}", loginId, ex.getMessage());
        }
    }

    /** Only feeds the audit entry's wording, so it never stops an enrollment. */
    private boolean hadEnrolledFaceSafely(UUID tenantId, UUID loginId) {
        try {
            return writer.hadEnrolledFace(tenantId, loginId);
        } catch (Exception ex) {
            log.warn("Face enrollment: couldn't read the earlier face for employee={}: {}", loginId, ex.getMessage());
            return false;
        }
    }

    private void markReplacingSafely(UUID tenantId, UUID loginId) {
        try {
            writer.markReplacing(tenantId, loginId);
        } catch (Exception ex) {
            log.warn("Face enrollment: couldn't note the replaced face for employee={}: {}", loginId, ex.getMessage());
        }
    }

    /**
     * Publish a FaceEnrollmentEvent to the in-process bus for downstream
     * notification fan-out. Wrapped so any listener failure (or a missing
     * publisher in unit tests) can never break the face flow.
     */
    private void publishFaceEventSafely(UUID tenantId, UUID employeeId,
                                        boolean success, String reason) {
        try {
            eventPublisher.publishEvent(new FaceEnrollmentEvent(
                    tenantId, employeeId, success, reason));
        } catch (Exception ex) {
            log.warn("Failed to publish FaceEnrollmentEvent for employee={}: {}",
                    employeeId, ex.getMessage());
        }
    }

    // ---------------------------------------------------------------------
    // Verification (used by /verify and /checkin/face)
    // ---------------------------------------------------------------------

    public VerifyResponse verify(UUID tenantId, UUID employeeId, VerifyRequest req, String purpose) {
        ensureEnabled();
        EnrollmentRow row = loadEnrollment(tenantId, employeeId);
        if (row == null) {
            writer.recordVerificationEvent(tenantId, employeeId, purpose,
                    "FAIL_NOT_ENROLLED", null, null, null, null, modelName,
                    modelVersion, null, str(req.challengePerformed()),
                    req.deviceFingerprint(), req.latitude(), req.longitude(), null);
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "FACE_NOT_ENROLLED:" + friendlyRejectionCopy("FACE_NOT_ENROLLED"));
        }
        if (stillLocked(tenantId, employeeId, row)) {
            writer.recordVerificationEvent(tenantId, employeeId, purpose,
                    "FAIL_LOCKED", friendlyRejectionCopy("FACE_LOCKED"),
                    null, null, null, modelName, modelVersion,
                    null, str(req.challengePerformed()), req.deviceFingerprint(),
                    req.latitude(), req.longitude(), null);
            throw new ResponseStatusException(HttpStatus.LOCKED,
                    "FACE_LOCKED:" + friendlyRejectionCopy("FACE_LOCKED"));
        }
        if (row.status != EnrollmentStatus.ACTIVE) {
            writer.recordVerificationEvent(tenantId, employeeId, purpose,
                    "FAIL_NOT_ENROLLED", friendlyRejectionCopy("FACE_NOT_ENROLLED"),
                    null, null, null, modelName, modelVersion,
                    null, str(req.challengePerformed()), req.deviceFingerprint(),
                    req.latitude(), req.longitude(), null);
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "FACE_NOT_ENROLLED:" + friendlyRejectionCopy("FACE_NOT_ENROLLED"));
        }

        List<float[]> candidates = loadActiveEmbeddings(tenantId, employeeId);
        if (candidates.size() < SAMPLES_REQUIRED) {
            writer.recordVerificationEvent(tenantId, employeeId, purpose,
                    "FAIL_OTHER", "Active enrollment has fewer than "
                            + SAMPLES_REQUIRED + " usable face templates.",
                    null, null, null, modelName, modelVersion,
                    null, str(req.challengePerformed()), req.deviceFingerprint(),
                    req.latitude(), req.longitude(), null);
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "FACE_TEMPLATE_INCOMPLETE:" + friendlyRejectionCopy("FACE_TEMPLATE_INCOMPLETE"));
        }
        List<String> candidateBase64 = new ArrayList<>(candidates.size());
        int dim = candidates.isEmpty() ? 0 : candidates.get(0).length;
        for (float[] v : candidates) candidateBase64.add(encodeFloatVector(v));

        long t0 = System.currentTimeMillis();
        var result = worker.verify(new FaceWorkerClient.VerifyRequest(
                req.imageBase64(),
                req.challengePerformed() == null ? null : req.challengePerformed().name(),
                candidateBase64, dim, modelName, modelVersion));
        int latency = (int) (System.currentTimeMillis() - t0);

        if (!result.ok()) {
            writer.recordVerificationEvent(tenantId, employeeId, purpose,
                    "FAIL_WORKER_UNAVAILABLE", result.error(),
                    null, null, null, modelName, modelVersion,
                    null, str(req.challengePerformed()), req.deviceFingerprint(),
                    req.latitude(), req.longitude(), latency);
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "FACE_WORKER_UNAVAILABLE:" + friendlyRejectionCopy("FACE_WORKER_UNAVAILABLE"));
        }

        Boolean faceDetected = result.boolField("face_detected");
        Boolean exactlyOne = result.boolField("exactly_one_face");
        Double quality = result.doubleField("quality_score");
        Double liveness = result.doubleField("liveness_score");
        Double matchScore = result.doubleField("match_score");
        Double matchMean = result.doubleField("match_mean");
        java.util.List<Double> matchScores = result.doubleList("match_scores");
        Double workerCandidateCount = result.doubleField("candidate_count");
        Double scoreMeanForQuorum = matchMean;
        if (scoreMeanForQuorum == null && !matchScores.isEmpty()) {
            scoreMeanForQuorum = matchScores.stream()
                    .mapToDouble(Double::doubleValue)
                    .average()
                    .orElse(Double.NaN);
        }

        // resultCode = value written to the audit log's `result` column, which
        // is constrained by ck_face_events_result (V034) to a fixed enum. We
        // keep it "FAIL_MATCH" for both the "best-below-threshold" and the
        // "inconsistent across templates" branches. wireCode is the code the
        // client sees on the exception message and can be more specific (e.g.
        // FAIL_MATCH_INCONSISTENT) so the mobile app can pick a distinct
        // friendly message for each sub-case.
        String resultCode = "PASS";
        String wireCode = "PASS";

        if (faceDetected == null || !faceDetected) {
            resultCode = "FAIL_NO_FACE";
            wireCode = "FAIL_NO_FACE";
        } else if (exactlyOne != null && !exactlyOne) {
            resultCode = "FAIL_MULTIPLE_FACES";
            wireCode = "FAIL_MULTIPLE_FACES";
        } else if (quality != null && quality < minQuality) {
            resultCode = "FAIL_LOW_QUALITY";
            wireCode = "FAIL_LOW_QUALITY";
        } else if (requireLiveness && (liveness == null || liveness < livenessThreshold)) {
            resultCode = "FAIL_LIVENESS";
            wireCode = "FAIL_LIVENESS";
        } else if (!hasStrictScoreDistribution(matchScores, workerCandidateCount, candidates.size())) {
            writer.recordVerificationEvent(tenantId, employeeId, purpose,
                    "FAIL_OTHER", friendlyRejectionCopy("FACE_WORKER_BAD_RESPONSE"),
                    matchScore, quality, liveness, modelName, modelVersion,
                    bucketize(matchScore), str(req.challengePerformed()),
                    req.deviceFingerprint(), req.latitude(), req.longitude(), latency);
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "FACE_WORKER_BAD_RESPONSE:" + friendlyRejectionCopy("FACE_WORKER_BAD_RESPONSE"));
        } else if (matchScore == null || matchScore < matchThreshold) {
            // Best single template did not pass. A stranger's face will almost
            // always end up here.
            resultCode = "FAIL_MATCH";
            wireCode = "FAIL_MATCH";
        } else if (scoreMeanForQuorum == null || scoreMeanForQuorum < (matchThreshold - matchMeanGap)) {
            // Best was good but the average across the enrolled templates
            // is suspiciously low. Classic "one lucky angle" signature.
            resultCode = "FAIL_MATCH";
            wireCode = "FAIL_MATCH_INCONSISTENT";
        } else if (!matchScores.isEmpty()) {
            // Quorum: need >= matchQuorum templates >= (matchThreshold - matchTemplateGap).
            double agreeFloor = matchThreshold - matchTemplateGap;
            long agree = matchScores.stream().filter(s -> s != null && s >= agreeFloor).count();
            int neededQuorum = Math.min(matchQuorum, matchScores.size());
            if (agree < neededQuorum) {
                resultCode = "FAIL_MATCH";
                wireCode = "FAIL_MATCH_INCONSISTENT";
            }
        }

        String reason = "PASS".equals(wireCode) ? null : friendlyRejectionCopy(wireCode);
        String bucket = bucketize(matchScore);

        writer.recordVerificationEvent(tenantId, employeeId, purpose,
                resultCode, reason, matchScore, quality, liveness,
                modelName, modelVersion, bucket, str(req.challengePerformed()),
                req.deviceFingerprint(), req.latitude(), req.longitude(), latency);

        if ("PASS".equals(resultCode)) {
            writer.resetFailureCounter(tenantId, employeeId);
            return new VerifyResponse(true, null, bucket, liveness);
        }

        // FAIL path: bump counter; possibly lock the enrollment.
        writer.bumpFailureCounter(tenantId, employeeId, lockoutFailureCount,
                "Auto-locked after " + lockoutFailureCount + " consecutive face failures");
        HttpStatus httpStatus = switch (resultCode) {
            case "FAIL_NO_FACE", "FAIL_MULTIPLE_FACES", "FAIL_LOW_QUALITY" -> HttpStatus.UNPROCESSABLE_ENTITY;
            case "FAIL_LIVENESS", "FAIL_MATCH" -> HttpStatus.FORBIDDEN;
            default -> HttpStatus.FORBIDDEN;
        };
        throw new ResponseStatusException(httpStatus, wireCode + ":" + reason);
    }

    /** Punch-in endpoint. For now: verify only. Actual attendance row creation
     *  is Phase 2 attendance work; this method returns the verification result
     *  so the App knows it can show the success screen. */
    public CheckinFaceResponse checkinWithFace(UUID tenantId, UUID employeeId, VerifyRequest req) {
        VerifyResponse v = verify(tenantId, employeeId, req, "PUNCH_IN");
        // TODO(phase-2-attendance): insert into attendance.records here once the
        // Attendance write-path lands. For now return a placeholder so the App
        // can render a "Punched In" screen during the face MVP.
        return new CheckinFaceResponse(true, null, null, v.scoreBucket(), Instant.now());
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    public List<AdminEnrollmentSummary> adminList(UUID tenantId, String statusFilter) {
        String sql = """
            SELECT fe.employee_id, uc.email, fe.status, fe.samples_captured,
                   fe.consecutive_failures, fe.enrolled_at, fe.locked_at, fe.locked_reason
              FROM attendance.face_enrollments fe
              LEFT JOIN auth.user_credentials uc ON uc.id = fe.employee_id
             WHERE fe.tenant_id = ?
            """ + (statusFilter == null || statusFilter.isBlank() ? "" : " AND fe.status = ?")
            + " ORDER BY fe.updated_at DESC LIMIT 500";
        Object[] args = (statusFilter == null || statusFilter.isBlank())
                ? new Object[]{tenantId} : new Object[]{tenantId, statusFilter};
        List<AdminEnrollmentSummary> rows = new ArrayList<>();
        jdbc.query(sql, rs -> {
            rows.add(new AdminEnrollmentSummary(
                    UUID.fromString(rs.getString("employee_id")),
                    rs.getString("email"),
                    EnrollmentStatus.valueOf(rs.getString("status")),
                    rs.getInt("samples_captured"),
                    rs.getInt("consecutive_failures"),
                    rs.getTimestamp("enrolled_at") == null ? null : rs.getTimestamp("enrolled_at").toInstant(),
                    rs.getTimestamp("locked_at") == null ? null : rs.getTimestamp("locked_at").toInstant(),
                    rs.getString("locked_reason")));
        }, args);
        return rows;
    }

    public List<AdminVerificationEvent> adminEvents(UUID tenantId, UUID employeeId, int limit) {
        // device: what the client sent with the check, else (for a passed
        // punch-in check made before the punch labelled it, see
        // FacePunchDevices) the device on the punch it cleared: the same
        // person's check-in within 15 minutes after it.
        String sql = """
            SELECT fe.id, fe.employee_id, fe.purpose, fe.result, fe.reason, fe.score_bucket, fe.created_at,
                   COALESCE(NULLIF(btrim(fe.device_fingerprint), ''), punch.device_id) AS device
              FROM attendance.face_verification_events fe
              LEFT JOIN LATERAL (
                   SELECT NULLIF(btrim(r.device_id), '') AS device_id
                     FROM auth.user_credentials uc
                     JOIN attendance.records r
                       ON r.tenant_id = fe.tenant_id AND r.employee_id = uc.employee_id
                      AND r.attendance_date = (fe.created_at AT TIME ZONE 'Asia/Kolkata')::date
                      AND r.check_in_at BETWEEN fe.created_at - interval '2 minutes' AND fe.created_at + interval '15 minutes'
                    WHERE uc.id = fe.employee_id AND uc.tenant_id = fe.tenant_id
                      AND fe.purpose = 'PUNCH_IN' AND fe.result = 'PASS'
                      AND NULLIF(btrim(fe.device_fingerprint), '') IS NULL
                    ORDER BY r.check_in_at
                    LIMIT 1) punch ON true
             WHERE fe.tenant_id = ?
            """ + (employeeId == null ? "" : " AND fe.employee_id = ?")
            + " ORDER BY fe.created_at DESC LIMIT " + Math.max(1, Math.min(limit, 500));
        Object[] args = employeeId == null ? new Object[]{tenantId} : new Object[]{tenantId, employeeId};
        List<AdminVerificationEvent> rows = new ArrayList<>();
        jdbc.query(sql, rs -> {
            rows.add(new AdminVerificationEvent(
                    UUID.fromString(rs.getString("id")),
                    UUID.fromString(rs.getString("employee_id")),
                    rs.getString("purpose"),
                    rs.getString("result"),
                    rs.getString("reason"),
                    rs.getString("score_bucket"),
                    rs.getTimestamp("created_at").toInstant(),
                    rs.getString("device")));
        }, args);
        return rows;
    }

    /**
     * Clears a face enrollment. {@code loginId} is the LOGIN id — face rows key
     * on the login, not on the HR employee record (see {@link #loginFor}). Pass
     * an employee record id here and the UPDATEs match no row, report no error
     * and reset nothing; callers holding an employee id must go through
     * {@link #requireLoginFor} first.
     */
    public void adminReset(UUID tenantId, UUID loginId, UUID actingAdminId, String reason) {
        writer.adminReset(tenantId, loginId,
                actingAdminId,
                reason == null ? "manual admin reset" : reason);
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    private void ensureEnabled() {
        if (!enabled) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "FACE_DISABLED:" + friendlyRejectionCopy("FACE_DISABLED"));
        }
    }

    /**
     * Canonical, user-facing copy for every code the face pipeline can raise.
     * The mobile app has an identical table (utils/faceError.ts); keeping the
     * strings verbatim here means:
     *   - if the mobile is offline / hasn't been updated, the server-provided
     *     sentence is already user-safe;
     *   - if the mobile is up-to-date it will still prefer this copy over the
     *     code-keyed fallback, so both sides converge on the same wording.
     * Every line is action-oriented and never accuses the user of a specific
     * signal (e.g. lighting) unless we actually measured that signal.
     */
    private static String friendlyRejectionCopy(String code) {
        return switch (code) {
            case "FAIL_NO_FACE" -> "We can't see a face in the frame. Point the front camera at your face and keep it inside the guide, then try again.";
            case "FAIL_MULTIPLE_FACES" -> "More than one face is in the frame. Please make sure you're the only person visible before capturing.";
            case "FAIL_LOW_QUALITY" -> "The photo wasn't sharp enough to read. Wipe the front lens, hold the phone steady, face even light, and try again.";
            case "FAIL_LIVENESS" -> "We couldn't confirm a live face. Please blink (or follow the on-screen prompt) while looking at the camera, then try again.";
            case "FAIL_MATCH" -> "That doesn't look like your enrolled face. Look straight at the camera in even light and try again. If this keeps happening, ask your manager to reset your face enrolment.";
            case "FAIL_MATCH_INCONSISTENT" -> "Your face partially matched but not consistently. Try again looking straight at the camera. If it keeps failing, ask your manager to reset your face enrolment.";
            case "FAIL_OTHER" -> "Something went wrong on our side while checking your face. Please try again in a moment.";
            case "FACE_LOCKED" -> "Face verification is temporarily locked after several unsuccessful attempts. Please ask your manager to reset it.";
            case "FACE_NOT_ENROLLED" -> "You haven't enrolled your face yet. Please open Face Enrolment first.";
            case "FACE_TEMPLATE_INCOMPLETE" -> "Your face enrolment isn't complete. Please ask your manager to reset it and enrol again.";
            case "FACE_ENROLLMENT_NOT_FOUND" -> "Your enrolment session expired. Please start face enrolment again from the beginning.";
            case "FACE_SAMPLES_INCOMPLETE" -> "You still have more angles to capture before enrolment can finish.";
            case "FACE_WORKER_UNAVAILABLE" -> "Face check service is temporarily unavailable. Please try again in a moment, or request a manual correction from the Requests tab.";
            case "FACE_WORKER_BAD_RESPONSE", "FACE_WORKER_BAD_EMBEDDING" -> "We couldn't complete the face check just now. Please try again in a moment.";
            case "FACE_DISABLED" -> "Face check is turned off for this workspace. Please contact your admin.";
            case "DUPLICATE_ANGLE" -> "You've already captured this angle — continue with the next one.";
            case "FACE_NO_LOGIN" -> "This person can't sign in yet, so there is no face to enroll. Invite them first.";
            default -> "Face check couldn't complete. Please try again.";
        };
    }

    private EnrollmentRow loadEnrollment(UUID tenantId, UUID employeeId) {
        try {
            return jdbc.queryForObject("""
                SELECT id, status, samples_captured, consecutive_failures, enrolled_at, locked_at
                  FROM attendance.face_enrollments
                 WHERE tenant_id = ? AND employee_id = ?
                """, (rs, n) -> new EnrollmentRow(
                    UUID.fromString(rs.getString("id")),
                    EnrollmentStatus.valueOf(rs.getString("status")),
                    rs.getInt("samples_captured"),
                    rs.getInt("consecutive_failures"),
                    rs.getTimestamp("enrolled_at") == null ? null : rs.getTimestamp("enrolled_at").toInstant(),
                    rs.getTimestamp("locked_at") == null ? null : rs.getTimestamp("locked_at").toInstant()),
                tenantId, employeeId);
        } catch (EmptyResultDataAccessException e) {
            return null;
        }
    }

    private List<CaptureAngle> capturedAngles(UUID tenantId, UUID employeeId) {
        List<String> got = jdbc.queryForList("""
            SELECT capture_angle FROM attendance.face_embedding_templates
             WHERE tenant_id = ? AND employee_id = ? AND is_active = TRUE
             """, String.class, tenantId, employeeId);
        Set<CaptureAngle> seen = new HashSet<>();
        for (String s : got) {
            try { seen.add(CaptureAngle.valueOf(s)); } catch (Exception ignored) {}
        }
        return new ArrayList<>(seen);
    }

    private List<CaptureAngle> remainingAngles(UUID tenantId, UUID employeeId) {
        List<CaptureAngle> captured = capturedAngles(tenantId, employeeId);
        List<CaptureAngle> remaining = new ArrayList<>(CAPTURE_SEQUENCE);
        remaining.removeAll(captured);
        return remaining;
    }

    private List<CaptureAngle> remainingAnglesAfter(CaptureAngle justCaptured, List<CaptureAngle> before) {
        List<CaptureAngle> after = new ArrayList<>(before);
        after.remove(justCaptured);
        return after;
    }

    private List<float[]> loadActiveEmbeddings(UUID tenantId, UUID employeeId) {
        List<byte[]> blobs = jdbc.queryForList("""
            SELECT encrypted_embedding FROM attendance.face_embedding_templates
             WHERE tenant_id = ? AND employee_id = ? AND is_active = TRUE
             ORDER BY sample_index
            """, byte[].class, tenantId, employeeId);
        List<float[]> out = new ArrayList<>(blobs.size());
        for (byte[] b : blobs) {
            try { out.add(cipher.decrypt(b)); }
            catch (Exception e) { log.warn("skipping unreadable embedding for {}", employeeId); }
        }
        return out;
    }

    private List<Challenge> randomChallenges() {
        List<Challenge> pool = new ArrayList<>(Arrays.asList(Challenge.values()));
        List<Challenge> picked = new ArrayList<>();
        for (int i = 0; i < 2 && !pool.isEmpty(); i++) {
            picked.add(pool.remove(rng.nextInt(pool.size())));
        }
        return picked;
    }

    private static String bucketize(Double score) {
        if (score == null) return "UNKNOWN";
        if (score >= 0.90) return "HIGH";
        if (score >= 0.82) return "MEDIUM";
        if (score >= 0.75) return "LOW";
        return "REJECTED";
    }

    private static String str(Object o) { return o == null ? null : o.toString(); }

    private static boolean hasStrictScoreDistribution(List<Double> scores,
                                                      Double candidateCount,
                                                      int expectedCount) {
        if (scores == null || scores.size() != expectedCount) return false;
        if (candidateCount == null || !Double.isFinite(candidateCount)
                || candidateCount.doubleValue() != expectedCount) {
            return false;
        }
        for (Double score : scores) {
            if (score == null || !Double.isFinite(score) || score < 0.0 || score > 1.0) {
                return false;
            }
        }
        return true;
    }

    private static float[] decodeFloatVector(String b64, int dim) {
        byte[] bytes = Base64.getDecoder().decode(b64);
        if (bytes.length != dim * Float.BYTES) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "FACE_WORKER_BAD_EMBEDDING:" + friendlyRejectionCopy("FACE_WORKER_BAD_EMBEDDING"));
        }
        return com.unifiedtree.attendance.face.crypto.FloatBufferUtil.fromLittleEndianBytes(bytes);
    }

    private static String encodeFloatVector(float[] v) {
        return Base64.getEncoder().encodeToString(
                com.unifiedtree.attendance.face.crypto.FloatBufferUtil.toLittleEndianBytes(v));
    }

    private record EnrollmentRow(UUID id, EnrollmentStatus status,
                                 int samplesCaptured, int consecutiveFailures, Instant enrolledAt,
                                 Instant lockedAt) {}

    /**
     * True when the enrolment should still be treated as LOCKED. A lock older
     * than {@code lockoutCooldownMinutes} is cleared automatically (status back
     * to ACTIVE, failure counter reset — templates are kept) so the employee can
     * retry without a manager. {@code lockoutCooldownMinutes <= 0} disables the
     * auto-unlock, preserving the old manager-only behaviour.
     */
    private boolean stillLocked(UUID tenantId, UUID employeeId, EnrollmentRow row) {
        if (row == null || row.status() != EnrollmentStatus.LOCKED) {
            return false;
        }
        Instant lockedAt = row.lockedAt();
        if (lockoutCooldownMinutes > 0 && lockedAt != null
                && java.time.Duration.between(lockedAt, Instant.now()).toMinutes() >= lockoutCooldownMinutes) {
            try {
                writer.clearLock(tenantId, employeeId);
                log.info("Auto-unlocked face enrolment for employee {} after {}-min cooldown",
                        employeeId, lockoutCooldownMinutes);
                return false;
            } catch (Exception ex) {
                log.warn("Auto-unlock failed for employee {}: {}", employeeId, ex.getMessage());
            }
        }
        return true;
    }
}
