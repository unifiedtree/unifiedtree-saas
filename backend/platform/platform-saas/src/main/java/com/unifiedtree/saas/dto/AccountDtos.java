package com.unifiedtree.saas.dto;

import com.unifiedtree.auth.dto.AuthDtos.LoginResponse;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * DTOs for the global account portal and workspace switcher.
 *
 * <p>Account tokens are not tenant sessions. They only allow a user to list
 * workspaces and exchange a selected workspace membership for a normal
 * tenant-scoped ERP JWT.
 */
public final class AccountDtos {
    private AccountDtos() {}

    public record AccountLoginRequest(
            @NotBlank @Email @Size(max = 255) String email,
            @NotBlank @Size(min = 8, max = 128) String password
    ) {}

    public record AccountLoginResponse(
            String accessToken,
            Instant accessTokenExpiresAt,
            AccountSummary account,
            List<WorkspaceSummary> workspaces
    ) {}

    public record AccountSummary(
            UUID accountId,
            String email,
            String displayName,
            String phone,
            String status
    ) {}

    public record WorkspaceSummary(
            UUID tenantId,
            String tenantName,
            String subdomain,
            String workspaceUrl,
            String status,
            String role,
            boolean defaultWorkspace,
            UUID defaultCompanyId,
            String defaultCompanyName,
            List<ModuleCard> activeModules,
            List<ModuleCard> lockedPreviewModules,
            int lockedModuleCount,
            boolean canBuyModules
    ) {}

    public record ModuleCard(
            String key,
            String displayName,
            String category,
            boolean active,
            boolean locked,
            String action
    ) {}

    public record WorkspaceSessionRequest(
            @NotNull UUID tenantId
    ) {}

    public record WorkspaceSessionResponse(
            LoginResponse auth,
            WorkspaceSummary workspace
    ) {}

    public record CreateWorkspaceRequest(
            @NotBlank @Size(max = 150) String companyName,
            @NotBlank @Size(min = 3, max = 63) String subdomain,
            @Size(max = 150) String adminName,
            @Size(max = 20) String adminMobile,
            @Size(max = 50) String industry,
            @Size(max = 50) String country,
            @Size(max = 50) String timezone,
            @Size(max = 10) String currency,
            @Size(max = 50) String companySize,
            @Size(max = 100) String primaryInterest,
            @NotEmpty List<String> requestedModules
    ) {}
}
