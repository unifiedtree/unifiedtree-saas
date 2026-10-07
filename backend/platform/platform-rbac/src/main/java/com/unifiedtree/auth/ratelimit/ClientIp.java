package com.unifiedtree.auth.ratelimit;

import jakarta.servlet.http.HttpServletRequest;

/**
 * The caller's IP for rate limits. On Cloud Run, Google's front end APPENDS the address it saw to
 * {@code X-Forwarded-For}; everything before it is whatever the client sent, so the first hop can be
 * anything the caller likes (review 7 Oct: a per-IP limit keyed on it is not a limit). The last hop is
 * the one Google wrote. Without the header (local runs), the socket address.
 */
public final class ClientIp {

    private ClientIp() {}

    public static String of(HttpServletRequest req) {
        if (req == null) return null;
        String xff = req.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) {
            String[] hops = xff.split(",");
            for (int i = hops.length - 1; i >= 0; i--) {
                String hop = hops[i].trim();
                if (!hop.isEmpty()) return hop;
            }
        }
        return req.getRemoteAddr();
    }

    /** The last 10 digits of a phone number (how numbers are matched), or the input when shorter. */
    public static String phoneKey(String phone) {
        if (phone == null) return null;
        String digits = phone.replaceAll("\\D", "");
        return digits.length() >= 10 ? digits.substring(digits.length() - 10) : phone.trim();
    }
}
