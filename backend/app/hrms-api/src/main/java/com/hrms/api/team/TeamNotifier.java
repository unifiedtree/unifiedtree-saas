package com.hrms.api.team;

import com.hrms.api.approvals.DateText;
import com.unifiedtree.notifications.enums.AppNotificationType;
import com.unifiedtree.notifications.service.NotificationDispatcher;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Sends My team's notifications after the change commits, through the existing
 * pipeline ({@link NotificationDispatcher}: each person's choices, the
 * company's template if any, in the app and on the phone):
 * <ul>
 *   <li>{@code team.message} (TEAM_MESSAGE) to each member a message went to;</li>
 *   <li>{@code people.probation_team_decision} (PROBATION_TEAM_DECISION) to the
 *       employee and to HR when a manager confirms or extends probation.</li>
 * </ul>
 * One failed recipient never stops the others.
 */
@Component
public class TeamNotifier {

    private static final Logger log = LoggerFactory.getLogger(TeamNotifier.class);
    static final String MESSAGE_KEY = "team.message";
    static final String PROBATION_KEY = "people.probation_team_decision";

    private final NotificationDispatcher dispatcher;

    public TeamNotifier(NotificationDispatcher dispatcher) {
        this.dispatcher = dispatcher;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onTeamMessage(TeamMessagePostedEvent e) {
        for (UUID recipient : e.recipients()) {
            try {
                Map<String, String> values = new HashMap<>();
                values.put("senderName", e.senderName());
                values.put("message", e.body());
                values.put("teamName", e.teamLabel() != null ? e.teamLabel() : "your team");
                Map<String, Object> data = new HashMap<>();
                data.put("type", AppNotificationType.TEAM_MESSAGE.name());
                data.put("messageId", e.messageId().toString());
                data.put("route", "/notifications");
                dispatcher.dispatch(e.tenantId(), recipient, MESSAGE_KEY, values, data);
            } catch (Exception ex) {
                log.warn("Failed to send TEAM_MESSAGE {} to {}: {}", e.messageId(), recipient, ex.getMessage());
            }
        }
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onProbationDecision(ProbationTeamDecisionEvent e) {
        String until = e.newEndDate() == null ? "" : DateText.longDay(e.newEndDate());
        String toEmployee = "confirmed".equals(e.decision())
                ? e.decidedBy() + " confirmed your probation."
                : e.decidedBy() + " extended your probation to " + until + ".";
        String toHr = "confirmed".equals(e.decision())
                ? e.decidedBy() + " confirmed " + e.employeeName() + "'s probation."
                : e.decidedBy() + " extended " + e.employeeName() + "'s probation to " + until + ".";
        send(e, e.employeeId(), toEmployee, "/notifications");
        for (UUID hr : e.hrRecipients()) send(e, hr, toHr, "/notifications");
    }

    private void send(ProbationTeamDecisionEvent e, UUID recipient, String message, String route) {
        try {
            Map<String, String> values = new HashMap<>();
            values.put("decision", e.decision());
            values.put("message", message);
            values.put("employeeName", e.employeeName());
            values.put("decidedBy", e.decidedBy());
            values.put("newEndDate", e.newEndDate() == null ? "" : DateText.longDay(e.newEndDate()));
            Map<String, Object> data = new HashMap<>();
            data.put("type", AppNotificationType.PROBATION_TEAM_DECISION.name());
            data.put("employeeId", e.employeeId().toString());
            data.put("route", route);
            dispatcher.dispatch(e.tenantId(), recipient, PROBATION_KEY, values, data);
        } catch (Exception ex) {
            log.warn("Failed to send PROBATION_TEAM_DECISION for {} to {}: {}", e.employeeId(), recipient, ex.getMessage());
        }
    }
}
