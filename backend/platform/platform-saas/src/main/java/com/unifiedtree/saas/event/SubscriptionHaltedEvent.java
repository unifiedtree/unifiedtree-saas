package com.unifiedtree.saas.event;

import java.time.Instant;
import java.util.UUID;

/**
 * Published by {@link com.unifiedtree.saas.payment.subscription.SubscriptionStateReconciler}
 * when a Razorpay subscription transitions INTO HALTED — i.e. Razorpay exhausted
 * its own retries and stopped trying to charge. Fires ONCE per genuine
 * ACTIVE→HALTED (or similar) transition, gated by
 * {@code SubscriptionStateReconciler.onHalted} returning true only when the
 * row's status actually flipped this call. Every downstream sweep or inline
 * re-check finds the row already HALTED and does NOT re-publish, so admins
 * get exactly one email + one in-app notification, not one per hour.
 *
 * <p>Listened to by {@code com.hrms.api.saas.SubscriptionHaltedNotificationService}
 * in {@code hrms-api} (that module has the MailService dependency; platform-saas
 * intentionally does not).
 *
 * @param tenantId        which workspace's subscription halted
 * @param subscriptionId  Razorpay sub_XXX id — for deep-linking / support
 * @param subdomain       tenant subdomain (used in the email body's link)
 * @param graceUntil      when the 7-day access-grace window ends
 */
public record SubscriptionHaltedEvent(
        UUID tenantId,
        String subscriptionId,
        String subdomain,
        Instant graceUntil
) {}
