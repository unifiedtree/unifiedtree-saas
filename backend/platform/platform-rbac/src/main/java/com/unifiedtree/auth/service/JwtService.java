package com.unifiedtree.auth.service;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Issues + parses JWTs for the canonical auth flow.
 *
 * Algorithm: HS256 with a shared secret loaded from {@code unifiedtree.jwt.secret}
 * (env var {@code UNIFIEDTREE_JWT_SECRET}). HS256 is intentional for Phase 1:
 * the resource server and the issuer are the same JVM, so the simpler shared
 * secret beats RSA key pair management for now. Phase 1.5 can swap to RS256
 * when the issuer is separated.
 *
 * Claims:
 *   sub          - user UUID
 *   tenant_id    - tenant UUID (used by TenantContextFilter)
 *   email        - login email
 *   roles        - list of role codes (e.g. ["SUPER_ADMIN", "EMPLOYEE"])
 *   permissions  - de-duped list of permission codes
 *
 * Global account portal tokens intentionally omit tenant_id and carry
 * token_type=account. They can only call account/workspace selection APIs and
 * must be exchanged for a tenant-scoped workspace token before entering ERP
 * data paths.
 */
@Service
public class JwtService {

    /** Token TTLs sourced from properties; sensible production defaults. */
    private final Duration accessTokenTtl;
    private final Duration refreshTokenTtl;
    private final String issuer;
    private final SecretKey signingKey;

    public JwtService(
            @Value("${unifiedtree.jwt.secret:change-me-change-me-change-me-change-me}") String secret,
            @Value("${unifiedtree.jwt.issuer:unifiedtree}") String issuer,
            @Value("${unifiedtree.jwt.access-ttl-minutes:720}") long accessTtlMin,
            @Value("${unifiedtree.jwt.refresh-ttl-days:7}") long refreshTtlDays) {
        this.issuer = issuer;
        this.accessTokenTtl = Duration.ofMinutes(accessTtlMin);
        this.refreshTokenTtl = Duration.ofDays(refreshTtlDays);
        // HS256 requires at least 32 bytes of key material.
        byte[] keyBytes = secret.getBytes(StandardCharsets.UTF_8);
        if (keyBytes.length < 32) {
            throw new IllegalStateException(
                "unifiedtree.jwt.secret must be at least 32 characters (got " + keyBytes.length + ")");
        }
        this.signingKey = Keys.hmacShaKeyFor(keyBytes);
    }

    public IssuedToken issueAccessToken(UUID userId, UUID tenantId, String email,
                                        List<String> roleCodes, List<String> permissions) {
        return issueAccessToken(userId, tenantId, email, roleCodes, permissions, null);
    }

    public IssuedToken issueAccessToken(UUID userId, UUID tenantId, String email,
                                        List<String> roleCodes, List<String> permissions,
                                        UUID employeeId) {
        Instant now = Instant.now();
        Instant exp = now.plus(accessTokenTtl);
        var builder = Jwts.builder()
            .issuer(issuer)
            .subject(userId.toString())
            .issuedAt(Date.from(now))
            .expiration(Date.from(exp))
            .claim("tenant_id",   tenantId.toString())
            .claim("email",       email)
            .claim("roles",       roleCodes)
            .claim("permissions", permissions);
        if (employeeId != null) {
            builder.claim("employee_id", employeeId.toString());
        }
        return new IssuedToken(builder.signWith(signingKey, Jwts.SIG.HS256).compact(), exp, accessTokenTtl);
    }

    public IssuedToken issueAccountToken(UUID accountId, String email) {
        Instant now = Instant.now();
        Instant exp = now.plus(accessTokenTtl);
        String normalizedEmail = email == null ? "" : email.toLowerCase();
        String token = Jwts.builder()
            .issuer(issuer)
            .subject(accountId.toString())
            .issuedAt(Date.from(now))
            .expiration(Date.from(exp))
            .claim("token_type", "account")
            .claim("account_id", accountId.toString())
            .claim("email", normalizedEmail)
            .claim("roles", List.of("ACCOUNT_USER"))
            .claim("permissions", List.of("workspace.account.read"))
            .signWith(signingKey, Jwts.SIG.HS256)
            .compact();
        return new IssuedToken(token, exp, accessTokenTtl);
    }

    /** Refresh tokens are opaque UUIDs in our scheme, not JWTs -- safer and shorter. */
    public Duration refreshTokenTtl() {
        return refreshTokenTtl;
    }

    public SecretKey signingKey() {
        return signingKey;
    }

    public Claims parseAndValidate(String compactJwt) {
        return Jwts.parser()
            .verifyWith(signingKey)
            .requireIssuer(issuer)
            .build()
            .parseSignedClaims(compactJwt)
            .getPayload();
    }

    public record IssuedToken(String token, Instant expiresAt, Duration ttl) { }
}
