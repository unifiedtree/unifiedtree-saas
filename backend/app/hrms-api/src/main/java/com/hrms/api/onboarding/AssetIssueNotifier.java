package com.hrms.api.onboarding;

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
 * Sends {@code assets.issue_reported} (ASSET_ISSUE_REPORTED) to the people who
 * manage assets once a problem report has committed, through the existing
 * pipeline ({@link NotificationDispatcher}: each person's choices, the
 * company's template if any, in the app and on the phone). One failed
 * recipient never stops the others, and a failure never undoes the report.
 */
@Component
public class AssetIssueNotifier {

    private static final Logger log = LoggerFactory.getLogger(AssetIssueNotifier.class);
    static final String EVENT_KEY = "assets.issue_reported";
    /** Where the notification opens: HR's asset list. */
    static final String ROUTE = "/hrms/onboarding/instances?view=assets";

    private final NotificationDispatcher dispatcher;

    public AssetIssueNotifier(NotificationDispatcher dispatcher) {
        this.dispatcher = dispatcher;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onReported(AssetIssueReportedEvent e) {
        Map<String, String> values = values(e);
        for (UUID recipient : e.recipients()) {
            try {
                Map<String, Object> data = new HashMap<>();
                data.put("type", AppNotificationType.ASSET_ISSUE_REPORTED.name());
                data.put("issueId", e.issueId().toString());
                data.put("assetId", e.assetId().toString());
                data.put("route", ROUTE);
                dispatcher.dispatch(e.tenantId(), recipient, EVENT_KEY, values, data);
            } catch (Exception ex) {
                log.warn("Failed to send ASSET_ISSUE_REPORTED {} to {}: {}", e.issueId(), recipient, ex.getMessage());
            }
        }
    }

    /** The catalog's placeholders: employeeName, assetName, problem, note, noteText. */
    static Map<String, String> values(AssetIssueReportedEvent e) {
        Map<String, String> values = new HashMap<>();
        values.put("employeeName", e.employeeName());
        values.put("assetName", e.assetLabel());
        values.put("problem", AssetCareService.describe(e.kind()));
        values.put("note", e.note() == null ? "" : e.note());
        values.put("noteText", e.note() == null ? "" : " Note: " + e.note());
        return values;
    }
}
