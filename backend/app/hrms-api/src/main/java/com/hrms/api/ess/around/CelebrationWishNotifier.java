package com.hrms.api.ess.around;

import com.unifiedtree.notifications.enums.AppNotificationType;
import com.unifiedtree.notifications.service.NotificationDispatcher;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.HashMap;
import java.util.Map;

/**
 * Tells the person a colleague wished them ({@code people.celebration_wish},
 * CELEBRATION_WISH), after the wish commits, through the existing pipeline
 * ({@link NotificationDispatcher}: their notification choices, the company's
 * template if any, in the app and on the phone). Tapping it opens Celebrations:
 * {@code data.route} is the app's screen; the website opens /me/celebrations for
 * this type. A failure is logged, never thrown: the wish is already saved.
 */
@Component
public class CelebrationWishNotifier {

    private static final Logger log = LoggerFactory.getLogger(CelebrationWishNotifier.class);
    static final String KEY = "people.celebration_wish";
    /** The app's Celebrations screen (the 09:00 birthday push opens it too). */
    static final String ROUTE = "/milestones";

    private final NotificationDispatcher dispatcher;

    public CelebrationWishNotifier(NotificationDispatcher dispatcher) {
        this.dispatcher = dispatcher;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onWish(CelebrationWishSentEvent e) {
        try {
            Map<String, String> values = new HashMap<>();
            values.put("senderName", e.senderName());
            values.put("occasionText", e.occasion().sentence);
            values.put("occasion", e.occasion().words);
            values.put("message", e.message());
            Map<String, Object> data = new HashMap<>();
            data.put("type", AppNotificationType.CELEBRATION_WISH.name());
            data.put("wishId", e.wishId().toString());
            data.put("fromEmployeeId", e.fromEmployeeId().toString());
            data.put("occasion", e.occasion().name());
            data.put("route", ROUTE);
            dispatcher.dispatch(e.tenantId(), e.toEmployeeId(), KEY, values, data);
        } catch (Exception ex) {
            log.warn("Failed to send CELEBRATION_WISH {} to {}: {}", e.wishId(), e.toEmployeeId(), ex.getMessage());
        }
    }
}
