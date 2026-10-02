package com.unifiedtree.notifications.dto;

import com.unifiedtree.notifications.entity.AppNotification;
import com.unifiedtree.notifications.enums.AppNotificationType;
import com.unifiedtree.notifications.template.NotificationEventCatalog;

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
            Instant createdAt,
            // Redesign BW-05 (additive): the catalog's module for this type ("Leave", "Payroll"…),
            // the label and icon the web bell shows.
            String group) {

        public static NotificationDto from(AppNotification n) {
            return new NotificationDto(
                    n.getId(),
                    n.getType(),
                    n.getTitle(),
                    n.getBody(),
                    n.getData(),
                    n.getReadAt(),
                    n.getCreatedAt(),
                    groupOf(n.getType()));
        }

        /** The catalog's group; "Other" for a type without an entry of its own (the catalog's fallback). */
        static String groupOf(AppNotificationType type) {
            NotificationEventCatalog.EventDef def = NotificationEventCatalog.forType(type);
            return def == null || def.group() == null ? "Other" : def.group();
        }
    }

    public record UnreadCountDto(long count) {}
}
