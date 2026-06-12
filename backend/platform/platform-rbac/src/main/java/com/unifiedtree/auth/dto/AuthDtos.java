package com.unifiedtree.auth.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class AuthDtos {
    private AuthDtos() {}

    /**
     * Login request. {@code tenantId} is OPTIONAL: when omitted, the server
     * resolves the workspace from the email via {@code auth.resolve_login_tenant}
     * (the mobile app sends only email + password — no workspace field). When
     * present (e.g. subdomain-scoped web login), it is used directly.
     */
    public record LoginRequest(
            UUID tenantId,
            @NotBlank @Email String email,
            @NotBlank String password
    ) { }

    public record LoginResponse(
            String accessToken,
            String refreshToken,
            Instant accessTokenExpiresAt,
            UUID userId,
            UUID employeeId,
            UUID tenantId,
            String email,
            String firstName,
            String lastName,
            List<String> roles,
            List<String> permissions
    ) { }

    public record RefreshRequest(
            @NotBlank String refreshToken
    ) { }

    public record MeResponse(
            UUID userId,
            UUID tenantId,
            String email,
            String firstName,
            String lastName,
            List<String> roles,
            List<String> permissions,
            List<String> activeModules
    ) {
        /** Backward-compatible: callers that don't carry modules get an empty list. */
        public MeResponse(UUID userId, UUID tenantId, String email, String firstName, String lastName,
                          List<String> roles, List<String> permissions) {
            this(userId, tenantId, email, firstName, lastName, roles, permissions, List.of());
        }
    }
}
