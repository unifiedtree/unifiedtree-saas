package com.hrms.api.letters;

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
 * Sends {@code letters.signature_requested} (LETTER_SIGNATURE_REQUESTED) to the
 * employee once a letter that asks for their signature has been sent, through
 * the existing pipeline ({@link NotificationDispatcher}: the person's choices,
 * the company's template if any, in the app and on the phone). A failure is
 * logged and never undoes the send.
 */
@Component
public class LetterSignatureNotifier {

    private static final Logger log = LoggerFactory.getLogger(LetterSignatureNotifier.class);
    static final String EVENT_KEY = "letters.signature_requested";
    /** Where the notification opens: the employee's own letters. */
    static final String ROUTE = "/hrms/letters/my";

    private final NotificationDispatcher dispatcher;

    public LetterSignatureNotifier(NotificationDispatcher dispatcher) {
        this.dispatcher = dispatcher;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onRequested(LetterSignatureRequestedEvent e) {
        try {
            Map<String, Object> data = new HashMap<>();
            data.put("type", AppNotificationType.LETTER_SIGNATURE_REQUESTED.name());
            data.put("letterId", e.letterId().toString());
            data.put("route", ROUTE);
            dispatcher.dispatch(e.tenantId(), e.employeeId(), EVENT_KEY, values(e), data);
        } catch (Exception ex) {
            log.warn("Failed to send LETTER_SIGNATURE_REQUESTED {} to {}: {}", e.letterId(), e.employeeId(), ex.getMessage());
        }
    }

    /** The catalog's placeholders: letterSubject, requestedBy. */
    static Map<String, String> values(LetterSignatureRequestedEvent e) {
        Map<String, String> values = new HashMap<>();
        values.put("letterSubject", e.letterSubject() == null ? "letter" : e.letterSubject());
        values.put("requestedBy", e.requestedBy() == null ? "HR" : e.requestedBy());
        return values;
    }
}
