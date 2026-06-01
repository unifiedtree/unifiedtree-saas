package com.unifiedtree.attendance.face.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Wire DTOs for the canonical face enrollment + verification endpoints.
 *
 * <p>NEVER carries raw image bytes back to the client after they have been
 * uploaded. Embedding ciphertext is also never serialized.
 */
public final class FaceDtos {
    private FaceDtos() {}

    /** Capture angles required to complete one enrollment. Order matters. */
    public enum CaptureAngle { FRONT, LEFT_30, RIGHT_30, UP_15, VARIED_LIGHT }

    /** Liveness challenge types randomized at enroll / verify time. */
    public enum Challenge { BLINK, TURN_LEFT, TURN_RIGHT, NOD, SMILE }

    public enum EnrollmentStatus { PENDING, ACTIVE, NEEDS_REENROLLMENT, LOCKED, REVOKED }

    /** GET /v1/attendance/face/enrollment-status response. */
    public record EnrollmentStatusResponse(
            EnrollmentStatus status,
            int samplesRequired,
            int samplesCaptured,
            List<CaptureAngle> remainingAngles,
            int consecutiveFailures,
            boolean lockedRequiresManagerReset,
            Instant enrolledAt
    ) {}

    /** POST /v1/attendance/face/enroll/start request body. */
    public record EnrollmentStartRequest(
            /** Optional opaque device fingerprint for audit + lockouts. */
            @Size(max = 120) String deviceFingerprint
    ) {}

    /** POST /v1/attendance/face/enroll/start response. */
    public record EnrollmentStartResponse(
            UUID enrollmentId,
            int samplesRequired,
            List<CaptureAngle> captureSequence,
            List<Challenge> liveness,
            String workerHint
    ) {}

    /** POST /v1/attendance/face/enroll/sample request. */
    public record EnrollmentSampleRequest(
            @NotNull UUID enrollmentId,
            @NotNull CaptureAngle captureAngle,
            /** Base64-encoded JPEG. Server caps at FACE_MAX_IMAGE_BYTES. */
            @NotBlank @Pattern(regexp = "^[A-Za-z0-9+/=]+$") String imageBase64,
            /** Which challenge the user just performed (echoed for audit). */
            Challenge challengePerformed,
            @Size(max = 120) String deviceFingerprint
    ) {}

    public record EnrollmentSampleResponse(
            boolean accepted,
            CaptureAngle capturedAngle,
            int samplesCaptured,
            int samplesRequired,
            Double qualityScore,
            Double livenessScore,
            String rejectionReason,
            List<CaptureAngle> remainingAngles
    ) {}

    /** POST /v1/attendance/face/enroll/complete. */
    public record EnrollmentCompleteResponse(
            EnrollmentStatus status,
            UUID enrollmentId,
            int samplesCaptured,
            String message
    ) {}

    /** POST /v1/attendance/face/verify and /v1/attendance/checkin/face request. */
    public record VerifyRequest(
            @NotBlank @Pattern(regexp = "^[A-Za-z0-9+/=]+$") String imageBase64,
            Challenge challengePerformed,
            Double latitude,
            Double longitude,
            @Size(max = 120) String deviceFingerprint
    ) {}

    public record VerifyResponse(
            boolean passed,
            String reason,
            /** Coarse-grained bucket for UI. Never the raw float. */
            String scoreBucket,
            Double livenessScore
    ) {}

    public record CheckinFaceResponse(
            boolean punched,
            String attendanceId,
            String reason,
            String scoreBucket,
            Instant punchedAt
    ) {}

    /** GET /v1/attendance/face/admin/employees response item. */
    public record AdminEnrollmentSummary(
            UUID employeeId,
            String email,
            EnrollmentStatus status,
            int samplesCaptured,
            int consecutiveFailures,
            Instant enrolledAt,
            Instant lockedAt,
            String lockedReason
    ) {}

    /** GET /v1/attendance/face/admin/events item. */
    public record AdminVerificationEvent(
            UUID id,
            UUID employeeId,
            String purpose,
            String result,
            String reason,
            String scoreBucket,
            Instant createdAt
    ) {}
}
