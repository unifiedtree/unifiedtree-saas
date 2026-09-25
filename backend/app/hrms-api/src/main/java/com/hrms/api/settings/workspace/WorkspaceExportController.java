package com.hrms.api.settings.workspace;

import com.hrms.core.exception.BusinessRuleException;
import com.unifiedtree.security.tenant.TenantContext;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;

/**
 * Full data export (Settings -> Danger zone), {@code workspace.data.export}
 * (owners and super admins):
 * <pre>
 *   GET  /v1/workspace/exports                  the last 10 exports and their state
 *   POST /v1/workspace/exports                  start one (202; built in the background, emailed when ready)
 *   GET  /v1/workspace/exports/{id}/download    the zip, for 7 days
 * </pre>
 */
@RestController
@RequestMapping("/v1/workspace/exports")
@SecurityRequirement(name = "bearerAuth")
public class WorkspaceExportController {

    private final WorkspaceExportService exports;

    public WorkspaceExportController(WorkspaceExportService exports) {
        this.exports = exports;
    }

    @Operation(summary = "Recent workspace data exports")
    @GetMapping
    @PreAuthorize("hasAuthority('workspace.data.export')")
    public List<WorkspaceExportService.ExportView> list() {
        return exports.list(tenant());
    }

    @Operation(summary = "Start a full workspace data export")
    @PostMapping
    @PreAuthorize("hasAuthority('workspace.data.export')")
    public ResponseEntity<WorkspaceExportService.ExportView> request(@AuthenticationPrincipal Jwt jwt) {
        UUID user = TenantContext.getUserId();
        if (user == null) throw new BusinessRuleException("No active session", "NOT_AUTHENTICATED");
        String email = jwt == null ? null : jwt.getClaimAsString("email");
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(exports.request(tenant(), user, email));
    }

    @Operation(summary = "Download a ready export (zip of CSVs)")
    @GetMapping("/{id}/download")
    @PreAuthorize("hasAuthority('workspace.data.export')")
    public ResponseEntity<byte[]> download(@PathVariable UUID id) {
        WorkspaceExportService.Download d = exports.download(tenant(), id);
        String name = d.fileName() == null ? "workspace-data-export.zip" : d.fileName();
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType("application/zip"))
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment().filename(name, StandardCharsets.UTF_8).build().toString())
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .body(d.bytes());
    }

    private static UUID tenant() {
        UUID t = TenantContext.getTenantId();
        if (t == null) throw new BusinessRuleException("No active session", "NOT_AUTHENTICATED");
        return t;
    }
}
