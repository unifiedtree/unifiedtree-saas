package com.hrms.auth.util;

import com.hrms.core.enums.Role;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.security.PrivateKey;
import java.security.PublicKey;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;
import java.util.List;
import java.util.UUID;

@Component
public class JwtTokenProvider {

    private static final Logger log = LoggerFactory.getLogger(JwtTokenProvider.class);

    private final PrivateKey privateKey;
    private final PublicKey publicKey;
    private final long accessTokenExpiryMinutes;
    private final long refreshTokenExpiryDays;

    public JwtTokenProvider(
            PrivateKey hrmsPrivateKey,
            PublicKey hrmsPublicKey,
            @Value("${hrms.jwt.access-token-expiry-minutes:15}") long accessTokenExpiryMinutes,
            @Value("${hrms.jwt.refresh-token-expiry-days:7}") long refreshTokenExpiryDays) {
        this.privateKey = hrmsPrivateKey;
        this.publicKey = hrmsPublicKey;
        this.accessTokenExpiryMinutes = accessTokenExpiryMinutes;
        this.refreshTokenExpiryDays = refreshTokenExpiryDays;
    }

    public String generateAccessToken(UUID userId, UUID tenantId, List<Role> roles, String email) {
        return generateAccessToken(userId, tenantId, roles, email, null);
    }

    public String generateAccessToken(UUID userId, UUID tenantId, List<Role> roles, String email, UUID employeeId) {
        Instant now = Instant.now();
        var builder = Jwts.builder()
                .subject(userId.toString())
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(accessTokenExpiryMinutes, ChronoUnit.MINUTES)))
                .claim("tenant_id", tenantId.toString())
                .claim("email", email)
                .claim("roles", roles.stream().map(Role::name).toList())
                .signWith(privateKey);

        if (employeeId != null) {
            builder.claim("employee_id", employeeId.toString());
        }

        return builder.compact();
    }

    public String generateRefreshToken(UUID userId, UUID tenantId) {
        Instant now = Instant.now();
        return Jwts.builder()
                .subject(userId.toString())
                .id(UUID.randomUUID().toString())
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(refreshTokenExpiryDays, ChronoUnit.DAYS)))
                .claim("tenant_id", tenantId.toString())
                .claim("type", "refresh")
                .signWith(privateKey)
                .compact();
    }

    public Claims parseToken(String token) {
        return Jwts.parser()
                .verifyWith(publicKey)
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }

    public boolean isRefreshToken(Claims claims) {
        return "refresh".equals(claims.get("type", String.class));
    }
}
