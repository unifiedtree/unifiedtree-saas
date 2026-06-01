package com.hrms.notification.service;

import com.hrms.core.dto.PageResponse;
import com.hrms.notification.dto.NotificationResponse;
import com.hrms.notification.dto.UnreadCountResponse;
import com.hrms.notification.mapper.NotificationMapper;
import com.hrms.notification.repository.NotificationRepository;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
public class NotificationService {

    private final NotificationRepository notificationRepository;
    private final NotificationMapper notificationMapper;

    public NotificationService(NotificationRepository notificationRepository,
                               NotificationMapper notificationMapper) {
        this.notificationRepository = notificationRepository;
        this.notificationMapper = notificationMapper;
    }

    @Transactional(readOnly = true)
    public PageResponse<NotificationResponse> getMyNotifications(UUID recipientId, Pageable pageable) {
        return PageResponse.from(
                notificationRepository.findByRecipientIdOrderByCreatedAtDesc(recipientId, pageable),
                notificationMapper::toResponse);
    }

    @Transactional(readOnly = true)
    public UnreadCountResponse getUnreadCount(UUID recipientId) {
        return new UnreadCountResponse(notificationRepository.countByRecipientIdAndReadFalse(recipientId));
    }

    @Transactional
    public void markAllRead(UUID recipientId) {
        notificationRepository.markAllReadForUser(recipientId);
    }
}
