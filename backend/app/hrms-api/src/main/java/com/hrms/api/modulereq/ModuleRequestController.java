package com.hrms.api.modulereq;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * Public (unauthenticated) endpoint a workspace admin hits to ask UnifiedTree
 * to ADD one or more modules to their workspace. We do NOT activate anything
 * here — module enablement stays a manual platform-admin action. We just notify
 * UnifiedTree by email (and best-effort record REQUESTED rows if the tenant is
 * resolvable by subdomain).
 *
 * <p>Mounted under {@code /v1/public} so the canonical-prod security config's
 * {@code permitAll()} rule lets anonymous traffic through.
 */
@RestController
@RequestMapping("/v1/public")
public class ModuleRequestController {

    private final ModuleRequestService service;

    public ModuleRequestController(ModuleRequestService service) {
        this.service = service;
    }

    public record ModuleRequest(
            @NotBlank String subdomain,
            @NotBlank @Email String adminEmail,
            String adminName,
            @NotEmpty List<String> modules) {}

    @PostMapping("/module-request")
    public Map<String, String> requestModules(@Valid @RequestBody ModuleRequest req) {
        service.handle(req);
        return Map.of("status", "ok");
    }
}
