package com.hrms.notification.service;

import com.hrms.notification.dto.SendNotificationCommand;
import com.hrms.notification.dto.WebSocketPayload;
import com.hrms.notification.entity.Notification;
import com.hrms.notification.repository.NotificationRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;

@Service
public class NotificationDispatcher {

    private static final Logger log = LoggerFactory.getLogger(NotificationDispatcher.class);

    private final NotificationRepository notificationRepository;
    private final SimpMessagingTemplate messagingTemplate;
    private final JavaMailSender mailSender;

    public NotificationDispatcher(NotificationRepository notificationRepository,
                                  SimpMessagingTemplate messagingTemplate,
                                  JavaMailSender mailSender) {
        this.notificationRepository = notificationRepository;
        this.messagingTemplate = messagingTemplate;
        this.mailSender = mailSender;
    }

    @Transactional
    @Async("notificationExecutor")
    public void dispatch(SendNotificationCommand command) {
        Notification notification = new Notification();
        notification.setTenantId(command.tenantId());
        notification.setRecipientId(command.recipientId());
        notification.setType(command.type());
        notification.setTitle(command.title());
        notification.setBody(command.body());
        notification.setChannel(command.channel());
        notification.setReferenceId(command.referenceId());
        notification.setReferenceType(command.referenceType());
        notification.setActionUrl(command.actionUrl());

        try {
            switch (command.channel()) {
                case IN_APP, WEBSOCKET -> {
                    notificationRepository.save(notification);
                    pushWebSocket(command);
                    notification.setSent(true);
                    notification.setSentAt(Instant.now());
                }
                case EMAIL -> {
                    sendEmail(command);
                    notification.setSent(true);
                    notification.setSentAt(Instant.now());
                    notificationRepository.save(notification);
                }
                default -> {
                    log.warn("Channel {} not yet implemented — storing in-app only", command.channel());
                    notificationRepository.save(notification);
                }
            }
        } catch (Exception e) {
            log.error("Failed to dispatch notification to recipient {}: {}", command.recipientId(), e.getMessage());
            notification.setSent(false);
            notificationRepository.save(notification);
        }
    }

    private void pushWebSocket(SendNotificationCommand command) {
        WebSocketPayload payload = new WebSocketPayload(
                null, command.type(), command.title(), command.body(),
                command.referenceId(), Instant.now());
        messagingTemplate.convertAndSendToUser(
                command.recipientId().toString(),
                "/queue/notifications",
                payload);
        log.debug("WebSocket notification pushed to user {}", command.recipientId());
    }

    private void sendEmail(SendNotificationCommand command) {
        SimpleMailMessage message = new SimpleMailMessage();
        message.setTo(command.recipientId().toString()); // In production, resolve to actual email
        message.setSubject(command.title());
        message.setText(command.body());
        mailSender.send(message);
        log.debug("Email sent to {}", command.recipientId());
    }
}
