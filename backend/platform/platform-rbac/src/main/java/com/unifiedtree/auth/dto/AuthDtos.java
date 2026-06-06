package com.unifiedtree.auth.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class AuthDtos {
    private AuthDtos() {}

    public record LoginRequest(
            @NotNull UUID tenantId,
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
            List<String> roles,
            List<String> permissions,
            List<String> activeModules
    ) {
        /** Backward-compatible: callers that don't carry modules get an empty list. */
        public MeResponse(UUID userId, UUID tenantId, String email,
                          List<String> roles, List<String> permissions) {
            this(userId, tenantId, email, roles, permissions, List.of());
        }
    }
}
