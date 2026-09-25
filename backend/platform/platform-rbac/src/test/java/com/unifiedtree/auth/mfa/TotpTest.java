package com.unifiedtree.auth.mfa;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.time.Instant;

import static org.junit.jupiter.api.Assertions.*;

class TotpTest {

    /** RFC 6238 appendix B, SHA-1 seed "12345678901234567890" (8-digit vectors). */
    private static final byte[] RFC_KEY = "12345678901234567890".getBytes(StandardCharsets.US_ASCII);

    @Test
    void matchesRfc6238Vectors() {
        assertEquals("94287082", Totp.codeAt(RFC_KEY, Totp.stepAt(Instant.ofEpochSecond(59)), 8));
        assertEquals("07081804", Totp.codeAt(RFC_KEY, Totp.stepAt(Instant.ofEpochSecond(1111111109)), 8));
        assertEquals("14050471", Totp.codeAt(RFC_KEY, Totp.stepAt(Instant.ofEpochSecond(1111111111)), 8));
        assertEquals("89005924", Totp.codeAt(RFC_KEY, Totp.stepAt(Instant.ofEpochSecond(1234567890)), 8));
        assertEquals("69279037", Totp.codeAt(RFC_KEY, Totp.stepAt(Instant.ofEpochSecond(2000000000)), 8));
        // Six digits are the last six of the same value.
        assertEquals("287082", Totp.codeAt(RFC_KEY, Totp.stepAt(Instant.ofEpochSecond(59)), 6));
    }

    @Test
    void base32RoundTripsAndMatchesKnownEncoding() {
        assertEquals("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", Totp.base32Encode(RFC_KEY));
        assertArrayEquals(RFC_KEY, Totp.base32Decode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"));
        assertArrayEquals(RFC_KEY, Totp.base32Decode("gezd gnbv gy3t qojq gezd gnbv gy3t qojq"));
        String s = Totp.newSecret();
        assertEquals(32, s.length());
        assertEquals(20, Totp.base32Decode(s).length);
    }

    @Test
    void acceptsCurrentAndNeighbourStepsOnly() {
        String secret = Totp.base32Encode(RFC_KEY);
        Instant now = Instant.ofEpochSecond(1_700_000_000L);
        long step = Totp.stepAt(now);
        byte[] key = Totp.base32Decode(secret);
        assertEquals(step, Totp.matchStep(secret, Totp.codeAt(key, step, 6), now, null));
        assertEquals(step - 1, Totp.matchStep(secret, Totp.codeAt(key, step - 1, 6), now, null));
        assertEquals(step + 1, Totp.matchStep(secret, Totp.codeAt(key, step + 1, 6), now, null));
        assertEquals(-1, Totp.matchStep(secret, Totp.codeAt(key, step - 3, 6), now, null));
        // Spaces are fine; wrong shapes are not.
        String c = Totp.codeAt(key, step, 6);
        assertEquals(step, Totp.matchStep(secret, c.substring(0, 3) + " " + c.substring(3), now, null));
        assertEquals(-1, Totp.matchStep(secret, "12345", now, null));
        assertEquals(-1, Totp.matchStep(secret, "abcdef", now, null));
        assertEquals(-1, Totp.matchStep(null, c, now, null));
    }

    @Test
    void refusesACodeAlreadyUsed() {
        String secret = Totp.base32Encode(RFC_KEY);
        Instant now = Instant.ofEpochSecond(1_700_000_000L);
        long step = Totp.stepAt(now);
        String code = Totp.codeAt(Totp.base32Decode(secret), step, 6);
        assertEquals(-1, Totp.matchStep(secret, code, now, step), "same step replayed");
        assertEquals(-1, Totp.matchStep(secret, code, now, step + 1), "an older step after a newer one");
    }

    @Test
    void otpauthLinkNamesTheWorkspaceNotThePlatform() {
        String url = Totp.otpauthUrl("Acme Industries", "asha@acme.in", "JBSWY3DPEHPK3PXP");
        assertTrue(url.startsWith("otpauth://totp/Acme%20Industries:asha%40acme.in?secret=JBSWY3DPEHPK3PXP"));
        assertTrue(url.contains("&issuer=Acme%20Industries"));
        assertTrue(url.contains("digits=6") && url.contains("period=30"));
        assertFalse(url.toLowerCase().contains("unifiedtree"));
    }
}
