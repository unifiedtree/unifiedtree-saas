package com.unifiedtree.notifications.dto;

import com.unifiedtree.notifications.entity.AppNotification;
import com.unifiedtree.notifications.enums.AppNotificationType;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * Response DTOs for the notifications API. Kept lean — the mobile app only
 * needs identifiers and rendering fields; server-side audit columns
 * (createdBy, version) stay in the entity.
 */
public final class NotificationDtos {

    private NotificationDtos() {}

    public record NotificationDto(
            UUID id,
            AppNotificationType type,
            String title,
            String body,
            Map<String, Object> data,
            Instant readAt,
            Instant createdAt) {

        public static NotificationDto from(AppNotification n) {
            return new NotificationDto(
                    n.getId(),
                    n.getType(),
                    n.getTitle(),
                    n.getBody(),
                    n.getData(),
                    n.getReadAt(),
                    n.getCreatedAt());
        }
    }

    public record UnreadCountDto(long count) {}
}
