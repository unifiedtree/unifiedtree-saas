package com.hrms.notiftemplate.enums;

/**
 * Delivery channel for a notification template.
 * Mirrors the VARCHAR(20) values in notiftemplate_mgmt.notification_templates.
 */
public enum NotificationChannel {
    EMAIL,
    SMS,
    PUSH,
    IN_APP
}
