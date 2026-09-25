package com.unifiedtree.auth.mfa;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.time.Instant;

/**
 * Time-based one-time passwords (RFC 6238, HMAC-SHA1, 6 digits, 30-second
 * steps): what Google Authenticator, Microsoft Authenticator, Authy and 1Password
 * produce. Pure functions, no state, so it is easy to test against the RFC's
 * published vectors.
 */
public final class Totp {

    public static final int DIGITS = 6;
    public static final int PERIOD_SECONDS = 30;
    /** Codes one step either side of "now" are accepted (phone clocks drift). */
    public static final int WINDOW = 1;

    private static final String B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    private static final SecureRandom RNG = new SecureRandom();

    private Totp() {}

    /** A fresh 160-bit secret, Base32 encoded (32 characters, no padding). */
    public static String newSecret() {
        byte[] key = new byte[20];
        RNG.nextBytes(key);
        return base32Encode(key);
    }

    public static long stepAt(Instant now) {
        return Math.floorDiv(now.getEpochSecond(), PERIOD_SECONDS);
    }

    /** The code for one time step. */
    public static String codeAt(byte[] key, long step, int digits) {
        byte[] msg = new byte[8];
        long v = step;
        for (int i = 7; i >= 0; i--) { msg[i] = (byte) (v & 0xFF); v >>>= 8; }
        byte[] h;
        try {
            Mac mac = Mac.getInstance("HmacSHA1");
            mac.init(new SecretKeySpec(key, "HmacSHA1"));
            h = mac.doFinal(msg);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("HmacSHA1 unavailable", e);
        }
        int off = h[h.length - 1] & 0x0F;
        int bin = ((h[off] & 0x7F) << 24) | ((h[off + 1] & 0xFF) << 16) | ((h[off + 2] & 0xFF) << 8) | (h[off + 3] & 0xFF);
        int mod = 1;
        for (int i = 0; i < digits; i++) mod *= 10;
        String s = Integer.toString(bin % mod);
        StringBuilder sb = new StringBuilder(digits);
        for (int i = s.length(); i < digits; i++) sb.append('0');
        return sb.append(s).toString();
    }

    /**
     * The time step a 6-digit code matches, or -1. A step at or before
     * {@code lastUsedStep} is refused so a code can't be replayed.
     */
    public static long matchStep(String base32Secret, String code, Instant now, Long lastUsedStep) {
        if (base32Secret == null || code == null) return -1;
        String c = code.replaceAll("\\s", "");
        if (!c.matches("\\d{" + DIGITS + "}")) return -1;
        byte[] key = base32Decode(base32Secret);
        long step = stepAt(now);
        for (int d = -WINDOW; d <= WINDOW; d++) {
            long s = step + d;
            if (lastUsedStep != null && s <= lastUsedStep) continue;
            if (constantTimeEquals(codeAt(key, s, DIGITS), c)) return s;
        }
        return -1;
    }

    /** otpauth:// link an authenticator app reads from the QR code. */
    public static String otpauthUrl(String issuer, String account, String base32Secret) {
        String iss = issuer == null || issuer.isBlank() ? "Workspace" : issuer.trim();
        String label = enc(iss) + ":" + enc(account == null ? "" : account.trim());
        return "otpauth://totp/" + label + "?secret=" + base32Secret + "&issuer=" + enc(iss)
                + "&algorithm=SHA1&digits=" + DIGITS + "&period=" + PERIOD_SECONDS;
    }

    private static String enc(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8).replace("+", "%20");
    }

    public static String base32Encode(byte[] data) {
        StringBuilder sb = new StringBuilder((data.length * 8 + 4) / 5);
        int buffer = 0, bits = 0;
        for (byte b : data) {
            buffer = (buffer << 8) | (b & 0xFF);
            bits += 8;
            while (bits >= 5) {
                sb.append(B32.charAt((buffer >>> (bits - 5)) & 31));
                bits -= 5;
            }
        }
        if (bits > 0) sb.append(B32.charAt((buffer << (5 - bits)) & 31));
        return sb.toString();
    }

    public static byte[] base32Decode(String s) {
        String in = s.replace("=", "").replace(" ", "").toUpperCase();
        byte[] out = new byte[in.length() * 5 / 8];
        int buffer = 0, bits = 0, i = 0;
        for (char ch : in.toCharArray()) {
            int v = B32.indexOf(ch);
            if (v < 0) throw new IllegalArgumentException("Not a Base32 secret");
            buffer = (buffer << 5) | v;
            bits += 5;
            if (bits >= 8) {
                out[i++] = (byte) ((buffer >>> (bits - 8)) & 0xFF);
                bits -= 8;
            }
        }
        return out;
    }

    private static boolean constantTimeEquals(String a, String b) {
        if (a.length() != b.length()) return false;
        int r = 0;
        for (int i = 0; i < a.length(); i++) r |= a.charAt(i) ^ b.charAt(i);
        return r == 0;
    }
}
