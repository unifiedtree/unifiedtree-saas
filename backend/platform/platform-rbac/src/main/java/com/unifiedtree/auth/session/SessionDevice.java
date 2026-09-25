package com.unifiedtree.auth.session;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * Who is signing in from where: the browser/app and operating system named in
 * plain words ("Chrome on Windows", "Mobile app on Android"), and the client
 * IP address. Used to label sessions on Settings -> Security.
 */
public final class SessionDevice {

    private SessionDevice() {}

    public record ClientInfo(String userAgent, String ipAddress) {}

    /** The current HTTP request's user agent and IP, or nulls off a request thread. */
    public static ClientInfo currentClient() {
        RequestAttributes attrs = RequestContextHolder.getRequestAttributes();
        if (!(attrs instanceof ServletRequestAttributes sra)) return new ClientInfo(null, null);
        HttpServletRequest req = sra.getRequest();
        return new ClientInfo(truncate(req.getHeader("User-Agent"), 255), truncate(clientIp(req), 64));
    }

    /** First hop of X-Forwarded-For (Cloud Run puts the caller there), else the socket address. */
    static String clientIp(HttpServletRequest req) {
        String xff = req.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) {
            String first = xff.split(",")[0].trim();
            if (!first.isEmpty()) return first;
        }
        return req.getRemoteAddr();
    }

    /** "app" for the mobile app, "web" for a browser, "unknown" otherwise. */
    public static String kind(String ua) {
        if (ua == null || ua.isBlank()) return "unknown";
        String u = ua.toLowerCase();
        if (u.contains("okhttp") || u.contains("expo") || u.contains("reactnative") || u.contains("react-native")
                || u.contains("dalvik") || u.contains("cfnetwork")) return "app";
        if (u.contains("mozilla/") || u.contains("chrome/") || u.contains("safari/") || u.contains("firefox/")) return "web";
        return "unknown";
    }

    /** "Chrome on Windows", "Mobile app on Android", "Unknown device". */
    public static String describe(String ua) {
        if (ua == null || ua.isBlank()) return "Unknown device";
        String os = os(ua);
        if ("app".equals(kind(ua))) {
            String appOs = os != null ? os : ua.toLowerCase().contains("cfnetwork") ? "iOS" : ua.toLowerCase().contains("okhttp") || ua.toLowerCase().contains("dalvik") ? "Android" : null;
            return appOs == null ? "Mobile app" : "Mobile app on " + appOs;
        }
        String browser = browser(ua);
        if (browser == null && os == null) return "Unknown device";
        if (browser == null) return "Browser on " + os;
        return os == null ? browser : browser + " on " + os;
    }

    static String browser(String ua) {
        if (ua.contains("Edg/") || ua.contains("EdgA/") || ua.contains("EdgiOS/")) return "Edge";
        if (ua.contains("OPR/") || ua.contains("Opera")) return "Opera";
        if (ua.contains("SamsungBrowser/")) return "Samsung Internet";
        if (ua.contains("Firefox/") || ua.contains("FxiOS/")) return "Firefox";
        if (ua.contains("Chrome/") || ua.contains("CriOS/")) return "Chrome";
        if (ua.contains("Safari/")) return "Safari";
        return null;
    }

    static String os(String ua) {
        if (ua.contains("Windows")) return "Windows";
        if (ua.contains("Android")) return "Android";
        if (ua.contains("iPhone") || ua.contains("iPad") || ua.contains("iOS")) return "iOS";
        if (ua.contains("Mac OS X") || ua.contains("Macintosh")) return "macOS";
        if (ua.contains("CrOS")) return "ChromeOS";
        if (ua.contains("Linux")) return "Linux";
        return null;
    }

    private static String truncate(String s, int max) {
        if (s == null) return null;
        String t = s.trim();
        return t.length() <= max ? t : t.substring(0, max);
    }
}
