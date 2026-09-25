package com.unifiedtree.notifications.template;

/**
 * How a notification reaches a person.
 *
 * <p>The names match {@code notiftemplate_mgmt.notification_templates.channel}
 * (EMAIL / PUSH / IN_APP), so a template row's channel can be compared with
 * {@link #name()} directly. SMS is a valid template channel in that table but
 * nothing sends SMS notifications, so it is deliberately not listed here.
 */
public enum DeliveryChannel {
    /** The bell in the web app and the Alerts tab in the mobile app. */
    IN_APP,
    /** A push notification on the phone (mobile app). */
    PUSH,
    /** An email to the address the person signs in with. */
    EMAIL
}
