package com.hrms.api.leave;

import com.unifiedtree.notifications.enums.AppNotificationType;
import com.unifiedtree.notifications.service.NotificationDispatcher;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Tells an employee that someone applied for leave in their name
 * ({@code leave.applied_on_behalf}, HRMS redesign BW-43). Their usual approver
 * is told by the normal "leave request" notification, as for any request.
 *
 * <p>Called after the request is saved and committed, never inside its
 * transaction, and it never fails the request: the dispatcher applies the
 * employee's notification choices and the company's wording (built-in wording:
 * NotificationEventCatalog).
 */
@Component
public class LeaveOnBehalfNotifier {

    private static final Logger log = LoggerFactory.getLogger(LeaveOnBehalfNotifier.class);
    /** The same date style as the other leave notifications (DomainEventListener). */
    private static final DateTimeFormatter DATE_FMT = DateTimeFormatter.ofPattern("d MMM yyyy");
    /** Where the mobile app shows the employee's own requests (DomainEventListener ROUTE_LEAVE_HISTORY). */
    static final String ROUTE_LEAVE_HISTORY = "/leave-history";
    static final String EVENT = "leave.applied_on_behalf";

    private final NotificationDispatcher dispatcher;

    public LeaveOnBehalfNotifier(NotificationDispatcher dispatcher) {
        this.dispatcher = dispatcher;
    }

    public void tellEmployee(UUID tenantId, UUID employeeId, UUID leaveRequestId, String raisedByName,
                             String leaveTypeName, LocalDate startDate, LocalDate endDate) {
        try {
            Map<String, Object> data = new HashMap<>();
            data.put("type", AppNotificationType.LEAVE_APPLIED_ON_BEHALF.name());
            if (leaveRequestId != null) data.put("leaveRequestId", leaveRequestId.toString());
            data.put("route", ROUTE_LEAVE_HISTORY);
            dispatcher.dispatch(tenantId, employeeId, EVENT, values(raisedByName, leaveTypeName, startDate, endDate), data);
        } catch (Exception e) {
            log.warn("Couldn't tell employee {} about leave {} applied for them: {}", employeeId, leaveRequestId, e.getMessage());
        }
    }

    static Map<String, String> values(String raisedByName, String leaveTypeName, LocalDate startDate, LocalDate endDate) {
        Map<String, String> v = new LinkedHashMap<>();
        v.put("raisedBy", raisedByName == null || raisedByName.isBlank() ? "HR" : raisedByName.trim());
        v.put("leaveType", leaveTypeName == null || leaveTypeName.isBlank() ? "leave" : leaveTypeName);
        v.put("startDate", startDate == null ? "" : startDate.format(DATE_FMT));
        v.put("endDate", endDate == null ? "" : endDate.format(DATE_FMT));
        return v;
    }
}
