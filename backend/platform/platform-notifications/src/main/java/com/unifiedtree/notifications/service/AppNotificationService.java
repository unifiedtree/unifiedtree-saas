package com.unifiedtree.notifications.service;

import com.hrms.core.dto.PageResponse;
import com.hrms.core.exception.ResourceNotFoundException;
import com.unifiedtree.notifications.dto.NotificationDtos.NotificationDto;
import com.unifiedtree.notifications.dto.RegisterDeviceRequest;
import com.unifiedtree.notifications.entity.AppNotification;
import com.unifiedtree.notifications.entity.DeviceToken;
import com.unifiedtree.notifications.enums.AppNotificationType;
import com.unifiedtree.notifications.repository.AppNotificationRepository;
import com.unifiedtree.notifications.repository.DeviceTokenRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Central entry point for producing and reading notifications.
 *
 * <p>Producers (LeaveService, FaceService, future WFH service) call
 * {@link #create} inside their own transaction. The in-app row is persisted
 * synchronously (RLS enforces tenant isolation on the write); the Expo push
 * is deferred until AFTER_COMMIT and dispatched on a bounded executor so a
 * slow Expo endpoint cannot block or fail the producer's HTTP request.
 *
 * <p>Read paths always filter by {@code userId} extracted from the JWT — this
 * is the source of user-scope enforcement (no {@code current_user_id()} GUC
 * exists in this codebase).
 */
@Service
public class AppNotificationService {

    private static final Logger log = LoggerFactory.getLogger(AppNotificationService.class);

    private final AppNotificationRepository repo;
    private final DeviceTokenRepository tokenRepo;
    private final ExpoPushSender push;

    public AppNotificationService(AppNotificationRepository repo,
                                  DeviceTokenRepository tokenRepo,
                                  ExpoPushSender push) {
        this.repo = repo;
        this.tokenRepo = tokenRepo;
        this.push = push;
    }

    /**
     * Persist an in-app notification and schedule the Expo push for after the
     * current DB transaction commits.
     *
     * <p>Callers pass tenantId/userId explicitly rather than reading from
     * {@code TenantContext} because the emitting service may not know whether
     * the current thread has a tenant bound (e.g. reactive contexts, tests).
     * Explicit is safer.
     */
    /**
     * REQUIRES_NEW: this is invoked from {@code DomainEventListener}'s
     * {@code AFTER_COMMIT} handlers. Spring's default {@code REQUIRED} joins the
     * just-committed outer transaction that's still bound to the thread — the
     * entity gets attached to a persistence context that's about to be cleaned
     * up WITHOUT flushing. {@code repo.save()} returns an ID but the row never
     * lands in the DB (silent-fail). REQUIRES_NEW forces a fresh JDBC + JPA tx
     * so the insert actually commits.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public AppNotification create(UUID tenantId,
                                  UUID userId,
                                  AppNotificationType type,
                                  String title,
                                  String body,
                                  Map<String, Object> data) {
        log.info("AppNotificationService.create ENTER tenant={} user={} type={}", tenantId, userId, type);
        if (tenantId == null || userId == null || type == null || title == null) {
            log.warn("skipping notification with missing required field (tenant={} user={} type={})",
                    tenantId, userId, type);
            return null;
        }
        AppNotification n = new AppNotification();
        n.setTenantId(tenantId);
        n.setUserId(userId);
        n.setType(type);
        n.setTitle(title);
        n.setBody(body);
        n.setData(data == null ? new HashMap<>() : new HashMap<>(data));
        AppNotification saved = repo.save(n);
        log.info("AppNotificationService.create SAVED id={} user={} type={}", saved.getId(), userId, type);

        // Fire the push AFTER the current tx commits so a rollback in the
        // caller (e.g. leave-apply fails validation post-save) cannot leave
        // a phantom push behind.
        push.sendAfterCommit(userId, title, body, saved.getData());
        return saved;
    }

    @Transactional(readOnly = true)
    public PageResponse<NotificationDto> list(UUID userId, boolean unreadOnly, Pageable pageable) {
        Page<AppNotification> page = unreadOnly
                ? repo.findByUserIdAndReadAtIsNullOrderByCreatedAtDesc(userId, pageable)
                : repo.findByUserIdOrderByCreatedAtDesc(userId, pageable);
        return PageResponse.from(page, NotificationDto::from);
    }

    @Transactional(readOnly = true)
    public long unreadCount(UUID userId) {
        return repo.countByUserIdAndReadAtIsNull(userId);
    }

    @Transactional
    public void markRead(UUID userId, UUID id) {
        AppNotification n = repo.findByIdAndUserId(id, userId)
                .orElseThrow(() -> new ResourceNotFoundException("Notification", id));
        if (n.getReadAt() == null) {
            n.setReadAt(Instant.now());
            repo.save(n);
        }
    }

    @Transactional
    public int markAllRead(UUID userId) {
        return repo.markAllRead(userId);
    }

    /** User deletes a single notification (their own — enforced by user_id predicate). */
    @Transactional
    public void deleteOne(UUID userId, UUID notificationId) {
        AppNotification n = repo.findByIdAndUserId(notificationId, userId)
                .orElseThrow(() -> new ResourceNotFoundException("Notification", notificationId));
        repo.delete(n);
    }

    /** "Clear all read" — one-tap cleanup that removes every read row for the user. */
    @Transactional
    public int deleteAllRead(UUID userId) {
        return repo.deleteAllReadForUser(userId);
    }

    /**
     * Mark as read every unread notification tied to the given request id
     * (leave/WFH/correction/shift-change). Called from the domain listener
     * right after a decision fires — so the approver's "New leave request"
     * alert clears itself the moment they act, even if they never opened the
     * Alerts tab. Best-effort: failure is logged and swallowed, never blocks
     * the primary decision path.
     */
    @Transactional
    public int markReadByRequestId(String requestId) {
        if (requestId == null || requestId.isBlank()) return 0;
        List<AppNotification> rows = repo.findUnreadByRequestId(requestId);
        if (rows.isEmpty()) return 0;
        Instant now = Instant.now();
        for (AppNotification n : rows) {
            n.setReadAt(now);
        }
        repo.saveAll(rows);
        return rows.size();
    }

    /**
     * Sweep old notification rows so the table never balloons. Called by the
     * nightly {@code NotificationCleanupJob}. Read rows older than {@code readRetentionDays}
     * and unread rows older than {@code unreadRetentionDays} are deleted.
     */
    @Transactional
    public int cleanupOldNotifications(long readRetentionDays, long unreadRetentionDays) {
        Instant readCutoff = Instant.now().minus(java.time.Duration.ofDays(readRetentionDays));
        Instant unreadCutoff = Instant.now().minus(java.time.Duration.ofDays(unreadRetentionDays));
        int deleted = repo.deleteStale(readCutoff, unreadCutoff);
        log.info("Notification cleanup: deleted {} rows (read>{}d OR unread>{}d)",
                deleted, readRetentionDays, unreadRetentionDays);
        return deleted;
    }

    /**
     * Register (or update) an Expo push token for {@code userId}.
     *
     * <p>Also deactivates any row for the same token owned by a DIFFERENT
     * user — device hand-off case (a second user logs in on the same phone).
     * Without this, both users would receive each other's push.
     */
    @Transactional
    public DeviceToken registerDevice(UUID tenantId, UUID userId, RegisterDeviceRequest req) {
        // Device hand-off: deactivate rows for the same token under other users.
        List<DeviceToken> foreign = tokenRepo.findByExpoPushTokenAndUserIdNot(req.expoPushToken(), userId);
        if (!foreign.isEmpty()) {
            for (DeviceToken f : foreign) f.setActive(false);
            tokenRepo.saveAll(foreign);
            log.info("Deactivated {} foreign device_token(s) for hand-off to user={}",
                    foreign.size(), userId);
        }

        // Deactivate every OTHER active token this user still has. If they had
        // an earlier install of the app (or a different Expo project), the old
        // token remains "active" in the DB and gets bundled with the new one
        // in the same Expo push HTTP request — which Expo rejects with a
        // PUSH_TOO_MANY_EXPERIENCE_IDS 400 because the tokens belong to
        // different projects, silently dropping ALL push for that user. This
        // exact bug bit us during the motivaite123 → suryakumar478 account
        // migration on 2026-07-13. Keeping only the latest token per user
        // sidesteps the multi-project mixing entirely. Trade-off: if a user
        // legitimately uses two phones, only the most-recently-registered
        // one receives push. Acceptable for a workforce HR app where each
        // employee has one work phone.
        List<DeviceToken> otherActive = tokenRepo.findByUserIdAndActiveTrue(userId);
        int deactivated = 0;
        for (DeviceToken t : otherActive) {
            if (!t.getExpoPushToken().equals(req.expoPushToken()) && t.isActive()) {
                t.setActive(false);
                deactivated++;
            }
        }
        if (deactivated > 0) {
            tokenRepo.saveAll(otherActive);
            log.info("Deactivated {} stale token(s) for user={} — keeping only the newly registered one",
                    deactivated, userId);
        }

        DeviceToken t = tokenRepo.findByUserIdAndExpoPushToken(userId, req.expoPushToken())
                .orElseGet(DeviceToken::new);
        t.setTenantId(tenantId);
        t.setUserId(userId);
        t.setExpoPushToken(req.expoPushToken());
        t.setPlatform(req.platform());
        t.setDeviceName(req.deviceName());
        t.setAppVersion(req.appVersion());
        t.setActive(true);
        t.setLastUsedAt(Instant.now());
        return tokenRepo.save(t);
    }

    /**
     * Deactivates a device token at sign-out.
     *
     * <p>register-device already hands the token over when a second user logs
     * in on the same phone, but that only closes the leak once the NEXT person
     * signs in. Between "A signs out" and "B signs in" the row is still active,
     * so A's leave approvals and attendance reminders keep landing on a phone
     * A has walked away from. On a shared shop-floor device that window can be
     * days.
     *
     * <p>Deactivate rather than delete: the row carries device name, platform
     * and last-used-at, which is the only record of which handsets a workspace
     * actually uses, and the same token reactivates in place on the next login.
     *
     * <p>Scoped to the caller's own userId — a token string is not a
     * credential, so accepting one without that scope would let anybody
     * silence anybody else's notifications.
     */
    @Transactional
    public void unregisterDevice(UUID userId, String expoPushToken) {
        tokenRepo.findByUserIdAndExpoPushToken(userId, expoPushToken)
                .filter(DeviceToken::isActive)
                .ifPresent(t -> {
                    t.setActive(false);
                    tokenRepo.save(t);
                    log.info("Deactivated device token for user={} on sign-out", userId);
                });
    }
}
