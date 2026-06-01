package com.hrms.notification.mapper;

import com.hrms.notification.dto.NotificationResponse;
import com.hrms.notification.entity.Notification;

public interface NotificationMapper {

    NotificationResponse toResponse(Notification notification);
}

