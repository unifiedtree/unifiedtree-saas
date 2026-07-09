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
    @Transactional
    public AppNotification create(UUID tenantId,
                                  UUID userId,
                                  AppNotificationType type,
                                  String title,
                                  String body,
                                  Map<String, Object> data) {
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
}
