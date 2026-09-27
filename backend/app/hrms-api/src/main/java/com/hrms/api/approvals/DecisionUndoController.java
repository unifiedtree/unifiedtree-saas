package com.hrms.api.approvals;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * Approval Undo, one endpoint per kind next to that kind's decide endpoint,
 * each with the same guard as the decide endpoint; the service adds "only the
 * person who decided", the decide endpoint's object check, the 10-minute
 * window and the downstream checks. Plus the caller's recent decisions.
 *
 * <p>Answers: 200 with the request, waiting again; 403 for someone who isn't
 * allowed; 404 when there is no recorded decision on the request (decided
 * before the journal existed); 422 with a plain reason when it can no longer
 * be taken back; 503 FEATURE_NOT_READY while the journal table is missing.
 */
@RestController
@Tag(name = "Approvals", description = "Take back an approve or reject within 10 minutes")
@SecurityRequirement(name = "bearerAuth")
public class DecisionUndoController {

    private final DecisionUndoService undo;

    public DecisionUndoController(DecisionUndoService undo) {
        this.undo = undo;
    }

    @Operation(summary = "Take back a leave decision (single step, level 1 or level 2)")
    @PostMapping("/v1/leave/{requestId}/decision/undo")
    @PreAuthorize("@perm.check('hrms.leave.approve.l1') or @perm.check('hrms.leave.approve.l2')")
    public DecisionUndoService.UndoResult undoLeave(@PathVariable UUID requestId, @AuthenticationPrincipal Jwt jwt,
                                                    Authentication auth) {
        return undo.undo(DecisionKind.LEAVE, requestId, jwt, auth);
    }

    @Operation(summary = "Take back a work-from-home decision")
    @PostMapping("/v1/wfh/{requestId}/decision/undo")
    @PreAuthorize("hasAuthority('wfh.approve')")
    public DecisionUndoService.UndoResult undoWfh(@PathVariable UUID requestId, @AuthenticationPrincipal Jwt jwt,
                                                  Authentication auth) {
        return undo.undo(DecisionKind.WFH, requestId, jwt, auth);
    }

    @Operation(summary = "Take back an attendance correction decision")
    @PostMapping("/v1/attendance/corrections/{correctionId}/decision/undo")
    @PreAuthorize("hasAuthority('attendance.regularization.approve')")
    public DecisionUndoService.UndoResult undoCorrection(@PathVariable UUID correctionId, @AuthenticationPrincipal Jwt jwt,
                                                         Authentication auth) {
        return undo.undo(DecisionKind.CORRECTION, correctionId, jwt, auth);
    }

    @Operation(summary = "Take back a shift change decision")
    @PostMapping("/v1/shifts/change-requests/{requestId}/decision/undo")
    @PreAuthorize("hasAuthority('attendance.regularization.approve')")
    public DecisionUndoService.UndoResult undoShiftChange(@PathVariable UUID requestId, @AuthenticationPrincipal Jwt jwt,
                                                          Authentication auth) {
        return undo.undo(DecisionKind.SHIFT_CHANGE, requestId, jwt, auth);
    }

    @Operation(summary = "Take back an expense claim decision")
    @PostMapping("/v1/expense/claims/{id}/decision/undo")
    @PreAuthorize("@perm.check('hrms.expense.claim.approve')")
    public DecisionUndoService.UndoResult undoExpense(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt,
                                                      Authentication auth) {
        return undo.undo(DecisionKind.EXPENSE, id, jwt, auth);
    }

    @Operation(summary = "My decisions I can still take back, newest first")
    @GetMapping("/v1/approvals/recent-decisions")
    @PreAuthorize("isAuthenticated()")
    public List<DecisionJournal.Recent> recentDecisions(@AuthenticationPrincipal Jwt jwt) {
        return undo.recent(jwt);
    }
}
