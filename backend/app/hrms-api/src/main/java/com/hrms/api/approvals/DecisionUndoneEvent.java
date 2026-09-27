package com.hrms.api.approvals;

import java.util.UUID;

/**
 * Published inside an Undo's transaction; {@link ApprovalNotifier} tells the
 * employee after it commits. Everything the notification says is worked out
 * before the commit (after it, row-level security hides the rows).
 *
 * @param previousDecision "approval" or "rejection"
 */
public record DecisionUndoneEvent(UUID tenantId, UUID employeeId, DecisionKind kind, UUID requestId,
                                  String decidedBy, String requestText, String previousDecision) {
}
