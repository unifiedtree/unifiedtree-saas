package com.unifiedtree.auth.mfa;

import com.hrms.core.exception.HrmsException;
import com.unifiedtree.auth.service.JwtService;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import javax.crypto.Mac;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.UUID;

/**
 * The short-lived token that carries a sign-in from "password was right" to
 * "the two-factor code was right".
 *
 * <p>It is signed with a key DERIVED from the access-token key, never the
 * access-token key itself, so the resource server can't mistake it for an
 * access token: presenting it as a Bearer token fails signature checks and
 * gets a 401. It names who is signing in, to which workspace, and whether the
 * next step is entering a code (VERIFY) or setting two-factor up because the
 * workspace requires it (SETUP).
 */
@Component
public class MfaChallengeTokens {

    public enum Purpose { VERIFY, SETUP }

    public record Challenge(UUID userId, UUID tenantId, String email, Purpose purpose) {}

    static final Duration TTL = Duration.ofMinutes(10);
    private static final String TYPE = "mfa_challenge";

    private final SecretKey key;

    public MfaChallengeTokens(JwtService jwt) {
        this.key = deriveKey(jwt.signingKey().getEncoded());
    }

    MfaChallengeTokens(byte[] accessKeyMaterial) {
        this.key = deriveKey(accessKeyMaterial);
    }

    private static SecretKey deriveKey(byte[] accessKeyMaterial) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(accessKeyMaterial, "HmacSHA256"));
            return Keys.hmacShaKeyFor(mac.doFinal("ut-mfa-challenge-v1".getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException("Could not derive the two-factor challenge key", e);
        }
    }

    public String issue(UUID userId, UUID tenantId, String email, Purpose purpose) {
        return issue(userId, tenantId, email, purpose, Instant.now());
    }

    String issue(UUID userId, UUID tenantId, String email, Purpose purpose, Instant now) {
        return Jwts.builder()
                .subject(userId.toString())
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(TTL)))
                .id(UUID.randomUUID().toString())
                .claim("typ", TYPE)
                .claim("tenant_id", tenantId.toString())
                .claim("email", email)
                .claim("purpose", purpose.name())
                .signWith(key, Jwts.SIG.HS256)
                .compact();
    }

    /** Parse and check a challenge; an expired or forged one is a 401 the sign-in page explains. */
    public Challenge parse(String token) {
        if (token == null || token.isBlank()) throw expired();
        try {
            Claims c = Jwts.parser().verifyWith(key).build().parseSignedClaims(token.trim()).getPayload();
            if (!TYPE.equals(c.get("typ", String.class))) throw expired();
            return new Challenge(
                    UUID.fromString(c.getSubject()),
                    UUID.fromString(c.get("tenant_id", String.class)),
                    c.get("email", String.class),
                    Purpose.valueOf(c.get("purpose", String.class)));
        } catch (JwtException | IllegalArgumentException | NullPointerException e) {
            throw expired();
        }
    }

    private static HrmsException expired() {
        return new HrmsException("This sign-in step has expired. Enter your email and password again.",
                HttpStatus.UNAUTHORIZED, "MFA_CHALLENGE_EXPIRED");
    }
}
