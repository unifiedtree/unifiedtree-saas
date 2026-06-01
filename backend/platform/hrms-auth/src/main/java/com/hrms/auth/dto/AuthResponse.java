package com.hrms.auth.dto;

import com.hrms.core.enums.Role;

import java.util.List;
import java.util.UUID;

public record AuthResponse(
        String accessToken,
        String refreshToken,
        long accessTokenExpiresInSeconds,
        UUID userId,
        UUID employeeId,
        UUID tenantId,
        String email,
        List<Role> roles,
        boolean mfaRequired
) {}
