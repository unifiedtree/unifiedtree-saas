package com.hrms.api.notiftemplate;

import com.hrms.core.dto.PageResponse;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.notiftemplate.dto.NotificationTemplateRequest;
import com.hrms.notiftemplate.dto.NotificationTemplateResponse;
import com.hrms.notiftemplate.service.NotificationTemplateService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
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
 * Notification templates: per-company, per-channel message templates keyed by a
 * domain event. HR administrators author the subject/body that the platform
 * renders when an event fires on a given channel (email, SMS, push, in-app).
 */
@RestController
@RequestMapping("/v1/notiftemplate")
@Tag(name = "Notification Templates", description = "Per-company notification message templates by channel and event")
@SecurityRequirement(name = "bearerAuth")
public class NotificationTemplateController {

    private final NotificationTemplateService templateService;
    private final EmployeeRepository employeeRepository;

    public NotificationTemplateController(NotificationTemplateService templateService,
                                          EmployeeRepository employeeRepository) {
        this.templateService = templateService;
        this.employeeRepository = employeeRepository;
    }

    @Operation(summary = "Create a notification template")
    @PostMapping("/templates")
    @PreAuthorize("hasAuthority('hrms.notiftemplate.write')")
    public ResponseEntity<NotificationTemplateResponse> create(
            @Valid @RequestBody NotificationTemplateRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        UUID companyId = request.companyId();
        if (companyId == null) {
            UUID employeeId = extractEmployeeId(jwt);
            companyId = employeeRepository.findById(employeeId)
                    .map(Employee::getCompanyId)
                    .orElse(null);
        }
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(templateService.createTemplate(companyId, request));
    }

    @Operation(summary = "List notification templates (paged)")
    @GetMapping("/templates")
    @PreAuthorize("hasAuthority('hrms.notiftemplate.read')")
    public ResponseEntity<PageResponse<NotificationTemplateResponse>> list(
            @RequestParam(required = false) UUID companyId,
            @PageableDefault(size = 20) Pageable pageable) {
        return ResponseEntity.ok(templateService.listTemplates(companyId, pageable));
    }

    @Operation(summary = "Get a single notification template")
    @GetMapping("/templates/{id}")
    @PreAuthorize("hasAuthority('hrms.notiftemplate.read')")
    public ResponseEntity<NotificationTemplateResponse> get(@PathVariable UUID id) {
        return ResponseEntity.ok(templateService.getTemplate(id));
    }

    @Operation(summary = "Update a notification template")
    @PutMapping("/templates/{id}")
    @PreAuthorize("hasAuthority('hrms.notiftemplate.write')")
    public ResponseEntity<NotificationTemplateResponse> update(
            @PathVariable UUID id,
            @Valid @RequestBody NotificationTemplateRequest request) {
        return ResponseEntity.ok(templateService.updateTemplate(id, request));
    }

    @Operation(summary = "Delete a notification template")
    @DeleteMapping("/templates/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasAuthority('hrms.notiftemplate.write')")
    public void delete(@PathVariable UUID id) {
        templateService.deleteTemplate(id);
    }

    private UUID extractEmployeeId(Jwt jwt) {
        String empId = jwt.getClaimAsString("employee_id");
        return empId != null ? UUID.fromString(empId) : UUID.fromString(jwt.getSubject());
    }
}
