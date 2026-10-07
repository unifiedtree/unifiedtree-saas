package com.unifiedtree.saas.admin.support;

import org.springframework.security.oauth2.jwt.Jwt;

import java.util.UUID;

/**
 * The UnifiedTree operator behind a platform-admin request, as their platform
 * token names them. Recorded on every change they make ({@code granted_by},
 * {@code created_by}, audit actor), so a row says who did it without a join.
 */
public record Operator(UUID userId, String email) {

    public static Operator of(Jwt jwt) {
        UUID id = null;
        try {
            id = UUID.fromString(jwt.getSubject());
        } catch (RuntimeException ignored) {
            // A platform token always has a UUID subject; keep the email if not.
        }
        String email = jwt.getClaimAsString("email");
        return new Operator(id, email == null || email.isBlank() ? String.valueOf(id) : email);
    }

    /** How the operator is written into {@code granted_by} / {@code created_by} columns. */
    public String label() {
        return "platform:" + email;
    }
}
