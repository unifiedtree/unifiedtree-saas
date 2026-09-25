package com.hrms.api.me;

import com.hrms.core.exception.HrmsException;
import com.unifiedtree.notifications.prefs.NotificationPreferenceService;
import com.unifiedtree.notifications.prefs.NotificationPreferences;
import com.unifiedtree.notifications.template.DeliveryChannel;
import com.unifiedtree.notifications.template.NotificationEventCatalog;
import com.unifiedtree.notifications.template.NotificationEventCatalog.EventDef;
import com.unifiedtree.security.tenant.TenantContext;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The signed-in person's own notification choices: the email and push master
 * switches (also on the Profile page) and, per event, whether it reaches them
 * in the app, on their phone and by email.
 *
 * <p>Self-service only: the account comes from the session, never from the
 * request, so nobody can read or change another person's choices. That is why
 * {@code isAuthenticated()} is the right gate here (as for
 * {@code /v1/me/delegation} and {@code /v1/users/me}).
 *
 * <p>Always-sent notifications (password reset, invitation, billing, letters HR
 * sends) are listed with {@code essential: true} and can't be switched off.
 * Offers to candidates go to people outside the workspace and aren't listed.
 */
@RestController
@RequestMapping("/v1/me/notification-preferences")
@SecurityRequirement(name = "bearerAuth")
public class NotificationPreferencesController {

    private final NotificationPreferenceService preferences;

    public NotificationPreferencesController(NotificationPreferenceService preferences) {
        this.preferences = preferences;
    }

    /** One event as the person sees it. A channel the event doesn't use is null. */
    public record EventChoice(String key, String group, String label, String audience, String description,
                              List<DeliveryChannel> channels, boolean essential,
                              Boolean inApp, Boolean push, Boolean email) {}

    public record PreferencesView(boolean emailEnabled, boolean pushEnabled, List<EventChoice> events) {}

    /** Partial update: anything left out is kept. {@code events}: key → { inApp | push | email: true/false }. */
    public record UpdateRequest(Boolean emailEnabled, Boolean pushEnabled, Map<String, Map<String, Boolean>> events) {}

    @Operation(summary = "My notification choices, with every event I can receive")
    @GetMapping
    @PreAuthorize("isAuthenticated()")
    public PreferencesView get() {
        UUID[] ids = session();
        return view(load(ids[0], ids[1]));
    }

    @Operation(summary = "Change my notification choices")
    @PutMapping
    @PreAuthorize("isAuthenticated()")
    public PreferencesView update(@RequestBody UpdateRequest req) {
        UUID[] ids = session();
        if (req == null) throw bad("Nothing to change.");
        Map<String, Object> merged;
        try {
            merged = NotificationPreferences.merge(load(ids[0], ids[1]), req.emailEnabled(), req.pushEnabled(), req.events());
        } catch (IllegalArgumentException e) {
            throw bad(e.getMessage());
        }
        try {
            preferences.store(ids[0], ids[1], merged);
        } catch (IllegalStateException e) {
            throw new HrmsException("Your account wasn't found, so nothing was saved.", HttpStatus.NOT_FOUND, "ACCOUNT_NOT_FOUND");
        }
        return view(merged);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private Map<String, Object> load(UUID tenantId, UUID userId) {
        try {
            return preferences.load(tenantId, userId);
        } catch (IllegalStateException e) {
            throw new HrmsException("Your account wasn't found.", HttpStatus.NOT_FOUND, "ACCOUNT_NOT_FOUND");
        }
    }

    static PreferencesView view(Map<String, Object> prefs) {
        List<EventChoice> events = NotificationEventCatalog.all().stream()
                .filter(d -> !d.external())
                .map(d -> new EventChoice(d.key(), d.group(), d.label(), d.audience(), d.description(),
                        List.copyOf(d.channels()), d.essential(),
                        choice(d, prefs, DeliveryChannel.IN_APP),
                        choice(d, prefs, DeliveryChannel.PUSH),
                        choice(d, prefs, DeliveryChannel.EMAIL)))
                .toList();
        return new PreferencesView(
                NotificationPreferences.masterOn(prefs, NotificationPreferences.EMAIL_ENABLED),
                NotificationPreferences.masterOn(prefs, NotificationPreferences.PUSH_ENABLED),
                events);
    }

    private static Boolean choice(EventDef d, Map<String, Object> prefs, DeliveryChannel c) {
        return d.has(c) ? NotificationPreferences.eventChoice(d, prefs, c) : null;
    }

    private static UUID[] session() {
        UUID tenantId = TenantContext.getTenantId();
        UUID userId = TenantContext.getUserId();
        if (tenantId == null || userId == null) {
            throw new HrmsException("Sign in again to change your notification settings.", HttpStatus.UNAUTHORIZED, "NOT_AUTHENTICATED");
        }
        return new UUID[]{tenantId, userId};
    }

    private static HrmsException bad(String message) {
        return new HrmsException(message, HttpStatus.BAD_REQUEST, "INVALID_NOTIFICATION_PREFERENCES");
    }
}
