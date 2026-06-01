package com.hrms.api.saas;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class SaasDtos {
    private SaasDtos() {}

    public record SignupRequest(
            @NotBlank String companyName,
            @NotBlank String subdomain,
            @NotBlank String adminName,
            @NotBlank @Email String adminEmail,
            String adminMobile,
            @NotBlank String password,
            String industry,
            String country,
            String timezone,
            String currency,
            String companySize,
            String primaryInterest,
            @NotEmpty List<String> requestedModules
    ) {}

    public record SignupResponse(
            UUID tenantId,
            UUID companyId,
            String tenantStatus,
            String subdomain,
            String workspaceUrl,
            List<String> requestedModules,
            String message
    ) {}

    public record SubdomainCheckResponse(
            String subdomain,
            boolean available,
            String reason
    ) {}

    public record WorkspaceStatusResponse(
            UUID tenantId,
            String tenantName,
            String subdomain,
            String status,
            List<String> requestedModules,
            List<String> activeModules
    ) {}

    public record PlatformLoginRequest(
            @NotBlank @Email String email,
            @NotBlank String password
    ) {}

    public record PlatformLoginResponse(
            String accessToken,
            long expiresIn,
            UUID adminId,
            String email,
            String name,
            List<String> roles
    ) {}

    public record TenantRequestSummary(
            UUID tenantId,
            String companyName,
            String subdomain,
            String fullDomain,
            String status,
            String adminName,
            String adminEmail,
            String adminMobile,
            List<String> requestedModules,
            List<String> activeModules,
            Instant requestedAt,
            Instant approvedAt,
            Instant rejectedAt,
            String rejectionReason
    ) {}

    public record ApprovalRequest(
            List<String> approvedModules,
            String note
    ) {}

    public record RejectionRequest(
            @NotBlank String reason
    ) {}
}
