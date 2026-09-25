package com.unifiedtree.auth.session;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import static org.junit.jupiter.api.Assertions.*;

class SessionDeviceTest {

    @Test
    void namesCommonBrowsersAndSystems() {
        assertEquals("Chrome on Windows", SessionDevice.describe(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"));
        assertEquals("Edge on Windows", SessionDevice.describe(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0"));
        assertEquals("Safari on macOS", SessionDevice.describe(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15"));
        assertEquals("Firefox on Linux", SessionDevice.describe(
                "Mozilla/5.0 (X11; Linux x86_64; rv:129.0) Gecko/20100101 Firefox/129.0"));
        assertEquals("Chrome on Android", SessionDevice.describe(
                "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36"));
        assertEquals("Safari on iOS", SessionDevice.describe(
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"));
        assertEquals("web", SessionDevice.kind("Mozilla/5.0 (Windows NT 10.0) Chrome/128.0.0.0 Safari/537.36"));
    }

    @Test
    void recognisesTheMobileApp() {
        assertEquals("Mobile app on Android", SessionDevice.describe("okhttp/4.12.0"));
        assertEquals("app", SessionDevice.kind("okhttp/4.12.0"));
        assertEquals("Mobile app on iOS", SessionDevice.describe("UnifiedAttendance/1 CFNetwork/1496.0.7 Darwin/23.5.0"));
    }

    @Test
    void unknownWhenThereIsNothingToGoOn() {
        assertEquals("Unknown device", SessionDevice.describe(null));
        assertEquals("Unknown device", SessionDevice.describe("  "));
        assertEquals("Unknown device", SessionDevice.describe("curl/8.4.0"));
        assertEquals("unknown", SessionDevice.kind("curl/8.4.0"));
    }

    @Test
    void takesTheCallerFromXForwardedFor() {
        MockHttpServletRequest req = new MockHttpServletRequest();
        req.setRemoteAddr("10.0.0.1");
        assertEquals("10.0.0.1", SessionDevice.clientIp(req));
        req.addHeader("X-Forwarded-For", "203.0.113.7, 169.254.1.1");
        assertEquals("203.0.113.7", SessionDevice.clientIp(req));
    }
}
