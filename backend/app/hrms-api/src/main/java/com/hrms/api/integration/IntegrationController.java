package com.hrms.api.integration;

import com.hrms.core.dto.PageResponse;
import com.hrms.integration.dto.IntegrationConnectionRequest;
import com.hrms.integration.dto.IntegrationConnectionResponse;
import com.hrms.integration.service.IntegrationService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/**
 * Integrations directory: register third-party connections, browse them, toggle
 * their connected state, and remove them. All endpoints are tenant-scoped via RLS.
 */
@RestController
@RequestMapping("/v1/integration")
@Tag(name = "Integration", description = "Third-party integration connections directory")
@SecurityRequirement(name = "bearerAuth")
public class IntegrationController {

    private static final Logger log = LoggerFactory.getLogger(IntegrationController.class);

    private final IntegrationService integrationService;

    public IntegrationController(IntegrationService integrationService) {
        this.integrationService = integrationService;
    }

    @Operation(summary = "Register a new integration connection")
    @PostMapping("/connections")
    @PreAuthorize("hasAuthority('hrms.integration.write')")
    public ResponseEntity<IntegrationConnectionResponse> create(
            @Valid @RequestBody IntegrationConnectionRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        log.info("Integration connection requested by actor={}", extractEmployeeId(jwt));
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(integrationService.createConnection(request));
    }

    @Operation(summary = "List integration connections (optionally filtered by company)")
    @GetMapping("/connections")
    @PreAuthorize("hasAuthority('hrms.integration.read')")
    public ResponseEntity<PageResponse<IntegrationConnectionResponse>> list(
            @RequestParam(required = false) UUID companyId,
            @PageableDefault(size = 20) Pageable pageable) {
        return ResponseEntity.ok(integrationService.listConnections(companyId, pageable));
    }

    @Operation(summary = "Connect or disconnect an integration")
    @PostMapping("/connections/{id}/toggle")
    @PreAuthorize("hasAuthority('hrms.integration.write')")
    public ResponseEntity<IntegrationConnectionResponse> toggle(
            @PathVariable UUID id,
            @AuthenticationPrincipal Jwt jwt) {
        log.info("Integration connection {} toggle requested by actor={}", id, extractEmployeeId(jwt));
        return ResponseEntity.ok(integrationService.toggleConnection(id));
    }

    @Operation(summary = "Remove an integration connection")
    @DeleteMapping("/connections/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasAuthority('hrms.integration.write')")
    public void delete(@PathVariable UUID id) {
        integrationService.deleteConnection(id);
    }

    private UUID extractEmployeeId(Jwt jwt) {
        String empId = jwt.getClaimAsString("employee_id");
        return empId != null ? UUID.fromString(empId) : UUID.fromString(jwt.getSubject());
    }
}
