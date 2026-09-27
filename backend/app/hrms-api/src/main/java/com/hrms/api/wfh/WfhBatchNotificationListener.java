package com.hrms.api.wfh;

import com.hrms.leave.service.WfhService;
import com.unifiedtree.notifications.enums.AppNotificationType;
import com.unifiedtree.notifications.service.NotificationDispatcher;
import com.unifiedtree.notifications.service.NotificationLookupService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The approver's one notification for a batch of work-from-home days (BW-35).
 *
 * <p>It is the usual "wfh.submitted" message ("{employeeName} requested to work
 * from home {dates}."), so the wording, the company's own template, the
 * approver's notification choices and the deep link are the same as for a
 * single request; only {@code dates} lists every day ("on 3 days: 30 Sep 2026,
 * 1 Oct 2026 and 5 Oct 2026"). A batch that is one run of days is announced by
 * {@code DomainEventListener} exactly like a single request.
 *
 * <p>AFTER_COMMIT and synchronous, like {@code DomainEventListener}: nothing is
 * sent for a batch that rolled back, and the reads go through
 * {@link NotificationLookupService}, which opens its own tenant-scoped
 * connection. A failure here is logged and never reaches the person sending.
 */
@Component
public class WfhBatchNotificationListener {

    private static final Logger log = LoggerFactory.getLogger(WfhBatchNotificationListener.class);
    /** The approvals inbox in the mobile app, as for a single request. */
    private static final String ROUTE_APPROVALS = "/requests-tab";

    private final NotificationDispatcher dispatcher;
    private final NotificationLookupService lookup;

    public WfhBatchNotificationListener(NotificationDispatcher dispatcher, NotificationLookupService lookup) {
        this.dispatcher = dispatcher;
        this.lookup = lookup;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onBatchSubmitted(WfhService.BatchSubmitted e) {
        try {
            if (e.approverId() == null || e.requestIds() == null || e.requestIds().isEmpty()) {
                log.warn("WFH batch without an approver or requests; nothing to notify (employee={})", e.employeeId());
                return;
            }
            String name = lookup.employeeName(e.employeeId(), e.tenantId());
            Map<String, Object> data = new HashMap<>();
            data.put("type", AppNotificationType.WFH_SUBMITTED.name());
            // The first request, so a decision on it marks this alert read (as for a single request);
            // every request of the batch is listed as well.
            data.put("wfhRequestId", e.requestIds().get(0).toString());
            data.put("wfhRequestIds", e.requestIds().stream().map(Object::toString).toList());
            data.put("route", ROUTE_APPROVALS);
            Map<String, String> values = new LinkedHashMap<>();
            values.put("employeeName", name == null || name.isBlank() ? "An employee" : name);
            values.put("dates", dates(e.runs()));
            dispatcher.dispatch(e.tenantId(), e.approverId(), "wfh.submitted", values, data);
        } catch (Exception ex) {
            log.warn("Failed to send the WFH batch notification for employee {}: {}", e.employeeId(), ex.getMessage());
        }
    }

    /** "on 3 days: 30 Sep 2026, 1 Oct 2026 and 5 Oct 2026"; a run of days reads "30 Sep 2026 to 2 Oct 2026". */
    static String dates(List<LocalDate[]> runs) {
        long days = 0;
        List<String> parts = new ArrayList<>();
        for (LocalDate[] run : runs) {
            days += java.time.temporal.ChronoUnit.DAYS.between(run[0], run[1]) + 1;
            parts.add(WfhService.describe(run));
        }
        String list = parts.size() == 1 ? parts.get(0)
                : String.join(", ", parts.subList(0, parts.size() - 1)) + " and " + parts.get(parts.size() - 1);
        return "on " + days + (days == 1 ? " day: " : " days: ") + list;
    }
}
