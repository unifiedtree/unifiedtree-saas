package com.hrms.api.approvals;

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
 * Tells the employee that a decision on their request was taken back
 * ({@code approvals.decision_undone}, type DECISION_UNDONE), through the
 * existing pipeline: their notification choices, the company's template if it
 * has one, in the app and on the phone.
 *
 * <p>AFTER_COMMIT, so nothing is sent for an Undo that rolled back.
 * {@link NotificationDispatcher} opens its own short transactions with the
 * tenant set, which is what an after-commit listener needs.
 */
@Component
public class ApprovalNotifier {

    private static final Logger log = LoggerFactory.getLogger(ApprovalNotifier.class);
    static final String EVENT_KEY = "approvals.decision_undone";

    private final NotificationDispatcher dispatcher;

    public ApprovalNotifier(NotificationDispatcher dispatcher) {
        this.dispatcher = dispatcher;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onDecisionUndone(DecisionUndoneEvent e) {
        try {
            Map<String, String> values = new HashMap<>();
            values.put("decidedBy", e.decidedBy());
            values.put("requestText", e.requestText());
            values.put("requestType", e.kind().requestType());
            values.put("previousDecision", e.previousDecision());
            Map<String, Object> data = new HashMap<>();
            data.put("type", AppNotificationType.DECISION_UNDONE.name());
            data.put("kind", e.kind().name());
            data.put("requestId", e.requestId().toString());
            data.put("route", e.kind().mobileRoute());
            dispatcher.dispatch(e.tenantId(), e.employeeId(), EVENT_KEY, values, data);
        } catch (Exception ex) {
            log.warn("Failed to send DECISION_UNDONE for {} {}: {}", e.kind(), e.requestId(), ex.getMessage());
        }
    }
}
