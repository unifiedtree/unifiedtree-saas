package com.unifiedtree.auth.mfa;

import com.hrms.core.exception.HrmsException;
import com.unifiedtree.auth.service.JwtService;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

class MfaChallengeTokensTest {

    private final JwtService jwt = new JwtService("0123456789abcdef0123456789abcdef-test-key", "unifiedtree", 720, 7);
    private final MfaChallengeTokens tokens = new MfaChallengeTokens(jwt);

    @Test
    void roundTripsWhoWhereAndWhichStep() {
        UUID user = UUID.randomUUID(), tenant = UUID.randomUUID();
        String t = tokens.issue(user, tenant, "asha@acme.in", MfaChallengeTokens.Purpose.SETUP);
        MfaChallengeTokens.Challenge c = tokens.parse(t);
        assertEquals(user, c.userId());
        assertEquals(tenant, c.tenantId());
        assertEquals("asha@acme.in", c.email());
        assertEquals(MfaChallengeTokens.Purpose.SETUP, c.purpose());
    }

    @Test
    void cannotBeUsedAsAnAccessToken() {
        String t = tokens.issue(UUID.randomUUID(), UUID.randomUUID(), "a@b.c", MfaChallengeTokens.Purpose.VERIFY);
        assertThrows(Exception.class, () -> jwt.parseAndValidate(t), "signed with a different key");
    }

    @Test
    void anAccessTokenIsNotAChallenge() {
        String access = jwt.issueAccessToken(UUID.randomUUID(), UUID.randomUUID(), "a@b.c", List.of("OWNER"), List.of("x"), null, UUID.randomUUID()).token();
        HrmsException e = assertThrows(HrmsException.class, () -> tokens.parse(access));
        assertEquals(HttpStatus.UNAUTHORIZED, e.getStatus());
        assertEquals("MFA_CHALLENGE_EXPIRED", e.getErrorCode());
    }

    @Test
    void refusesTamperedBlankAndExpiredTokens() {
        String t = tokens.issue(UUID.randomUUID(), UUID.randomUUID(), "a@b.c", MfaChallengeTokens.Purpose.VERIFY);
        String tampered = t.substring(0, t.length() - 3) + (t.endsWith("aaa") ? "bbb" : "aaa");
        assertThrows(HrmsException.class, () -> tokens.parse(tampered));
        assertThrows(HrmsException.class, () -> tokens.parse(""));
        assertThrows(HrmsException.class, () -> tokens.parse(null));

        // An expired challenge signed with the right key is still refused.
        String expired = tokens.issue(UUID.randomUUID(), UUID.randomUUID(), "a@b.c", MfaChallengeTokens.Purpose.VERIFY,
                Instant.now().minus(MfaChallengeTokens.TTL).minusSeconds(60));
        assertThrows(HrmsException.class, () -> tokens.parse(expired));
        String fresh = tokens.issue(UUID.randomUUID(), UUID.randomUUID(), "a@b.c", MfaChallengeTokens.Purpose.VERIFY,
                Instant.now().minusSeconds(60));
        assertNotNull(tokens.parse(fresh));
    }

    @Test
    void accessTokensCarryTheSessionId() {
        UUID sid = UUID.randomUUID();
        String access = jwt.issueAccessToken(UUID.randomUUID(), UUID.randomUUID(), "a@b.c", List.of(), List.of(), null, sid).token();
        assertEquals(sid.toString(), jwt.parseAndValidate(access).get("sid", String.class));
        String legacy = jwt.issueAccessToken(UUID.randomUUID(), UUID.randomUUID(), "a@b.c", List.of(), List.of(), null).token();
        assertNull(jwt.parseAndValidate(legacy).get("sid", String.class));
    }
}
