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
import com.unifiedtree.attendance.face.dto.FaceDtos.VerifyRequest;
import com.unifiedtree.attendance.face.dto.FaceDtos.VerifyResponse;
import com.unifiedtree.attendance.face.worker.FaceWorkerClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
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

    private final boolean enabled;
    private final double matchThreshold;
    private final double matchMeanGap;
    private final double matchTemplateGap;
    private final int matchQuorum;
    private final double minQuality;
    private final boolean requireLiveness;
    private final double livenessThreshold;
    private final int lockoutFailureCount;
    private final String modelName;
    private final String modelVersion;
    private final Random rng = new Random();

    public FaceService(JdbcTemplate jdbc,
                       FaceWriter writer,
                       FaceWorkerClient worker,
                       EmbeddingCipher cipher,
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
                       @Value("${unifiedtree.face.model-name:sface}") String modelName,
                       @Value("${unifiedtree.face.model-version:sface-1.0}") String modelVersion) {
        this.jdbc = jdbc;
        this.writer = writer;
        this.worker = worker;
        this.cipher = cipher;
        this.enabled = enabled;
        this.matchThreshold = matchThreshold;
        this.matchMeanGap = Math.max(0.0, matchMeanGap);
        this.matchTemplateGap = Math.max(0.0, matchTemplateGap);
        this.matchQuorum = Math.max(1, matchQuorum);
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
        EnrollmentRow row = loadEnrollment(tenantId, employeeId);
        if (row == null) {
            return new EnrollmentStatusResponse(
                    EnrollmentStatus.PENDING, SAMPLES_REQUIRED, 0,
                    CAPTURE_SEQUENCE, 0, false, null);
        }
        // Self-heal: if all samples were captured but the explicit
        // completeEnrollment call was missed/failed (leaving the row PENDING),
        // activate it here so the user is NOT bounced back into enrollment on
        // their next session. This makes "enroll once, then only verify" robust.
        EnrollmentStatus effectiveStatus = row.status;
        if (row.status == EnrollmentStatus.PENDING && row.samplesCaptured >= SAMPLES_REQUIRED) {
            try {
                writer.markEnrollmentActive(row.id, employeeId);
                effectiveStatus = EnrollmentStatus.ACTIVE;
            } catch (Exception ignored) {
                // Non-fatal: fall back to the persisted status.
            }
        }
        List<CaptureAngle> captured = capturedAngles(tenantId, employeeId);
        List<CaptureAngle> remaining = new ArrayList<>(CAPTURE_SEQUENCE);
        remaining.removeAll(captured);
        return new EnrollmentStatusResponse(
                effectiveStatus, SAMPLES_REQUIRED, row.samplesCaptured,
                remaining, row.consecutiveFailures,
                effectiveStatus == EnrollmentStatus.LOCKED,
                row.enrolledAt);
    }

    // ---------------------------------------------------------------------
    // Enrollment flow
    // ---------------------------------------------------------------------

    public EnrollmentStartResponse startEnrollment(UUID tenantId, UUID employeeId, EnrollmentStartRequest req) {
        ensureEnabled();
        EnrollmentRow existing = loadEnrollment(tenantId, employeeId);
        if (existing != null && existing.status == EnrollmentStatus.LOCKED) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "FACE_LOCKED:Enrollment is locked; ask your manager to reset.");
        }
        UUID id = writer.upsertPendingEnrollment(tenantId, employeeId, SAMPLES_REQUIRED);
        List<Challenge> challenges = randomChallenges();
        return new EnrollmentStartResponse(id, SAMPLES_REQUIRED, CAPTURE_SEQUENCE,
                challenges, worker.isHealthy() ? "worker-online" : "worker-offline");
    }

    public EnrollmentSampleResponse submitSample(UUID tenantId, UUID employeeId, EnrollmentSampleRequest req) {
        ensureEnabled();
        EnrollmentRow row = loadEnrollment(tenantId, employeeId);
        if (row == null || !row.id.equals(req.enrollmentId())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,
                    "FACE_ENROLLMENT_NOT_FOUND:Start a new enrollment first.");
        }
        if (row.status == EnrollmentStatus.LOCKED) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "FACE_LOCKED:Ask your manager to reset enrollment.");
        }

        // Reject duplicate angle.
        if (capturedAngles(tenantId, employeeId).contains(req.captureAngle())) {
            return new EnrollmentSampleResponse(false, req.captureAngle(),
                    row.samplesCaptured, SAMPLES_REQUIRED, null, null,
                    "Angle already captured. Continue with next angle.",
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
                    "FACE_WORKER_UNAVAILABLE:Face service is offline. Try again or request manual correction.");
        }

        Boolean faceDetected = result.boolField("face_detected");
        Boolean exactlyOne = result.boolField("exactly_one_face");
        Double quality = result.doubleField("quality_score");
        Double liveness = result.doubleField("liveness_score");
        String embeddingBase64 = result.stringField("embedding_base64");
        Integer dim = (Integer) result.get("embedding_dim");

        String rejection = null;
        String resultCode = "PASS";
        if (faceDetected == null || !faceDetected) {
            resultCode = "FAIL_NO_FACE";
            rejection = "No face detected. Center your face and try again.";
        } else if (exactlyOne != null && !exactlyOne) {
            resultCode = "FAIL_MULTIPLE_FACES";
            rejection = "More than one face detected. Capture alone.";
        } else if (quality == null || quality < minQuality) {
            resultCode = "FAIL_LOW_QUALITY";
            rejection = "Face is blurry or too dark. Try better lighting.";
        } else if (requireLiveness && (liveness == null || liveness < livenessThreshold)) {
            resultCode = "FAIL_LIVENESS";
            rejection = "Liveness check failed. Follow the angle instruction and try brighter light.";
        } else if (embeddingBase64 == null || dim == null) {
            resultCode = "FAIL_OTHER";
            rejection = "Worker did not return an embedding.";
        }

        writer.recordVerificationEvent(tenantId, employeeId,
                "ENROLLMENT_SAMPLE", resultCode, rejection,
                null, quality, liveness, modelName, modelVersion,
                null, str(req.challengePerformed()), req.deviceFingerprint(),
                null, null, latency);

        if (!"PASS".equals(resultCode)) {
            return new EnrollmentSampleResponse(false, req.captureAngle(),
                    row.samplesCaptured, SAMPLES_REQUIRED, quality, liveness, rejection,
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
                newCaptured, SAMPLES_REQUIRED, quality, liveness, null,
                remainingAnglesAfter(req.captureAngle(),
                        remainingAngles(tenantId, employeeId)));
    }

    public EnrollmentCompleteResponse completeEnrollment(UUID tenantId, UUID employeeId, UUID actingUserId) {
        EnrollmentRow row = loadEnrollment(tenantId, employeeId);
        if (row == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,
                    "FACE_ENROLLMENT_NOT_FOUND:Start enrollment first.");
        }
        if (row.samplesCaptured < SAMPLES_REQUIRED) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "FACE_SAMPLES_INCOMPLETE:" + row.samplesCaptured + "/" + SAMPLES_REQUIRED + " samples captured.");
        }
        writer.markEnrollmentActive(row.id, actingUserId);
        return new EnrollmentCompleteResponse(EnrollmentStatus.ACTIVE, row.id,
                row.samplesCaptured, "Enrollment complete. You can now punch in with your face.");
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
                    "FACE_NOT_ENROLLED:Enroll your face from the App to enable face punch-in.");
        }
        if (row.status == EnrollmentStatus.LOCKED) {
            writer.recordVerificationEvent(tenantId, employeeId, purpose,
                    "FAIL_LOCKED", "Face verification locked after repeated failures.",
                    null, null, null, modelName, modelVersion,
                    null, str(req.challengePerformed()), req.deviceFingerprint(),
                    req.latitude(), req.longitude(), null);
            throw new ResponseStatusException(HttpStatus.LOCKED,
                    "FACE_LOCKED:Face verification is locked after repeated failed attempts. Ask your manager to reset it, then enroll again.");
        }
        if (row.status != EnrollmentStatus.ACTIVE) {
            writer.recordVerificationEvent(tenantId, employeeId, purpose,
                    "FAIL_NOT_ENROLLED", "Face enrollment is not active.",
                    null, null, null, modelName, modelVersion,
                    null, str(req.challengePerformed()), req.deviceFingerprint(),
                    req.latitude(), req.longitude(), null);
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "FACE_NOT_ENROLLED:Complete face enrollment before punch-in.");
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
                    "FACE_TEMPLATE_INCOMPLETE:Face enrollment is incomplete. Ask your manager to reset it, then enroll again.");
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
                    "FACE_WORKER_UNAVAILABLE:Face service is offline. Try again or request manual correction.");
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

        String resultCode = "PASS";
        String reason = null;

        if (faceDetected == null || !faceDetected) {
            resultCode = "FAIL_NO_FACE";
            reason = "No face detected.";
        } else if (exactlyOne != null && !exactlyOne) {
            resultCode = "FAIL_MULTIPLE_FACES";
            reason = "More than one face detected.";
        } else if (quality != null && quality < minQuality) {
            resultCode = "FAIL_LOW_QUALITY";
            reason = "Face image quality too low. Move closer or improve lighting.";
        } else if (requireLiveness && (liveness == null || liveness < livenessThreshold)) {
            resultCode = "FAIL_LIVENESS";
            reason = "Liveness check failed - move into brighter light and keep your face centered.";
        } else if (!hasStrictScoreDistribution(matchScores, workerCandidateCount, candidates.size())) {
            writer.recordVerificationEvent(tenantId, employeeId, purpose,
                    "FAIL_OTHER", "Face worker returned an incomplete score distribution.",
                    matchScore, quality, liveness, modelName, modelVersion,
                    bucketize(matchScore), str(req.challengePerformed()),
                    req.deviceFingerprint(), req.latitude(), req.longitude(), latency);
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "FACE_WORKER_BAD_RESPONSE:Face service returned incomplete match scores. Try again or request manual correction.");
        } else if (matchScore == null || matchScore < matchThreshold) {
            // Best single template did not pass. A stranger's face will almost
            // always end up here.
            resultCode = "FAIL_MATCH";
            reason = "Face does not match enrolled employee.";
        } else if (scoreMeanForQuorum == null || scoreMeanForQuorum < (matchThreshold - matchMeanGap)) {
            // Best was good but the average across the enrolled templates
            // is suspiciously low. Classic "one lucky angle" signature.
            resultCode = "FAIL_MATCH";
            reason = "Face match inconsistent across enrolled angles.";
        } else if (!matchScores.isEmpty()) {
            // Quorum: need >= matchQuorum templates >= (matchThreshold - matchTemplateGap).
            double agreeFloor = matchThreshold - matchTemplateGap;
            long agree = matchScores.stream().filter(s -> s != null && s >= agreeFloor).count();
            int neededQuorum = Math.min(matchQuorum, matchScores.size());
            if (agree < neededQuorum) {
                resultCode = "FAIL_MATCH";
                reason = "Only " + agree + " of " + matchScores.size()
                        + " enrolled angles agreed; need " + neededQuorum + ".";
            }
        }

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
        throw new ResponseStatusException(httpStatus, resultCode + ":" + (reason == null ? "" : reason));
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
        String sql = """
            SELECT id, employee_id, purpose, result, reason, score_bucket, created_at
              FROM attendance.face_verification_events
             WHERE tenant_id = ?
            """ + (employeeId == null ? "" : " AND employee_id = ?")
            + " ORDER BY created_at DESC LIMIT " + Math.max(1, Math.min(limit, 500));
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
                    rs.getTimestamp("created_at").toInstant()));
        }, args);
        return rows;
    }

    public void adminReset(UUID tenantId, UUID employeeId, UUID actingAdminId, String reason) {
        writer.adminReset(tenantId, employeeId,
                actingAdminId,
                reason == null ? "manual admin reset" : reason);
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    private void ensureEnabled() {
        if (!enabled) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "FACE_DISABLED:Face verification is disabled on this deployment.");
        }
    }

    private EnrollmentRow loadEnrollment(UUID tenantId, UUID employeeId) {
        try {
            return jdbc.queryForObject("""
                SELECT id, status, samples_captured, consecutive_failures, enrolled_at
                  FROM attendance.face_enrollments
                 WHERE tenant_id = ? AND employee_id = ?
                """, (rs, n) -> new EnrollmentRow(
                    UUID.fromString(rs.getString("id")),
                    EnrollmentStatus.valueOf(rs.getString("status")),
                    rs.getInt("samples_captured"),
                    rs.getInt("consecutive_failures"),
                    rs.getTimestamp("enrolled_at") == null ? null : rs.getTimestamp("enrolled_at").toInstant()),
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
                    "FACE_WORKER_BAD_EMBEDDING:Embedding dim mismatch.");
        }
        return com.unifiedtree.attendance.face.crypto.FloatBufferUtil.fromLittleEndianBytes(bytes);
    }

    private static String encodeFloatVector(float[] v) {
        return Base64.getEncoder().encodeToString(
                com.unifiedtree.attendance.face.crypto.FloatBufferUtil.toLittleEndianBytes(v));
    }

    private record EnrollmentRow(UUID id, EnrollmentStatus status,
                                 int samplesCaptured, int consecutiveFailures, Instant enrolledAt) {}
}
