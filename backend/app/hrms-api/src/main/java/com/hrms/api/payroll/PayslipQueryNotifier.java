package com.hrms.api.payroll;

import com.unifiedtree.notifications.enums.AppNotificationType;
import com.unifiedtree.notifications.service.NotificationDispatcher;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The two "Ask payroll" notifications (catalog keys payroll.payslip_query_raised
 * and payroll.payslip_query_answered), sent through the dispatcher so each
 * person's in-app / push / email choices and the company's templates apply.
 *
 * <p>Neither ever carries the question or the answer: push notifications show on
 * lock screens. The placeholders are only who and which month, and the payload
 * only ids and where to open. They go out once the question or answer is
 * committed; a failure is logged and never undoes it.
 */
@Component
public class PayslipQueryNotifier {

    private static final Logger log = LoggerFactory.getLogger(PayslipQueryNotifier.class);

    static final String RAISED = "payroll.payslip_query_raised";
    static final String ANSWERED = "payroll.payslip_query_answered";

    private final NotificationDispatcher dispatcher;

    public PayslipQueryNotifier(NotificationDispatcher dispatcher) {
        this.dispatcher = dispatcher;
    }

    /** Tells the payroll team a question is waiting. */
    public void raised(UUID tenantId, List<UUID> payrollTeam, String employeeName, String period,
                       UUID queryId, UUID runId) {
        if (payrollTeam == null || payrollTeam.isEmpty()) return;
        Map<String, String> values = Map.of(
                "employeeName", employeeName == null ? "An employee" : employeeName,
                "period", period == null ? "" : period);
        Map<String, Object> data = data(AppNotificationType.PAYSLIP_QUERY_RAISED, "/hrms/payroll-dashboard", queryId, runId);
        afterCommit(() -> {
            for (UUID to : payrollTeam) send(tenantId, to, RAISED, values, data, queryId);
        });
    }

    /** Tells the employee their question was answered (the answer itself stays with the payslip). */
    public void answered(UUID tenantId, UUID employeeId, String answeredBy, String period, UUID queryId, UUID runId) {
        if (employeeId == null) return;
        Map<String, String> values = Map.of(
                "answeredBy", answeredBy == null ? "The payroll team" : answeredBy,
                "period", period == null ? "" : period);
        Map<String, Object> data = data(AppNotificationType.PAYSLIP_QUERY_ANSWERED, "/me/payslips", queryId, runId);
        afterCommit(() -> send(tenantId, employeeId, ANSWERED, values, data, queryId));
    }

    private void send(UUID tenantId, UUID to, String key, Map<String, String> values, Map<String, Object> data, UUID queryId) {
        try {
            dispatcher.dispatch(tenantId, to, key, values, data);
        } catch (Exception e) {
            log.warn("Notification {} for payslip question {} to {} failed: {}", key, queryId, to, e.getMessage());
        }
    }

    static Map<String, Object> data(AppNotificationType type, String route, UUID queryId, UUID runId) {
        Map<String, Object> data = new HashMap<>();
        data.put("type", type.name());
        data.put("route", route);
        data.put("queryId", queryId == null ? null : queryId.toString());
        data.put("runId", runId == null ? null : runId.toString());
        return data;
    }

    /** After the surrounding transaction commits; at once when there is none. */
    private static void afterCommit(Runnable work) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    work.run();
                }
            });
        } else {
            work.run();
        }
    }
}
