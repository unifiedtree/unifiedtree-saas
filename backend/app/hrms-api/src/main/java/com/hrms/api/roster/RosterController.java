package com.hrms.api.roster;

import com.hrms.api.roster.RosterContract.Checks;
import com.hrms.api.roster.RosterContract.DraftBody;
import com.hrms.api.roster.RosterContract.LockVersionBody;
import com.hrms.api.roster.RosterContract.PublishBody;
import com.hrms.api.roster.RosterContract.PublishResult;
import com.hrms.api.roster.RosterContract.RosterDetail;
import com.hrms.api.roster.RosterContract.RosterSettings;
import com.hrms.api.roster.RosterContract.RosterSettingsBody;
import com.hrms.api.roster.RosterContract.RosterSummary;
import com.hrms.api.roster.RosterContract.ScheduleChange;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * Shift rosters (design §1.5): settings, list, draft save, read, delete, check, publish, discard
 * changes and history. Who may do what: {@link PlannerScopeService} (HR/Admin for the company,
 * department heads for the departments they head; only HR/Admin publish).
 * <pre>
 *   GET    /v1/rosters/settings?companyId=              plan or policy.manage
 *   PUT    /v1/rosters/settings?companyId=              policy.manage            {minRestMinutes}
 *   GET    /v1/rosters?companyId=&amp;from=&amp;to=             plan or publish          RosterSummary[], newest first
 *   POST   /v1/rosters?companyId=                       plan                     DraftBody → RosterDetail (201)
 *   GET    /v1/rosters/{id}                             plan or publish          RosterDetail (with plan)
 *   PUT    /v1/rosters/{id}                             plan                     DraftBody + lockVersion → RosterDetail
 *   DELETE /v1/rosters/{id}                             plan                     a never-published draft → 204
 *   GET    /v1/rosters/{id}/check                       plan or publish          Checks
 *   POST   /v1/rosters/{id}/publish                     publish                  PublishBody → PublishResult
 *   POST   /v1/rosters/{id}/discard-changes             plan                     {lockVersion} → RosterDetail
 *   GET    /v1/rosters/{id}/history?employeeId=         plan or publish          ScheduleChange[], newest first
 * </pre>
 * {@code {id}} is matched as a UUID, so {@code /settings}, {@code /people}, {@code /preview} and
 * {@code /import/*} (the planner's and the import's own controllers) never collide. Every call answers
 * 503 FEATURE_NOT_READY while V143.106 is not applied.
 */
@RestController
@RequestMapping("/v1/rosters")
@Tag(name = "Shift planning: rosters", description = "Draft, check and publish shift rosters")
@SecurityRequirement(name = "bearerAuth")
public class RosterController {

    private static final Logger log = LoggerFactory.getLogger(RosterController.class);

    private static final String ID = "/{id:[0-9a-fA-F-]{36}}";
    private static final String PLAN = "hasAuthority('attendance.roster.plan')";
    private static final String PLAN_OR_PUBLISH = "hasAuthority('attendance.roster.plan') or hasAuthority('attendance.roster.publish')";
    private static final String PUBLISH = "hasAuthority('attendance.roster.publish')";

    private final RosterService rosters;
    private final RosterPublisher publisher;
    private final RosterSettingsService settings;

    public RosterController(RosterService rosters, RosterPublisher publisher, RosterSettingsService settings) {
        this.rosters = rosters;
        this.publisher = publisher;
        this.settings = settings;
    }

    // ── settings ──────────────────────────────────────────────────────────────

    @Operation(summary = "The shift planner's settings for the company (defaults when none are saved)")
    @GetMapping("/settings")
    @PreAuthorize("hasAuthority('attendance.roster.plan') or hasAuthority('attendance.policy.manage')")
    public RosterSettings settings(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) UUID companyId) {
        return settings.get(jwt, companyId);
    }

    @Operation(summary = "Change the minimum rest between two shifts (a warning only)")
    @PutMapping("/settings")
    @PreAuthorize("hasAuthority('attendance.policy.manage')")
    public RosterSettings updateSettings(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) UUID companyId,
                                         @RequestBody RosterSettingsBody body) {
        return settings.update(jwt, companyId, body);
    }

    // ── rosters ───────────────────────────────────────────────────────────────

    @Operation(summary = "The company's rosters overlapping a period (default: 90 days back to 120 ahead), newest first")
    @GetMapping
    @PreAuthorize(PLAN_OR_PUBLISH)
    public List<RosterSummary> list(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) UUID companyId,
                                    @RequestParam(required = false) LocalDate from, @RequestParam(required = false) LocalDate to) {
        return rosters.list(jwt, companyId, from, to);
    }

    @Operation(summary = "Save a new draft roster")
    @PostMapping
    @PreAuthorize(PLAN)
    public ResponseEntity<RosterDetail> create(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) UUID companyId,
                                               @RequestBody DraftBody body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(rosters.create(jwt, companyId, body));
    }

    @Operation(summary = "A roster with its people, staffing, days and schedule check")
    @GetMapping(ID)
    @PreAuthorize(PLAN_OR_PUBLISH)
    public RosterDetail get(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        return rosters.get(jwt, id);
    }

    @Operation(summary = "Save a roster's working copy (send the lockVersion you loaded)")
    @PutMapping(ID)
    @PreAuthorize(PLAN)
    public RosterDetail replace(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id, @RequestBody DraftBody body) {
        return rosters.replace(jwt, id, body);
    }

    @Operation(summary = "Delete a draft roster that was never published")
    @DeleteMapping(ID)
    @PreAuthorize(PLAN)
    public ResponseEntity<Void> delete(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        rosters.delete(jwt, id);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "The full schedule check of the saved roster")
    @GetMapping(ID + "/check")
    @PreAuthorize(PLAN_OR_PUBLISH)
    public Checks check(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        return rosters.check(jwt, id);
    }

    @Operation(summary = "Publish the roster's days from today on; people on it are told")
    @PostMapping(ID + "/publish")
    @PreAuthorize(PUBLISH)
    public PublishResult publish(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id, @RequestBody PublishBody body) {
        return publisher.publish(jwt, id, body);
    }

    @Operation(summary = "Put the working copy's days from today on back to what is published")
    @PostMapping(ID + "/discard-changes")
    @PreAuthorize(PLAN)
    public RosterDetail discard(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id, @RequestBody LockVersionBody body) {
        return publisher.discard(jwt, id, body);
    }

    @Operation(summary = "What each publish changed, newest first")
    @GetMapping(ID + "/history")
    @PreAuthorize(PLAN_OR_PUBLISH)
    public List<ScheduleChange> history(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id,
                                        @RequestParam(required = false) UUID employeeId) {
        return rosters.history(jwt, id, employeeId);
    }

    /** 409 ROSTER_HAS_ERRORS / ROSTER_HAS_WARNINGS with the checks in the body. */
    @ExceptionHandler(RosterChecksException.class)
    public ResponseEntity<RosterChecksException.Body> checksRefused(RosterChecksException ex) {
        log.warn("Business exception [{}]: {}", ex.getErrorCode(), ex.getMessage());
        return ResponseEntity.status(ex.getStatus()).body(ex.body());
    }
}
