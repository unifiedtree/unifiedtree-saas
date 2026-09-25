package com.hrms.api.attendance;

import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * Puts the phone or kiosk on a face check-in (V143.25, Face tab "Kiosk" column).
 *
 * <p>The mobile app verifies the face first ({@code POST /v1/attendance/checkin/face},
 * logged in attendance.face_verification_events without a device) and then posts
 * the punch with its {@code deviceId}. When that punch arrives, the most recent
 * passed PUNCH_IN face check by the same login in the last
 * {@value #WINDOW_MINUTES} minutes that has no device yet gets this one. A
 * client that sends {@code deviceFingerprint} on the face check itself already
 * has it stored there, and this leaves it alone.
 *
 * <p>Best effort: a failure is logged and never fails the punch.
 */
@Component
public class FacePunchDevices {

    private static final Logger log = LoggerFactory.getLogger(FacePunchDevices.class);

    /** How far back a face check can be and still belong to this punch. */
    static final int WINDOW_MINUTES = 15;
    /** Column width of attendance.face_verification_events.device_fingerprint. */
    static final int MAX = 120;

    private final JdbcTemplate jdbc;

    public FacePunchDevices(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** The device label to store: trimmed, no control characters, at most {@value #MAX} characters; null when blank. */
    static String label(String deviceId) {
        if (deviceId == null) return null;
        String s = deviceId.replaceAll("\\p{Cntrl}", " ").replaceAll("\\s+", " ").trim();
        if (s.isEmpty()) return null;
        return s.length() > MAX ? s.substring(0, MAX) : s;
    }

    /** Only face punches have a face check to label. */
    static boolean isFaceMethod(String method) {
        return method != null && method.toUpperCase(java.util.Locale.ROOT).contains("FACE");
    }

    @Transactional
    public void link(String loginId, String deviceId, String checkInMethod) {
        String device = label(deviceId);
        if (device == null || !isFaceMethod(checkInMethod) || loginId == null) return;
        try {
            UUID user = UUID.fromString(loginId);
            int n = jdbc.update("""
                    UPDATE attendance.face_verification_events SET device_fingerprint = ?
                     WHERE id = (SELECT id FROM attendance.face_verification_events
                                  WHERE tenant_id = ? AND employee_id = ? AND purpose = 'PUNCH_IN' AND result = 'PASS'
                                    AND device_fingerprint IS NULL
                                    AND created_at >= now() - make_interval(mins => ?)
                                  ORDER BY created_at DESC LIMIT 1)
                    """, device, TenantContext.requireTenantId(), user, WINDOW_MINUTES);
            if (n == 0) log.debug("No recent face check to label with device {} for login {}", device, loginId);
        } catch (RuntimeException ex) {
            log.warn("Could not put the device on the face check for login {}: {}", loginId, ex.getMessage());
        }
    }
}
