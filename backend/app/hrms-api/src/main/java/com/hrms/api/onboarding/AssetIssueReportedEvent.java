package com.hrms.api.onboarding;

import java.util.List;
import java.util.UUID;

/**
 * An employee reported a problem with an asset issued to them (V143.59).
 * Published inside the report's transaction; {@link AssetIssueNotifier} sends
 * {@code assets.issue_reported} to {@code recipients} after it commits.
 *
 * @param assetLabel the asset as people know it, for example "Dell Latitude 5440 (LAP-0042)"
 * @param kind       LOST, DAMAGED, NOT_WORKING or OTHER
 * @param note       what the employee wrote; null when nothing
 * @param recipients employee ids of the people who manage assets (the reporter left out)
 */
public record AssetIssueReportedEvent(UUID tenantId, UUID issueId, UUID assetId, UUID employeeId,
                                      String employeeName, String assetLabel, String kind, String note,
                                      List<UUID> recipients) {}
