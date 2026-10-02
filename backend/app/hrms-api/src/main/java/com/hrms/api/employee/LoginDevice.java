package com.hrms.api.employee;

import java.util.Locale;

/**
 * Redesign BW-100: a person's last sign-in device, in words, from the user
 * agent on their newest refresh token ("Android", "iPhone", "Chrome on
 * Windows"). Only a label is returned, never the raw user agent. Anything we
 * can't name (a script, an empty value) gives an empty string, and the page
 * then shows only the time.
 */
final class LoginDevice {

    private LoginDevice() {}

    static String describe(String userAgent) {
        if (userAgent == null) return "";
        String ua = userAgent.trim();
        if (ua.isEmpty()) return "";
        String l = ua.toLowerCase(Locale.ROOT);

        // Phones and tablets first: their browsers also say "Safari" / "Chrome".
        if (l.contains("iphone")) return "iPhone";
        if (l.contains("ipad")) return "iPad";
        if (l.contains("android")) return "Android";
        if (l.startsWith("okhttp")) return "Android";
        if (l.contains("cfnetwork") || l.contains("darwin/")) return "iPhone";
        if (l.startsWith("dart/")) return "Mobile app";

        String browser = l.contains("edg/") || l.contains("edge/") ? "Edge"
                : l.contains("opr/") || l.contains("opera") ? "Opera"
                : l.contains("firefox/") ? "Firefox"
                : l.contains("chrome/") || l.contains("chromium/") || l.contains("headlesschrome/") ? "Chrome"
                : l.contains("safari/") ? "Safari"
                : "";
        String os = l.contains("windows") ? "Windows"
                : l.contains("cros") ? "ChromeOS"
                : l.contains("mac os x") || l.contains("macintosh") ? "Mac"
                : l.contains("linux") ? "Linux"
                : "";
        if (!browser.isEmpty() && !os.isEmpty()) return browser + " on " + os;
        if (!browser.isEmpty()) return browser;
        return os;
    }
}
