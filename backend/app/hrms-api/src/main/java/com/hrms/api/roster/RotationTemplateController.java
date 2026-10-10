package com.hrms.api.roster;

import com.hrms.api.roster.RosterContract.RotationTemplate;
import com.hrms.api.roster.RosterContract.TemplateBody;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * Rotation patterns for the shift planner (design §1.5, endpoints 1–4), all with
 * {@code attendance.roster.plan}; see {@link RotationTemplateService}.
 * <pre>
 *   GET    /v1/rotation-templates?companyId=     the patterns the caller may use
 *   POST   /v1/rotation-templates?companyId=     create (TemplateBody) → 201
 *   PUT    /v1/rotation-templates/{id}           replace name, department, repeat and days
 *   DELETE /v1/rotation-templates/{id}           switch it off → 204 (rosters keep their own copy)
 * </pre>
 * Every call answers 503 FEATURE_NOT_READY while V143.106 is not applied.
 */
@RestController
@RequestMapping("/v1/rotation-templates")
@Tag(name = "Shift planning: rotation patterns", description = "Saved shift rotation patterns for the roster planner")
@SecurityRequirement(name = "bearerAuth")
public class RotationTemplateController {

    private static final String PLAN = "hasAuthority('attendance.roster.plan')";

    private final RotationTemplateService templates;

    public RotationTemplateController(RotationTemplateService templates) {
        this.templates = templates;
    }

    @Operation(summary = "The rotation patterns the caller may use")
    @GetMapping
    @PreAuthorize(PLAN)
    public List<RotationTemplate> list(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) UUID companyId) {
        return templates.list(jwt, companyId);
    }

    @Operation(summary = "Save a rotation pattern")
    @PostMapping
    @PreAuthorize(PLAN)
    public ResponseEntity<RotationTemplate> create(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) UUID companyId,
                                                   @RequestBody TemplateBody body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(templates.create(jwt, companyId, body));
    }

    @Operation(summary = "Change a rotation pattern")
    @PutMapping("/{id:[0-9a-fA-F-]{36}}")
    @PreAuthorize(PLAN)
    public RotationTemplate replace(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id, @RequestBody TemplateBody body) {
        return templates.replace(jwt, id, body);
    }

    @Operation(summary = "Delete a rotation pattern (rosters made with it keep their own copy)")
    @DeleteMapping("/{id:[0-9a-fA-F-]{36}}")
    @PreAuthorize(PLAN)
    public ResponseEntity<Void> delete(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        templates.delete(jwt, id);
        return ResponseEntity.noContent().build();
    }
}
