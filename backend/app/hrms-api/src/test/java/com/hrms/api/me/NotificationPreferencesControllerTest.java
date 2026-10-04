package com.hrms.api.me;

import com.hrms.api.me.NotificationPreferencesController.EventChoice;
import com.hrms.api.me.NotificationPreferencesController.PreferencesView;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Billing events reach only owners and super admins, so only they are offered them as choices. */
class NotificationPreferencesControllerTest {

    private static final List<String> BILLING = List.of("billing.payment_failed", "billing.seat_limit",
            "billing.trial_ending", "billing.trial_ended");

    @Test
    void managerAndEmployeeAreNotOfferedBillingEvents() {
        PreferencesView v = NotificationPreferencesController.view(Map.of(), false);
        List<String> keys = v.events().stream().map(EventChoice::key).toList();
        for (String k : BILLING) assertFalse(keys.contains(k), k + " offered to someone it never reaches");
        assertTrue(v.events().stream().noneMatch(e -> "Billing".equals(e.group())));
        // Everything else is still there, the punch-in alert among it.
        assertTrue(keys.contains("attendance.punch_in_alert"));
        assertTrue(keys.contains("leave.approved"));
    }

    @Test
    void ownersAndSuperAdminsStillSeeBillingEvents() {
        List<String> keys = NotificationPreferencesController.view(Map.of(), true).events().stream()
                .map(EventChoice::key).toList();
        assertTrue(keys.containsAll(BILLING));
    }

    @Test
    void workspaceAdminIsReadFromTheTokenRoles() {
        assertTrue(NotificationPreferencesController.workspaceAdmin(jwt(List.of("OWNER", "SUPER_ADMIN"))));
        assertTrue(NotificationPreferencesController.workspaceAdmin(jwt(List.of("SUPER_ADMIN"))));
        assertFalse(NotificationPreferencesController.workspaceAdmin(jwt(List.of("DEPT_MANAGER", "EMPLOYEE"))));
        assertFalse(NotificationPreferencesController.workspaceAdmin(jwt(List.of("ADMIN"))));
        assertFalse(NotificationPreferencesController.workspaceAdmin(jwt(null)));
        assertFalse(NotificationPreferencesController.workspaceAdmin(null));
    }

    private static Jwt jwt(List<String> roles) {
        Jwt.Builder b = Jwt.withTokenValue("t").header("alg", "none").subject("u")
                .issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(60));
        if (roles != null) b.claim("roles", roles);
        return b.build();
    }
}
