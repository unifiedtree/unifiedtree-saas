package com.hrms.api.letters;

import com.hrms.core.dto.PageResponse;
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

import java.util.Map;
import java.util.UUID;

@Tag(name = "Letter Distributions", description = "Bulk letter distribution to many employees")
@RestController
@RequestMapping("/v1/letters/distributions")
public class LetterDistributionController {

    private final LetterDistributionService service;

    public LetterDistributionController(LetterDistributionService service) {
        this.service = service;
    }

    @Operation(summary = "Create a bulk distribution (resolves recipients, queues async send)")
    @PostMapping
    @ResponseStatus(HttpStatus.ACCEPTED)
    @PreAuthorize("hasAuthority('hrms.letters.distribute')")
    public DistributionJobDto create(@Valid @RequestBody CreateDistributionRequest req,
                                     @AuthenticationPrincipal Jwt jwt) {
        return service.createDistribution(req, UUID.fromString(jwt.getSubject()));
    }

    @Operation(summary = "List distribution jobs")
    @GetMapping
    @PreAuthorize("hasAuthority('hrms.letters.distribute') or hasAuthority('hrms.letters.read')")
    public PageResponse<DistributionJobDto> list(@PageableDefault(size = 20) Pageable pageable) {
        return service.list(pageable);
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
