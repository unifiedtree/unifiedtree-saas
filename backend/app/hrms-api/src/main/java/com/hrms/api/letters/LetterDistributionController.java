package com.hrms.api.letters;

import com.hrms.core.dto.PageResponse;
import com.hrms.core.dto.ListDateRange;
import com.hrms.letters.dto.CreateDistributionRequest;
import com.hrms.letters.dto.DistributionJobDto;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@Tag(name = "Letter Distributions", description = "Bulk letter distribution to many employees")
@RestController
@RequestMapping("/v1/letters/distributions")
public class LetterDistributionController {

    private final LetterDistributionService service;
    private final DistributionScheduleService schedules;

    public LetterDistributionController(LetterDistributionService service, DistributionScheduleService schedules) {
        this.service = service;
        this.schedules = schedules;
    }

    // ── "Send on" (redesign BW-73) ───────────────────────────────────────────

    @Operation(summary = "Scheduled distributions: waiting for their date, or could not start")
    @GetMapping("/scheduled")
    @PreAuthorize("hasAuthority('hrms.letters.distribute') or hasAuthority('hrms.letters.read')")
    public List<DistributionScheduleService.ScheduledDistribution> scheduled() {
        return schedules.list();
    }

    @Operation(summary = "Schedule a distribution to send on a later date (9:00 India time)")
    @PostMapping("/scheduled")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('hrms.letters.distribute')")
    public DistributionScheduleService.ScheduledDistribution schedule(
            @Valid @RequestBody DistributionScheduleService.ScheduleRequest req, @AuthenticationPrincipal Jwt jwt) {
        return schedules.schedule(req, UUID.fromString(jwt.getSubject()));
    }

    @Operation(summary = "Cancel a scheduled distribution that hasn't started")
    @DeleteMapping("/scheduled/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasAuthority('hrms.letters.distribute')")
    public void cancelScheduled(@PathVariable UUID id) {
        schedules.cancel(id);
    }

    @Operation(summary = "Create a bulk distribution (resolves recipients, queues async send)")
    @PostMapping
    @ResponseStatus(HttpStatus.ACCEPTED)
    @PreAuthorize("hasAuthority('hrms.letters.distribute')")
    public DistributionJobDto create(@Valid @RequestBody CreateDistributionRequest req,
                                     @AuthenticationPrincipal Jwt jwt) {
        return service.createDistribution(req, UUID.fromString(jwt.getSubject()));
    }

    @Operation(summary = "List distribution jobs, optionally only those started ?from=&to= (India days, both included)")
    @GetMapping
    @PreAuthorize("hasAuthority('hrms.letters.distribute') or hasAuthority('hrms.letters.read')")
    public PageResponse<DistributionJobDto> list(@PageableDefault(size = 20) Pageable pageable,
                                                 @RequestParam(required = false) String from,
                                                 @RequestParam(required = false) String to) {
        // Calendar everywhere (7 Oct 2026): the day the distribution was started; none = the list as before.
        ListDateRange range = ListDateRange.parse(from, to);
        return range == null ? service.list(pageable) : service.list(range.startsAt(), range.endsBefore(), pageable);
    }

    @Operation(summary = "Get a distribution job with its recipients")
    @GetMapping("/{jobId}")
    @PreAuthorize("hasAuthority('hrms.letters.distribute') or hasAuthority('hrms.letters.read')")
    public DistributionJobDto get(@PathVariable UUID jobId) {
        return service.get(jobId);
    }

    @Operation(summary = "Re-queue the FAILED recipients of a distribution")
    @PostMapping("/{jobId}/retry")
    @ResponseStatus(HttpStatus.ACCEPTED)
    @PreAuthorize("hasAuthority('hrms.letters.distribute')")
    public Map<String, Integer> retry(@PathVariable UUID jobId) {
        return Map.of("retried", service.retryFailed(jobId));
    }
}
