package com.unifiedtree.notifications.controller;

import com.hrms.core.dto.PageResponse;
import com.unifiedtree.notifications.dto.NotificationDtos.NotificationDto;
import com.unifiedtree.notifications.dto.NotificationDtos.UnreadCountDto;
import com.unifiedtree.notifications.dto.RegisterDeviceRequest;
import com.unifiedtree.notifications.service.AppNotificationService;
import jakarta.validation.Valid;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * In-app notifications REST surface.
 *
 * <p>Every endpoint is behind {@code isAuthenticated()} and resolves the acting
 * user from the JWT — the {@code employee_id} claim (falling back to
 * {@code sub}) is the row-owner. There is no admin bypass and no
 * cross-user read path.
 */
@RestController
@RequestMapping("/v1/notifications")
public class NotificationsController {

    private final AppNotificationService service;

    public NotificationsController(AppNotificationService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<PageResponse<NotificationDto>> list(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(name = "unreadOnly", defaultValue = "false") boolean unreadOnly,
            @PageableDefault(size = 20) Pageable pageable) {
        return ResponseEntity.ok(service.list(extractUserId(jwt), unreadOnly, pageable));
    }

    @GetMapping("/unread-count")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<UnreadCountDto> unreadCount(@AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(new UnreadCountDto(service.unreadCount(extractUserId(jwt))));
    }

    @PutMapping("/{id}/read")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<Void> markRead(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        service.markRead(extractUserId(jwt), id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/mark-all-read")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<Void> markAllRead(@AuthenticationPrincipal Jwt jwt) {
        service.markAllRead(extractUserId(jwt));
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<Void> delete(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        service.deleteOne(extractUserId(jwt), id);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/read")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<Void> deleteAllRead(@AuthenticationPrincipal Jwt jwt) {
        service.deleteAllRead(extractUserId(jwt));
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/register-device")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<Void> registerDevice(@AuthenticationPrincipal Jwt jwt,
                                               @Valid @RequestBody RegisterDeviceRequest req) {
        service.registerDevice(extractTenantId(jwt), extractUserId(jwt), req);
        return ResponseEntity.noContent().build();
    }

    /**
     * Sign-out hook: stops push to this handset for the current user.
     *
     * <p>Called by the mobile app immediately BEFORE it drops its tokens, while
     * the access token is still valid. Idempotent, and a no-op for a token that
     * was never registered — the app must never block sign-out on this.
     */
    @PostMapping("/unregister-device")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<Void> unregisterDevice(@AuthenticationPrincipal Jwt jwt,
                                                 @Valid @RequestBody UnregisterDeviceRequest req) {
        service.unregisterDevice(extractUserId(jwt), req.expoPushToken());
        return ResponseEntity.noContent().build();
    }

    /** Body of {@link #unregisterDevice}. */
    public record UnregisterDeviceRequest(@jakarta.validation.constraints.NotBlank String expoPushToken) {}

    private UUID extractUserId(Jwt jwt) {
        String empId = jwt.getClaimAsString("employee_id");
        return empId != null ? UUID.fromString(empId) : UUID.fromString(jwt.getSubject());
    }

    private UUID extractTenantId(Jwt jwt) {
        String tid = jwt.getClaimAsString("tenant_id");
        if (tid == null) {
            throw new IllegalStateException("JWT missing tenant_id claim");
        }
        return UUID.fromString(tid);
    }
}
