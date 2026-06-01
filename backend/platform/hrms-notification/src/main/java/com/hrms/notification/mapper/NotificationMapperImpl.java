package com.hrms.notification.mapper;

import com.hrms.notification.dto.NotificationResponse;
import com.hrms.notification.entity.Notification;
import com.hrms.notification.enums.NotificationChannel;
import com.hrms.notification.enums.NotificationType;
import java.time.Instant;
import java.util.UUID;
import javax.annotation.processing.Generated;
import org.springframework.stereotype.Component;

@Generated(
    value = "org.mapstruct.ap.MappingProcessor",
    date = "2026-05-15T12:47:52+0530",
    comments = "version: 1.6.3, compiler: javac, environment: Java 21.0.11 (Eclipse Adoptium)"
)
@Component
public class NotificationMapperImpl implements NotificationMapper {

    @Override
    public NotificationResponse toResponse(Notification notification) {
        if ( notification == null ) {
            return null;
        }

        UUID id = null;
        NotificationType type = null;
        String title = null;
        String body = null;
        NotificationChannel channel = null;
        boolean read = false;
        Instant readAt = null;
        UUID referenceId = null;
        String referenceType = null;
        String actionUrl = null;
        Instant createdAt = null;

        id = notification.getId();
        type = notification.getType();
        title = notification.getTitle();
        body = notification.getBody();
        channel = notification.getChannel();
        read = notification.isRead();
        readAt = notification.getReadAt();
        referenceId = notification.getReferenceId();
        referenceType = notification.getReferenceType();
        actionUrl = notification.getActionUrl();
        createdAt = notification.getCreatedAt();

        NotificationResponse notificationResponse = new NotificationResponse( id, type, title, body, channel, read, readAt, referenceId, referenceType, actionUrl, createdAt );

        return notificationResponse;
    }
}
