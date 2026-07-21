package com.unifiedtree.notifications.job;

import com.unifiedtree.notifications.service.AppNotificationService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Nightly sweeper that keeps {@code notif.notifications} bounded.
 *
 * <p>Defaults:
 * <ul>
 *   <li>Read notifications older than 30 days → deleted (user already saw them)</li>
 *   <li>Unread notifications older than 90 days → deleted (stale, likely irrelevant)</li>
 * </ul>
 *
 * <p>Runs at 03:15 UTC every day (low-traffic window). Retention windows are
 * env-configurable in case a tenant wants longer history. Delete count is
 * logged so ops can track table growth.
 */
@Component
public class NotificationCleanupJob {

    private static final Logger log = LoggerFactory.getLogger(NotificationCleanupJob.class);

    private final AppNotificationService service;
    private final long readRetentionDays;
    private final long unreadRetentionDays;

    public NotificationCleanupJob(
            AppNotificationService service,
            @Value("${unifiedtree.notifications.retention.read-days:30}") long readRetentionDays,
            @Value("${unifiedtree.notifications.retention.unread-days:90}") long unreadRetentionDays) {
        this.service = service;
        this.readRetentionDays = readRetentionDays;
        this.unreadRetentionDays = unreadRetentionDays;
    }

    /** Daily at 03:15 UTC. */
    @Scheduled(cron = "0 15 3 * * *", zone = "UTC")
    public void sweep() {
        try {
            int deleted = service.cleanupOldNotifications(readRetentionDays, unreadRetentionDays);
            if (deleted > 0) {
                log.info("Notification cleanup sweep: {} rows deleted", deleted);
            }
        } catch (Exception e) {
            log.warn("Notification cleanup sweep failed: {}", e.getMessage());
        }
    }
}
