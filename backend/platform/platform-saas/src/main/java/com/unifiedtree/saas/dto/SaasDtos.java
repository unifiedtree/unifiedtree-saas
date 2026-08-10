package com.unifiedtree.saas.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Wire DTOs for the canonical SaaS portal endpoints.
 *
 * <p>Same wire shape as the legacy com.hrms.api.saas DTOs so the
 * frontend does not have to change. Backed by canonical tables only:
 * platform.tenants, platform.tenant_domains, platform.tenant_modules,
 * auth.user_credentials, rbac.user_roles.
 */
public final class SaasDtos {
    private SaasDtos() {}

    public record SignupRequest(
            @NotBlank @Size(max = 150) String companyName,
            @NotBlank @Size(min = 3, max = 63) String subdomain,
            @NotBlank @Size(max = 150) String adminName,
            @NotBlank @Email @Size(max = 255) String adminEmail,
            @Size(max = 20) String adminMobile,
            @NotBlank @Size(min = 8, max = 128) String password,
            @Size(max = 50)  String industry,
            @Size(max = 50)  String country,
            @Size(max = 50)  String timezone,
            @Size(max = 10)  String currency,
            @Size(max = 50)  String companySize,
            @Size(max = 100) String primaryInterest,
            @NotEmpty List<String> requestedModules,
            // Razorpay proof of payment. Required only when the paywall is
            // configured (production) AND mode != "TRIAL"; the backend re-verifies
            // it server-side and derives the activated modules from the PAID
            // plans, so a client cannot self-grant modules it did not pay for.
            PaymentProof payment,
            // "PAID" (default, requires payment when paywall active) or "TRIAL"
            // (skips payment; workspace created with a fixed-length trial
            // subscription per platform.billing_settings). Null == PAID.
            String mode
    ) {
        public record PaymentProof(
                String razorpayOrderId,
                String razorpayPaymentId,
                String razorpaySignature
        ) {}
    }

    public record SignupResponse(
            UUID accountId,
            UUID tenantId,
            String subdomain,
            String workspaceUrl,
            String status,
            List<String> requestedModules,
            String workspaceRole,
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
            List<String> activeModules,
            /** Custom workspace logo URL if the admin uploaded one, else null.
             *  The login page renders this above the workspace name so the
             *  customer sees their own brand before they sign in. */
            String logoUrl
    ) {}

    public record PlatformLoginRequest(
            @NotBlank @Email String email,
            @NotBlank String password
    ) {}

    public record PlatformLoginResponse(
            String accessToken,
            long expiresInSeconds,
            UUID adminId,
            String email,
            String name,
            List<String> roles,
            List<String> permissions
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
            @NotEmpty List<String> approvedModules,
            String note
    ) {}

    public record RejectionRequest(
            @NotBlank String reason
    ) {}
}
