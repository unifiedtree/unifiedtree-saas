package com.hrms.api.attendance;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.HrmsException;
import com.unifiedtree.attendance.face.dto.FaceDtos;
import com.unifiedtree.attendance.face.service.FaceService;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import java.util.UUID;
import java.util.regex.Pattern;

/**
 * The face scan on a web punch (client decision, 1 Oct: "web punches use a
 * face scan, like the phone").
 *
 * <p>The phone's face check, reused rather than copied: {@link FaceService#verify}
 * against the enrolment of the person signed in (face data is keyed by the
 * login, the token's subject), with the same challenge the phone app sends
 * (BLINK), the same lockout after repeated failures, and the same audit row in
 * attendance.face_verification_events (purpose PUNCH_IN or PUNCH_OUT, device
 * "Web browser"). It needs the permission the phone's face check needs,
 * {@code attendance.face.verify.self}. The punch is made only after the face
 * matched.
 *
 * <p>Refusals keep the face module's HTTP status and code (FACE_NOT_ENROLLED,
 * FACE_LOCKED, FAIL_MATCH, …) with a sentence written for a browser.
 */
@Component
public class WebPunchFace {

    static final String PERM_VERIFY = "attendance.face.verify.self";
    /** The device column of the face log when the browser sends no label. */
    static final String DEVICE = "Web browser";
    static final String PUNCH_IN = "PUNCH_IN";
    static final String PUNCH_OUT = "PUNCH_OUT";
    /** The face module's rule for the image (FaceDtos.VerifyRequest): plain base64. */
    private static final Pattern BASE64 = Pattern.compile("^[A-Za-z0-9+/=]+$");

    private final FaceService faces;

    public WebPunchFace(FaceService faces) {
        this.faces = faces;
    }

    /**
     * Checks the face for a web punch; returns only when it matched. Call it
     * after the switch, location and zone checks, so nobody spends a face try
     * on a punch that would be refused anyway.
     */
    public void verify(Jwt jwt, String imageBase64, Double latitude, Double longitude, String deviceId, boolean checkIn) {
        if (!AttendanceController.hasPermission(jwt, PERM_VERIFY)) {
            throw new HrmsException("Your access doesn't include the face check, so you can't check in or out from the web. Ask your admin.",
                    HttpStatus.FORBIDDEN, "FACE_VERIFY_NOT_ALLOWED");
        }
        String image = imageBase64 == null ? "" : imageBase64.trim();
        if (image.isEmpty()) {
            throw new BusinessRuleException("Scan your face to check in or out from the web.", "FACE_IMAGE_REQUIRED");
        }
        if (!BASE64.matcher(image).matches()) {
            throw new BusinessRuleException("The face photo couldn't be read. Take it again.", "FACE_IMAGE_INVALID");
        }
        String device = FacePunchDevices.label(deviceId);
        try {
            faces.verify(tenantOf(jwt), UUID.fromString(jwt.getSubject()),
                    new FaceDtos.VerifyRequest(image, FaceDtos.Challenge.BLINK, latitude, longitude, device != null ? device : DEVICE),
                    checkIn ? PUNCH_IN : PUNCH_OUT);
        } catch (ResponseStatusException ex) {
            throw refusal(ex);
        }
    }

    /**
     * The face module's refusal ("CODE:sentence", written for the phone) for
     * someone at a browser. Same HTTP status, the code as the error code.
     */
    static HrmsException refusal(ResponseStatusException ex) {
        String reason = ex.getReason() == null ? "" : ex.getReason();
        int colon = reason.indexOf(':');
        String code = colon > 0 ? reason.substring(0, colon) : "FACE_CHECK_FAILED";
        String original = colon > 0 ? reason.substring(colon + 1).trim() : reason.trim();
        String message = switch (code) {
            case "FACE_NOT_ENROLLED" -> "You haven't enrolled your face yet. Enrol it once, then check in.";
            case "FACE_TEMPLATE_INCOMPLETE" -> "Your face enrolment isn't complete. Ask HR to reset it, then enrol again.";
            case "FACE_LOCKED" -> "The face check is locked after several failed tries. It unlocks by itself after a while, or HR can reset it.";
            case "FAIL_MATCH", "FAIL_MATCH_INCONSISTENT" -> "That doesn't look like your enrolled face. Look straight at the camera, in even light, and try again.";
            case "FAIL_LIVENESS" -> "We couldn't confirm a live face. Look at the camera, blink, and try again.";
            case "FAIL_NO_FACE" -> "We can't see a face. Keep your face inside the guide and try again.";
            case "FAIL_MULTIPLE_FACES" -> "More than one face is in the picture. Make sure only you are in the frame.";
            case "FAIL_LOW_QUALITY" -> "The picture wasn't sharp enough. Hold still, in even light, and try again.";
            case "FACE_WORKER_UNAVAILABLE", "FACE_WORKER_BAD_RESPONSE" -> "The face check isn't available right now. Try again in a moment.";
            case "FACE_DISABLED" -> "Face check is turned off for this workspace, so you can't check in from the web. Ask your admin.";
            default -> original.isEmpty() ? "The face check couldn't complete. Please try again." : original;
        };
        HttpStatus status = HttpStatus.resolve(ex.getStatusCode().value());
        return new HrmsException(message, status != null ? status : HttpStatus.FORBIDDEN, code);
    }

    private static UUID tenantOf(Jwt jwt) {
        Object claim = jwt.getClaim("tenant_id");
        if (claim == null) throw new IllegalStateException("JWT missing tenant_id");
        return UUID.fromString(claim.toString());
    }
}
